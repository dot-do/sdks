//! RpcPromise - Lazy RPC result with pipelining support.

use crate::client::{ConnectionState, PendingRequest, PipelineStep, RpcMessage};
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

/// A lazy RPC result that supports pipelining.
///
/// `RpcPromise<T>` implements `Future<Output = Result<T, RpcError>>` and
/// allows chaining method calls before awaiting.
///
/// # Example
///
/// ```ignore
/// // Create a promise for a method call
/// let promise: RpcPromise<Counter> = client.promise("makeCounter", vec![json!(42)]);
///
/// // Chain another call (builds pipeline, no network yet)
/// let value_promise: RpcPromise<i32> = promise.call("value", vec![]);
///
/// // Now execute the pipeline
/// let value = value_promise.await?;
/// ```
pub struct RpcPromise<T> {
    /// Connection state for sending requests.
    state: Arc<Mutex<ConnectionState>>,
    /// Request ID (assigned when first step is created).
    id: u64,
    /// Initial method to call.
    method: String,
    /// Arguments for the initial method.
    args: Vec<JsonValue>,
    /// Target stub ID (for calls on capabilities).
    target: Option<String>,
    /// Pipeline steps built up before await.
    pipeline: Vec<PipelineOp>,
    /// Inner state for the future.
    inner: PromiseState,
    /// Type marker.
    _marker: PhantomData<T>,
}

/// A pipeline operation.
#[derive(Clone, Debug)]
struct PipelineOp {
    /// Method to call.
    method: String,
    /// Arguments.
    args: Vec<JsonValue>,
    /// Alias for the result.
    alias: Option<String>,
    /// Target from previous step.
    target_alias: Option<String>,
}

/// Internal state for the promise future.
enum PromiseState {
    /// Not yet started.
    Pending,
    /// Request sent, waiting for response.
    Waiting(oneshot::Receiver<Result<JsonValue, RpcError>>),
    /// Completed or failed.
    Done,
}

impl<T> RpcPromise<T>
where
    T: DeserializeOwned + Send + 'static,
{
    /// Create a new RpcPromise.
    pub fn new(
        state: Arc<Mutex<ConnectionState>>,
        id: u64,
        method: &str,
        args: Vec<JsonValue>,
        target: Option<String>,
    ) -> Self {
        Self {
            state,
            id,
            method: method.to_string(),
            args,
            target,
            pipeline: Vec::new(),
            inner: PromiseState::Pending,
            _marker: PhantomData,
        }
    }

    /// Chain another method call onto this promise.
    ///
    /// This builds a pipeline that will be executed in a single round trip.
    pub fn call<U>(self, method: &str, args: Vec<JsonValue>) -> RpcPromise<U>
    where
        U: DeserializeOwned + Send + 'static,
    {
        let mut pipeline = self.pipeline;
        pipeline.push(PipelineOp {
            method: method.to_string(),
            args,
            alias: None,
            target_alias: None,
        });

        RpcPromise {
            state: self.state,
            id: self.id,
            method: self.method,
            args: self.args,
            target: self.target,
            pipeline,
            inner: PromiseState::Pending,
            _marker: PhantomData,
        }
    }

    /// Chain a method call with an alias.
    pub fn call_as<U>(self, method: &str, args: Vec<JsonValue>, alias: &str) -> RpcPromise<U>
    where
        U: DeserializeOwned + Send + 'static,
    {
        let mut pipeline = self.pipeline;
        pipeline.push(PipelineOp {
            method: method.to_string(),
            args,
            alias: Some(alias.to_string()),
            target_alias: None,
        });

        RpcPromise {
            state: self.state,
            id: self.id,
            method: self.method,
            args: self.args,
            target: self.target,
            pipeline,
            inner: PromiseState::Pending,
            _marker: PhantomData,
        }
    }

    /// Get the pipeline expression as a string (for debugging).
    pub fn expression_string(&self) -> String {
        let mut expr = format!("{}({:?})", self.method, self.args);
        for op in &self.pipeline {
            expr.push_str(&format!(".{}({:?})", op.method, op.args));
        }
        expr
    }

    /// Build the RPC message for this promise.
    fn build_message(&self) -> RpcMessage {
        if self.pipeline.is_empty() {
            // Simple call
            RpcMessage::Call {
                id: self.id,
                method: self.method.clone(),
                args: self.args.clone(),
                target: self.target.clone(),
            }
        } else {
            // Pipeline call
            let mut steps = vec![PipelineStep {
                call: self.method.clone(),
                args: self.args.clone(),
                alias: Some("_0".to_string()),
                target: self.target.clone(),
            }];

            for (i, op) in self.pipeline.iter().enumerate() {
                steps.push(PipelineStep {
                    call: op.method.clone(),
                    args: op.args.clone(),
                    alias: op.alias.clone().or_else(|| Some(format!("_{}", i + 1))),
                    target: op.target_alias.clone().or_else(|| Some(format!("_{}", i))),
                });
            }

            RpcMessage::Pipeline {
                id: self.id,
                steps,
            }
        }
    }
}

impl<T> Future for RpcPromise<T>
where
    T: DeserializeOwned + Send + 'static,
{
    type Output = Result<T, RpcError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        loop {
            match &mut self.inner {
                PromiseState::Pending => {
                    // Start the request
                    let msg = self.build_message();
                    let id = self.id;
                    let state = self.state.clone();

                    let (tx, rx) = oneshot::channel();
                    self.inner = PromiseState::Waiting(rx);

                    // Spawn a task to send the request
                    tokio::spawn(async move {
                        let result = send_request(state, id, msg).await;
                        let _ = tx.send(result);
                    });

                    // Continue to poll the waiting state
                    continue;
                }
                PromiseState::Waiting(rx) => {
                    match Pin::new(rx).poll(cx) {
                        Poll::Ready(Ok(result)) => {
                            self.inner = PromiseState::Done;
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
                            self.inner = PromiseState::Done;
                            return Poll::Ready(Err(RpcError::Canceled));
                        }
                        Poll::Pending => return Poll::Pending,
                    }
                }
                PromiseState::Done => {
                    return Poll::Ready(Err(RpcError::Internal(
                        "Promise already completed".into(),
                    )));
                }
            }
        }
    }
}

/// Send an RPC request and store the pending handler.
async fn send_request(
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
    match response_rx.await {
        Ok(result) => result,
        Err(_) => Err(RpcError::Canceled),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_op() {
        let op = PipelineOp {
            method: "test".to_string(),
            args: vec![],
            alias: Some("result".to_string()),
            target_alias: None,
        };
        assert_eq!(op.method, "test");
        assert_eq!(op.alias, Some("result".to_string()));
    }
}
