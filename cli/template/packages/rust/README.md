# {{name}}-do

{{description}}

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
{{name}}-do = "0.1.0"
```

Or use cargo:

```bash
cargo add {{name}}-do
```

## Usage

```rust
use {{name}}_do::{{Name}}Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = {{Name}}Client::new(std::env::var("DOTDO_KEY")?)?;

    // Connect and use the service
    let rpc = client.connect().await?;
    // Use the RPC client...

    Ok(())
}
```

## API Reference

### `{{Name}}Client`

The main client struct for interacting with the {{name}}.do service.

#### Constructor

- `{{Name}}Client::new(api_key)` - Create a new client with an API key
- `{{Name}}Client::with_options(options)` - Create a new client with custom options

#### Methods

- `connect()` - Connect to the service and return an RPC client
- `disconnect()` - Disconnect from the service

### `{{Name}}ClientOptions`

Configuration options for the client.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `api_key` | `Option<String>` | `None` | API key for authentication |
| `base_url` | `String` | `https://{{name}}.do` | Base URL for the service |

## Running Tests

```bash
cargo test
```

## Conformance Tests

```bash
cargo test --test conformance
```

## License

MIT OR Apache-2.0
