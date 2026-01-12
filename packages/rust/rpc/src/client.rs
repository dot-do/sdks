//! RPC Client with WebSocket transport.

use crate::error::{RpcError, TransportError};

use futures_util::{SinkExt, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

/// Configuration options for RpcClient.
#[derive(Debug, Clone)]
pub struct RpcClientConfig {
    /// Request timeout in milliseconds.
    pub timeout_ms: u64,
    /// Maximum number of retry attempts.
    pub max_retries: u32,
    /// Enable automatic reconnection.
    pub auto_reconnect: bool,
    /// Health check interval in milliseconds (0 to disable).
    pub health_check_interval_ms: u64,
}

impl Default for RpcClientConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            max_retries: 3,
            auto_reconnect: true,
            health_check_interval_ms: 0,
        }
    }
}

/// RPC message types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RpcMessage {
    /// Call a method
    #[serde(rename = "call")]
    Call {
        id: u64,
        method: String,
        #[serde(default)]
        args: Vec<JsonValue>,
        /// Optional target stub ID for method calls on capabilities
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<String>,
    },
    /// Method call result
    #[serde(rename = "result")]
    Result {
        id: u64,
        #[serde(default)]
        value: JsonValue,
    },
    /// Error response
    #[serde(rename = "error")]
    Error {
        id: u64,
        #[serde(rename = "errorType", default)]
        error_type: String,
        message: String,
        #[serde(default)]
        code: Option<i32>,
    },
    /// Pipeline call (multiple methods in one message)
    #[serde(rename = "pipeline")]
    Pipeline {
        id: u64,
        steps: Vec<PipelineStep>,
    },
    /// Pipeline result
    #[serde(rename = "pipeline_result")]
    PipelineResult {
        id: u64,
        results: HashMap<String, JsonValue>,
    },
    /// Export a capability (callback) to the server
    #[serde(rename = "export")]
    Export {
        id: String,
        name: String,
    },
    /// Server calling an exported capability
    #[serde(rename = "callback")]
    Callback {
        id: u64,
        export_id: String,
        args: Vec<JsonValue>,
    },
    /// Callback result
    #[serde(rename = "callback_result")]
    CallbackResult {
        id: u64,
        value: JsonValue,
    },
    /// Map operation (server-side collection transform)
    #[serde(rename = "map")]
    Map {
        id: u64,
        /// The call that produces the collection
        source_call: String,
        source_args: Vec<JsonValue>,
        /// The transform expression
        expression: String,
        /// Captured variables (stub references)
        #[serde(default)]
        captures: Vec<String>,
    },
}

/// A step in a pipeline call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    /// The method to call (may include dot notation).
    pub call: String,
    /// Arguments to the method.
    #[serde(default)]
    pub args: Vec<JsonValue>,
    /// Optional alias for the result.
    #[serde(rename = "as", skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    /// Optional target (for calls on stub results)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

/// Pending request state.
pub struct PendingRequest {
    /// Channel to send the response.
    pub response_tx: oneshot::Sender<Result<JsonValue, RpcError>>,
}

/// Exported callback handler.
pub type CallbackHandler = Box<dyn Fn(Vec<JsonValue>) -> JsonValue + Send + Sync>;

/// Internal connection state.
pub struct ConnectionState {
    /// Sender for outgoing messages.
    pub message_tx: mpsc::Sender<Message>,
    /// Pending requests waiting for responses.
    pub pending: HashMap<u64, PendingRequest>,
    /// Exported callbacks.
    pub exports: HashMap<String, Arc<CallbackHandler>>,
    /// Is the connection alive?
    pub connected: bool,
}

/// High-level RPC client for WebSocket-based RPC.
pub struct RpcClient {
    /// The endpoint URL.
    endpoint: String,
    /// Client configuration.
    config: RpcClientConfig,
    /// Next request ID.
    next_id: AtomicU64,
    /// Connection state (protected by mutex).
    pub(crate) state: Arc<Mutex<ConnectionState>>,
    /// Exported callback counter.
    export_counter: AtomicU64,
}

impl RpcClient {
    /// Connect to an RPC endpoint with default configuration.
    pub async fn connect(endpoint: &str) -> crate::Result<Self> {
        Self::connect_with_config(endpoint, RpcClientConfig::default()).await
    }

