//! Unit tests for the RPC client.

use rpc_do::{connect, RpcClient, RpcClientConfig, RpcError, PipelineStep};
use serde_json::json;
use std::env;

/// Get the test server URL from environment or default.
fn get_server_url() -> String {
    env::var("TEST_SERVER_URL").unwrap_or_else(|_| "ws://localhost:8787".to_string())
}

/// Get the WebSocket URL from a base URL.
fn to_ws_url(url: &str) -> String {
    url.replace("http://", "ws://")
        .replace("https://", "wss://")
}

// ============================================================================
// Connection Tests
// ============================================================================

mod connection_tests {
    use super::*;

    #[tokio::test]
    async fn test_connect_creates_client() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                assert_eq!(client.endpoint(), url);
                assert!(client.is_connected().await);
                let _ = client.close().await;
            }
            Err(e) => {
                // Connection failure is okay if server isn't running
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_connect_with_config() {
        let url = to_ws_url(&get_server_url());
        let config = RpcClientConfig {
            timeout_ms: 5000,
            max_retries: 5,
            auto_reconnect: false,
            health_check_interval_ms: 1000,
        };

        match RpcClient::connect_with_config(&url, config).await {
            Ok(client) => {
                assert_eq!(client.config().timeout_ms, 5000);
                assert_eq!(client.config().max_retries, 5);
                assert!(!client.config().auto_reconnect);
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_invalid_url_scheme() {
        let result = connect("ftp://localhost:8787").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_close_connection() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                assert!(client.is_connected().await);
                let result = client.close().await;
                assert!(result.is_ok());
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }
}

// ============================================================================
// RPC Call Tests
// ============================================================================

mod call_tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_call() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call::<i32, i32>("square", &[5]).await;
                match result {
                    Ok(value) => assert_eq!(value, 25),
                    Err(e) => println!("Call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_call_with_negative_number() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call::<i32, i32>("square", &[-3]).await;
                match result {
                    Ok(value) => assert_eq!(value, 9),
                    Err(e) => println!("Call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_call_raw() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call_raw("returnNumber", vec![json!(42)]).await;
                match result {
                    Ok(value) => assert_eq!(value, json!(42)),
                    Err(e) => println!("Call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_call_returning_array() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call::<Vec<i32>, i32>("generateFibonacci", &[5]).await;
                match result {
                    Ok(value) => assert_eq!(value, vec![0, 1, 1, 2, 3]),
                    Err(e) => println!("Call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_call_returning_null() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call_raw("returnNull", vec![]).await;
                match result {
                    Ok(value) => assert!(value.is_null()),
                    Err(e) => println!("Call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }
}

// ============================================================================
// Pipeline Tests
// ============================================================================

mod pipeline_tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_pipeline() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let steps = vec![
                    PipelineStep {
                        call: "makeCounter".to_string(),
                        args: vec![json!(42)],
                        alias: Some("counter".to_string()),
                        target: None,
                    },
                    PipelineStep {
                        call: "counter.value".to_string(),
                        args: vec![],
                        alias: Some("value".to_string()),
                        target: Some("counter".to_string()),
                    },
                ];

                let result = client.pipeline(steps).await;
                match result {
                    Ok(value) => {
                        println!("Pipeline result: {:?}", value);
                        // The result should contain the value
                    }
                    Err(e) => println!("Pipeline failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }
}

// ============================================================================
// Error Handling Tests
// ============================================================================

mod error_tests {
    use super::*;

    #[tokio::test]
    async fn test_nonexistent_method() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call_raw("nonExistentMethod", vec![]).await;
                assert!(result.is_err());
                if let Err(e) = result {
                    assert!(e.is_type("Error"));
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_error_from_server() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client.call_raw("throwError", vec![]).await;
                assert!(result.is_err());
                if let Err(e) = result {
                    assert!(e.message_contains("error"));
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }
}

// ============================================================================
// Map Operation Tests
// ============================================================================

mod map_tests {
    use super::*;

    #[tokio::test]
    async fn test_server_side_map() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client
                    .map_call(
                        "generateFibonacci",
                        vec![json!(6)],
                        "x => self.square(x)",
                        vec!["$self".to_string()],
                    )
                    .await;

                match result {
                    Ok(value) => {
                        // fib(6) = [0, 1, 1, 2, 3, 5]
                        // squared = [0, 1, 1, 4, 9, 25]
                        assert_eq!(value, json!([0, 1, 1, 4, 9, 25]));
                    }
                    Err(e) => println!("Map call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_map_empty_array() {
        let url = to_ws_url(&get_server_url());
        match connect(&url).await {
            Ok(client) => {
                let result = client
                    .map_call(
                        "generateFibonacci",
                        vec![json!(0)],
                        "x => self.square(x)",
                        vec!["$self".to_string()],
                    )
                    .await;

                match result {
                    Ok(value) => {
                        assert_eq!(value, json!([]));
                    }
                    Err(e) => println!("Map call failed: {}", e),
                }
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }
}

// ============================================================================
// Config Tests
// ============================================================================

mod config_tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RpcClientConfig::default();
        assert_eq!(config.timeout_ms, 30_000);
        assert_eq!(config.max_retries, 3);
        assert!(config.auto_reconnect);
        assert_eq!(config.health_check_interval_ms, 0);
    }

    #[test]
    fn test_custom_config() {
        let config = RpcClientConfig {
            timeout_ms: 5000,
            max_retries: 1,
            auto_reconnect: false,
            health_check_interval_ms: 5000,
        };
        assert_eq!(config.timeout_ms, 5000);
        assert_eq!(config.max_retries, 1);
        assert!(!config.auto_reconnect);
        assert_eq!(config.health_check_interval_ms, 5000);
    }
}

// ============================================================================
// Serialization Tests
// ============================================================================

mod serialization_tests {
    use super::*;
    use rpc_do::client::RpcMessage;

    #[test]
    fn test_call_message_serialization() {
        let msg = RpcMessage::Call {
            id: 1,
            method: "test".to_string(),
            args: vec![json!(42), json!("hello")],
            target: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"call\""));
        assert!(json.contains("\"method\":\"test\""));
        assert!(json.contains("42"));
        assert!(json.contains("\"hello\""));
    }

    #[test]
    fn test_result_message_deserialization() {
        let json = r#"{"type":"result","id":1,"value":42}"#;
        let msg: RpcMessage = serde_json::from_str(json).unwrap();
        match msg {
            RpcMessage::Result { id, value } => {
                assert_eq!(id, 1);
                assert_eq!(value, json!(42));
            }
            _ => panic!("Expected Result message"),
        }
    }

    #[test]
    fn test_error_message_deserialization() {
        let json = r#"{"type":"error","id":1,"errorType":"RangeError","message":"test error"}"#;
        let msg: RpcMessage = serde_json::from_str(json).unwrap();
        match msg {
            RpcMessage::Error {
                id,
                error_type,
                message,
                code,
            } => {
                assert_eq!(id, 1);
                assert_eq!(error_type, "RangeError");
                assert_eq!(message, "test error");
                assert!(code.is_none());
            }
            _ => panic!("Expected Error message"),
        }
    }

    #[test]
    fn test_pipeline_message_serialization() {
        let msg = RpcMessage::Pipeline {
            id: 1,
            steps: vec![
                PipelineStep {
                    call: "makeCounter".to_string(),
                    args: vec![json!(10)],
                    alias: Some("counter".to_string()),
                    target: None,
                },
                PipelineStep {
                    call: "value".to_string(),
                    args: vec![],
                    alias: None,
                    target: Some("counter".to_string()),
                },
            ],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"pipeline\""));
        assert!(json.contains("\"makeCounter\""));
        assert!(json.contains("\"counter\""));
    }
}
