//! Dynamic proxy for method dispatch.

use crate::client::{ConnectionState, PendingRequest, PipelineStep, RpcMessage};
use crate::error::{RpcError, TransportError};

use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// A dynamic proxy for making untyped RPC calls.
///
/// `DynamicProxy` allows making RPC calls without compile-time type checking,
/// useful for dynamic scenarios or when working with unknown interfaces.
pub struct DynamicProxy {
    /// Connection state.
    state: Arc<Mutex<ConnectionState>>,
    /// Next request ID.
    next_id: u64,
}

impl DynamicProxy {
    /// Create a new dynamic proxy.
    pub fn new(state: Arc<Mutex<ConnectionState>>, next_id: u64) -> Self {
        Self { state, next_id }
    }

    /// Start building a method call.
    pub fn call(&self, method: &str) -> MethodCall {
        MethodCall {
            state: self.state.clone(),
            method: method.to_string(),
            args: Vec::new(),
            target: None,
        }
    }

    /// Get a stub for a remote capability.
    pub fn stub(&self, id: &str) -> Stub {
        Stub::new(self.state.clone(), id.to_string())
    }
}

/// Builder for a method call.
pub struct MethodCall {
    state: Arc<Mutex<ConnectionState>>,
    method: String,
    args: Vec<JsonValue>,
    target: Option<String>,
}

impl MethodCall {
    /// Add an argument to the method call.
    pub fn arg<T: serde::Serialize>(mut self, value: T) -> Self {
        if let Ok(json) = serde_json::to_value(value) {
            self.args.push(json);
        }
        self
    }

    /// Add multiple arguments.
    pub fn args<T: serde::Serialize>(mut self, values: &[T]) -> Self {
        for value in values {
            if let Ok(json) = serde_json::to_value(value) {
                self.args.push(json);
            }
        }
        self
    }

    /// Set the target stub for this call.
    pub fn on(mut self, stub: &Stub) -> Self {
        self.target = Some(stub.id.clone());
        self
    }

    /// Execute the call and return the raw JSON result.
    pub async fn execute(self) -> crate::Result<JsonValue> {
        let id = generate_id();
        let msg = RpcMessage::Call {
            id,
            method: self.method,
            args: self.args,
            target: self.target,
        };

        send_and_wait(self.state, id, msg).await
    }

    /// Execute the call and deserialize the result.
    pub async fn execute_as<T: DeserializeOwned>(self) -> crate::Result<T> {
        let json = self.execute().await?;
        serde_json::from_value(json).map_err(|e| RpcError::Deserialization(e.to_string()))
    }
}

/// A stub representing a remote capability.
///
/// Stubs are references to objects on the server that can have methods
/// called on them. They are returned when calling methods that return
/// capabilities (like `makeCounter`).
#[derive(Clone)]
pub struct Stub {
    /// Connection state.
    state: Arc<Mutex<ConnectionState>>,
    /// The stub ID assigned by the server.
    pub(crate) id: String,
}

impl Stub {
    /// Create a new stub with the given ID.
    pub fn new(state: Arc<Mutex<ConnectionState>>, id: String) -> Self {
        Self { state, id }
    }

    /// Get the stub ID.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Call a method on this stub.
    pub fn call(&self, method: &str) -> MethodCall {
        MethodCall {
            state: self.state.clone(),
            method: method.to_string(),
            args: Vec::new(),
            target: Some(self.id.clone()),
        }
    }

    /// Get a property from this stub.
    pub async fn get<T: DeserializeOwned>(&self, property: &str) -> crate::Result<T> {
        self.call(property).execute_as().await
    }

    /// Convert to JSON value (for passing as argument).
    pub fn to_json(&self) -> JsonValue {
        serde_json::json!({
            "$stub": self.id
        })
    }
}