    /// Connect to an RPC endpoint with custom configuration.
    pub async fn connect_with_config(
        endpoint: &str,
        config: RpcClientConfig,
    ) -> crate::Result<Self> {
        // Parse and validate URL
        let url = Url::parse(endpoint).map_err(|e| TransportError::InvalidUrl(e.to_string()))?;

        // Ensure it's a WebSocket URL
        let ws_url = match url.scheme() {
            "ws" | "wss" => url,
            "http" => {
                let mut url = url;
                url.set_scheme("ws").ok();
                url
            }
            "https" => {
                let mut url = url;
                url.set_scheme("wss").ok();
                url
            }
            scheme => {
                return Err(TransportError::InvalidUrl(format!(
                    "Invalid scheme: {}",
                    scheme
                ))
                .into())
            }
        };

        // Connect to WebSocket
        let (ws_stream, _response) = connect_async(ws_url.as_str())
            .await
            .map_err(|e| TransportError::ConnectionFailed(e.to_string()))?;

        let (write, read) = ws_stream.split();

        // Create message channel
        let (message_tx, mut message_rx) = mpsc::channel::<Message>(100);

        // Create connection state
        let state = Arc::new(Mutex::new(ConnectionState {
            message_tx: message_tx.clone(),
            pending: HashMap::new(),
            exports: HashMap::new(),
            connected: true,
        }));

        let client = Self {
            endpoint: endpoint.to_string(),
            config,
            next_id: AtomicU64::new(1),
            state: state.clone(),
            export_counter: AtomicU64::new(1),
        };

        // Spawn writer task
        let write = Arc::new(Mutex::new(write));
        let write_clone = write.clone();
        tokio::spawn(async move {
            while let Some(msg) = message_rx.recv().await {
                let mut writer = write_clone.lock().await;
                if writer.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Spawn reader task
        let state_clone = state.clone();
        tokio::spawn(async move {
            let mut read = read;
            while let Some(msg_result) = read.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        Self::handle_message(&state_clone, &text).await;
                    }
                    Ok(Message::Close(_)) => {
                        let mut state = state_clone.lock().await;
                        state.connected = false;
                        break;
                    }
                    Ok(_) => {
                        // Ignore binary, ping, pong
                    }
                    Err(_) => {
                        let mut state = state_clone.lock().await;
                        state.connected = false;
                        break;
                    }
                }
            }
        });

        Ok(client)
    }

    /// Handle an incoming message.
    async fn handle_message(state: &Arc<Mutex<ConnectionState>>, text: &str) {
        // Try to parse as RpcMessage
        let msg: Result<RpcMessage, _> = serde_json::from_str(text);

        match msg {
            Ok(RpcMessage::Result { id, value }) => {
                let mut state = state.lock().await;
                if let Some(pending) = state.pending.remove(&id) {
                    let _ = pending.response_tx.send(Ok(value));
                }
            }
            Ok(RpcMessage::Error {
                id,
                error_type,
                message,
                code,
            }) => {
                let mut state = state.lock().await;
                if let Some(pending) = state.pending.remove(&id) {
                    let err = RpcError::Remote {
                        error_type,
                        message,
                        code,
                    };
                    let _ = pending.response_tx.send(Err(err));
                }
            }
            Ok(RpcMessage::PipelineResult { id, results }) => {
                let mut state = state.lock().await;
                if let Some(pending) = state.pending.remove(&id) {
                    // Convert results map to JSON value
                    let value = serde_json::to_value(results).unwrap_or(JsonValue::Null);
                    let _ = pending.response_tx.send(Ok(value));
                }
            }
            Ok(RpcMessage::Callback {
                id,
                export_id,
                args,
            }) => {
                let (result, tx) = {
                    let state = state.lock().await;
                    if let Some(handler) = state.exports.get(&export_id) {
                        let handler = handler.clone();
                        let result = handler(args);
                        (result, state.message_tx.clone())
                    } else {
                        (JsonValue::Null, state.message_tx.clone())
                    }
                };

                // Send callback result
                let response = RpcMessage::CallbackResult { id, value: result };
                if let Ok(json) = serde_json::to_string(&response) {
                    let _ = tx.send(Message::Text(json)).await;
                }
            }
            _ => {
                // Ignore other message types or parse errors
            }
        }
    }

    /// Get the endpoint URL.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Get the client configuration.
    pub fn config(&self) -> &RpcClientConfig {
        &self.config
    }

    /// Check if the client is connected.
    pub async fn is_connected(&self) -> bool {
        let state = self.state.lock().await;
        state.connected
    }

    /// Generate the next request ID.
    pub(crate) fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    /// Generate the next export ID.
    fn next_export_id(&self) -> String {
        let id = self.export_counter.fetch_add(1, Ordering::SeqCst);
        format!("export_{}", id)
    }

    /// Send a raw RPC message and wait for response.
    pub(crate) async fn send_request(&self, msg: RpcMessage) -> crate::Result<JsonValue> {
        let id = match &msg {
            RpcMessage::Call { id, .. } => *id,
            RpcMessage::Pipeline { id, .. } => *id,
            RpcMessage::Map { id, .. } => *id,
            _ => return Err(RpcError::Protocol("Invalid request message type".into())),
        };

        let (response_tx, response_rx) = oneshot::channel();

        {
            let mut state = self.state.lock().await;
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

        // Wait for response with timeout
        let timeout = tokio::time::Duration::from_millis(self.config.timeout_ms);
        match tokio::time::timeout(timeout, response_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RpcError::Canceled),
            Err(_) => {
                // Remove pending request on timeout
                let mut state = self.state.lock().await;
                state.pending.remove(&id);
                Err(RpcError::Timeout)
            }
        }
    }

