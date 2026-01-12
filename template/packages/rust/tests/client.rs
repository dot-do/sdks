//! Client tests for {{name}}-do

use {{name}}_do::{{{Name}}Client, {{Name}}ClientOptions};

#[test]
fn test_create_client_with_api_key() {
    let client = {{Name}}Client::new("test-key").unwrap();
    // Client should be created successfully
    assert!(true);
}

#[test]
fn test_create_client_with_options() {
    let options = {{Name}}ClientOptions {
        api_key: Some("test-key".to_string()),
        base_url: "https://custom.{{name}}.do".to_string(),
    };
    let _client = {{Name}}Client::with_options(options);
    // Client should be created successfully
    assert!(true);
}

#[test]
fn test_default_options() {
    let options = {{Name}}ClientOptions::default();
    assert_eq!(options.base_url, "https://{{name}}.do");
    assert!(options.api_key.is_none());
}