/// A proxy for a specific method on a stub.
///
/// This allows chaining method calls for pipelining.
pub struct MethodProxy {
    /// Connection state.
    state: Arc<Mutex<ConnectionState>>,
    /// The method to call.
    method: String,
    /// Arguments.
    args: Vec<JsonValue>,
    /// Target stub ID.
    target: Option<String>,
    /// Pipeline steps.
    pipeline: Vec<PipelineStep>,
}

impl MethodProxy {
    /// Create a new method proxy.
    pub fn new(
        state: Arc<Mutex<ConnectionState>>,
        method: &str,
        args: Vec<JsonValue>,
        target: Option<String>,
    ) -> Self {
        Self {
            state,
            method: method.to_string(),
            args,
            target,
            pipeline: Vec::new(),
        }
    }

    /// Chain another method call.
    pub fn then(mut self, method: &str, args: Vec<JsonValue>) -> Self {
        self.pipeline.push(PipelineStep {
            call: method.to_string(),
            args,
            alias: None,
            target: None,
        });
        self
    }

    /// Chain another method call with an alias.
    pub fn then_as(mut self, method: &str, args: Vec<JsonValue>, alias: &str) -> Self {
        self.pipeline.push(PipelineStep {
            call: method.to_string(),
            args,
            alias: Some(alias.to_string()),
            target: None,
        });
        self
    }

    /// Execute the proxy call (possibly pipelined).
    pub async fn execute(self) -> crate::Result<JsonValue> {
        let id = generate_id();

        let msg = if self.pipeline.is_empty() {
            RpcMessage::Call {
                id,
                method: self.method,
                args: self.args,
                target: self.target,
            }
        } else {
            let mut steps = vec![PipelineStep {
                call: self.method,
                args: self.args,
                alias: Some("_0".to_string()),
                target: self.target,
            }];
            steps.extend(self.pipeline);
            RpcMessage::Pipeline { id, steps }
        };

        send_and_wait(self.state, id, msg).await
    }

    /// Execute and deserialize the result.
    pub async fn execute_as<T: DeserializeOwned>(self) -> crate::Result<T> {
        let json = self.execute().await?;
        serde_json::from_value(json).map_err(|e| RpcError::Deserialization(e.to_string()))
    }
}

/// Generate a unique request ID.
fn generate_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Send a request and wait for the response.
async fn send_and_wait(
    state: Arc<Mutex<ConnectionState>>,
    id: u64,
    msg: RpcMessage,
) -> crate::Result<JsonValue> {
    let (response_tx, response_rx) = oneshot::channel();

    {
        let mut state = state.lock().await;
        if !state.connected {
            return Err(TransportError::ConnectionClosed.into());
        }

        state.pending.insert(id, PendingRequest { response_tx });

        let json = serde_json::to_string(&msg)?;
        state
            .message_tx
            .send(Message::Text(json))
            .await
            .map_err(|_| TransportError::ConnectionClosed)?;
    }

    // Wait for response (with default 30s timeout)
    let timeout = tokio::time::Duration::from_secs(30);
    match tokio::time::timeout(timeout, response_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(RpcError::Canceled),
        Err(_) => {
            let mut state = state.lock().await;
            state.pending.remove(&id);
            Err(RpcError::Timeout)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_to_json() {
        use std::collections::HashMap;
        use tokio::sync::mpsc;

        // Create a minimal connection state for testing
        let (tx, _rx) = mpsc::channel(1);
        let state = Arc::new(Mutex::new(ConnectionState {
            message_tx: tx,
            pending: HashMap::new(),
            exports: HashMap::new(),
            connected: true,
        }));

        let stub = Stub::new(state, "test_stub_123".to_string());
        let json = stub.to_json();

        assert_eq!(json["$stub"], "test_stub_123");
    }

    #[test]
    fn test_generate_id() {
        let id1 = generate_id();
        let id2 = generate_id();
        assert_ne!(id1, id2);
        assert!(id2 > id1);
    }
}