    /// Make an RPC call and return the raw JSON response.
    pub async fn call_raw(
        &self,
        method: &str,
        args: Vec<JsonValue>,
    ) -> crate::Result<JsonValue> {
        let id = self.next_request_id();
        let msg = RpcMessage::Call {
            id,
            method: method.to_string(),
            args,
            target: None,
        };
        self.send_request(msg).await
    }

    /// Make an RPC call on a specific stub target.
    pub async fn call_on_stub(
        &self,
        stub_id: &str,
        method: &str,
        args: Vec<JsonValue>,
    ) -> crate::Result<JsonValue> {
        let id = self.next_request_id();
        let msg = RpcMessage::Call {
            id,
            method: method.to_string(),
            args,
            target: Some(stub_id.to_string()),
        };
        self.send_request(msg).await
    }

    /// Make a typed RPC call.
    pub async fn call<T, A>(&self, method: &str, args: &[A]) -> crate::Result<T>
    where
        T: DeserializeOwned,
        A: Serialize,
    {
        let json_args: Vec<JsonValue> = args
            .iter()
            .map(|a| serde_json::to_value(a))
            .collect::<Result<_, _>>()?;

        let response = self.call_raw(method, json_args).await?;
        serde_json::from_value(response).map_err(|e| RpcError::Deserialization(e.to_string()))
    }

    /// Execute a pipeline of calls.
    pub async fn pipeline(&self, steps: Vec<PipelineStep>) -> crate::Result<JsonValue> {
        let id = self.next_request_id();
        let msg = RpcMessage::Pipeline { id, steps };
        self.send_request(msg).await
    }

    /// Execute a server-side map operation.
    pub async fn map_call(
        &self,
        source_method: &str,
        source_args: Vec<JsonValue>,
        expression: &str,
        captures: Vec<String>,
    ) -> crate::Result<JsonValue> {
        let id = self.next_request_id();
        let msg = RpcMessage::Map {
            id,
            source_call: source_method.to_string(),
            source_args,
            expression: expression.to_string(),
            captures,
        };
        self.send_request(msg).await
    }

    /// Export a callback function that the server can call.
    pub async fn export<F>(&self, name: &str, handler: F) -> crate::Result<String>
    where
        F: Fn(Vec<JsonValue>) -> JsonValue + Send + Sync + 'static,
    {
        let export_id = self.next_export_id();

        {
            let mut state = self.state.lock().await;
            state
                .exports
                .insert(export_id.clone(), Arc::new(Box::new(handler)));

            // Send export message to server
            let msg = RpcMessage::Export {
                id: export_id.clone(),
                name: name.to_string(),
            };
            let json = serde_json::to_string(&msg)?;
            state
                .message_tx
                .send(Message::Text(json))
                .await
                .map_err(|_| TransportError::ConnectionClosed)?;
        }

        Ok(export_id)
    }

    /// Close the connection gracefully.
    pub async fn close(self) -> crate::Result<()> {
        let mut state = self.state.lock().await;
        state.connected = false;

        // Send close message
        let _ = state.message_tx.send(Message::Close(None)).await;

        // Cancel all pending requests
        for (_, pending) in state.pending.drain() {
            let _ = pending.response_tx.send(Err(RpcError::Canceled));
        }

        Ok(())
    }
}

/// Connect to an RPC endpoint.
///
/// This is a convenience function that creates an `RpcClient` with default configuration.
pub async fn connect(endpoint: &str) -> crate::Result<RpcClient> {
    RpcClient::connect(endpoint).await
}

/// Connect to an RPC endpoint with custom configuration.
pub async fn connect_with_config(
    endpoint: &str,
    config: RpcClientConfig,
) -> crate::Result<RpcClient> {
    RpcClient::connect_with_config(endpoint, config).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rpc_message_serialization() {
        let msg = RpcMessage::Call {
            id: 1,
            method: "test".to_string(),
            args: vec![json!(42)],
            target: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"call\""));
        assert!(json.contains("\"method\":\"test\""));
    }

    #[test]
    fn test_pipeline_step_serialization() {
        let step = PipelineStep {
            call: "counter.increment".to_string(),
            args: vec![json!(5)],
            alias: Some("result".to_string()),
            target: None,
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("\"call\":\"counter.increment\""));
        assert!(json.contains("\"as\":\"result\""));
    }

    #[test]
    fn test_config_default() {
        let config = RpcClientConfig::default();
        assert_eq!(config.timeout_ms, 30_000);
        assert_eq!(config.max_retries, 3);
        assert!(config.auto_reconnect);
    }
}
