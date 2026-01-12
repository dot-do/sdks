//! Server-side map operations for collections.
//!
//! This module provides the `RpcMap` type which allows transforming collections
//! on the server side, avoiding N+1 round trips.
//!
//! # Example
//!
//! ```ignore
//! // Traditional N+1 approach (DON'T DO THIS):
//! let fibs: Vec<i32> = client.call("generateFibonacci", &[6]).await?;
//! let mut results = Vec::new();
//! for x in fibs {
//!     results.push(client.call("square", &[x]).await?);  // N round trips!
//! }
//!
//! // Server-side map (DO THIS):
//! let results: Vec<i32> = client
//!     .map("generateFibonacci", vec![json!(6)], "x => self.square(x)", vec!["$self".to_string()])
//!     .await?;
//! ```

use crate::client::{ConnectionState, PendingRequest, RpcMessage};
use crate::error::{RpcError, TransportError};

use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::sync::{oneshot, Mutex};
use tokio_tungstenite::tungstenite::Message;

/// A server-side map operation.
///
/// `RpcMap` represents a deferred map operation that will be executed on the server.
/// This is the key to avoiding N+1 round trips when working with collections.
pub struct RpcMap<T> {
    /// Connection state.
    state: Option<Arc<Mutex<ConnectionState>>>,
    /// Source method call.
    source_method: String,
    /// Source arguments.
    source_args: Vec<JsonValue>,
    /// Map expression.
    expression: String,
    /// Captured variables.
    captures: Vec<String>,
    /// Inner state for the future.
    inner: MapState,
    /// Type marker.
    _marker: PhantomData<T>,
}

/// State of the map future.
enum MapState {
    /// Not yet started.
    Pending,
    /// Waiting for response.
    Waiting(oneshot::Receiver<Result<JsonValue, RpcError>>),
    /// Done.
    Done,
}

impl<T> RpcMap<T>
where
    T: DeserializeOwned + Send + 'static,
{
    /// Create a new RpcMap.
    pub fn new(
        state: Arc<Mutex<ConnectionState>>,
        source_method: &str,
        source_args: Vec<JsonValue>,
        expression: &str,
        captures: Vec<String>,
    ) -> Self {
        Self {
            state: Some(state),
            source_method: source_method.to_string(),
            source_args,
            expression: expression.to_string(),
            captures,
            inner: MapState::Pending,
            _marker: PhantomData,
        }
    }

    /// Create an empty/done RpcMap (for error cases).
    pub fn empty() -> Self {
        Self {
            state: None,
            source_method: String::new(),
            source_args: Vec::new(),
            expression: String::new(),
            captures: Vec::new(),
            inner: MapState::Done,
            _marker: PhantomData,
        }
    }

    /// Get the expression string.
    pub fn expression(&self) -> &str {
        &self.expression
    }

    /// Get the source method.
    pub fn source_method(&self) -> &str {
        &self.source_method
    }
}

impl<T> Future for RpcMap<T>
where
    T: DeserializeOwned + Send + 'static,
{
    type Output = Result<T, RpcError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        loop {
            match &mut self.inner {
                MapState::Pending => {
                    let state = match &self.state {
                        Some(s) => s.clone(),
                        None => {
                            return Poll::Ready(Err(RpcError::Internal(
                                "RpcMap has no connection state".into(),
                            )));
                        }
                    };

                    let id = generate_id();
                    let msg = RpcMessage::Map {
                        id,
                        source_call: self.source_method.clone(),
                        source_args: self.source_args.clone(),
                        expression: self.expression.clone(),
                        captures: self.captures.clone(),
                    };

                    let (tx, rx) = oneshot::channel();
                    self.inner = MapState::Waiting(rx);

                    tokio::spawn(async move {
                        let result = send_map_request(state, id, msg).await;
                        let _ = tx.send(result);
                    });

                    continue;
                }
                MapState::Waiting(rx) => {
                    match Pin::new(rx).poll(cx) {
                        Poll::Ready(Ok(result)) => {
                            self.inner = MapState::Done;
                            match result {
                                Ok(json) => {
                                    match serde_json::from_value(json) {
                                        Ok(value) => return Poll::Ready(Ok(value)),
                                        Err(e) => {
                                            return Poll::Ready(Err(RpcError::Deserialization(
                                                e.to_string(),
                                            )))
                                        }
                                    }
                                }
                                Err(e) => return Poll::Ready(Err(e)),
                            }
                        }
                        Poll::Ready(Err(_)) => {
                            self.inner = MapState::Done;
                            return Poll::Ready(Err(RpcError::Canceled));
                        }
                        Poll::Pending => return Poll::Pending,
                    }
                }
                MapState::Done => {
                    return Poll::Ready(Err(RpcError::Internal(
                        "RpcMap already completed".into(),
                    )));
                }
            }
        }
    }
}

/// Trait for types that can be mapped on the server.
pub trait ServerMap {
    /// Apply a server-side map transformation.
    ///
    /// The closure should return an RPC call expression that will be
    /// applied to each element of the collection on the server.
    fn remap<F, U>(&self, expression: &str, captures: Vec<String>, f: F) -> RpcMap<Vec<U>>
    where
        F: Fn(&JsonValue) -> JsonValue + Send + Sync + 'static,
        U: DeserializeOwned + Send + 'static;
}

/// Generate a unique request ID.
fn generate_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(10000);
    COUNTER.fetch_add(1, Ordering::SeqCst)
}

/// Send a map request and wait for response.
async fn send_map_request(
    state: Arc<Mutex<ConnectionState>>,
    id: u64,
    msg: RpcMessage,
) -> Result<JsonValue, RpcError> {
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

    // Wait for response
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

/// Extension trait for RpcClient to support map operations.
pub trait RpcMapExt {
    /// Execute a server-side map operation.
    fn map<T>(
        &self,
        source_method: &str,
        source_args: Vec<JsonValue>,
        expression: &str,
        captures: Vec<String>,
    ) -> RpcMap<T>
    where
        T: DeserializeOwned + Send + 'static;
}

impl RpcMapExt for crate::client::RpcClient {
    fn map<T>(
        &self,
        source_method: &str,
        source_args: Vec<JsonValue>,
        expression: &str,
        captures: Vec<String>,
    ) -> RpcMap<T>
    where
        T: DeserializeOwned + Send + 'static,
    {
        RpcMap::new(
            self.state.clone(),
            source_method,
            source_args,
            expression,
            captures,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_id() {
        let id1 = generate_id();
        let id2 = generate_id();
        assert_ne!(id1, id2);
        assert!(id2 > id1);
    }
}
