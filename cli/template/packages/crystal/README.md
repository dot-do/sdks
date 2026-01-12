# {{name}}.do Crystal SDK

{{description}}

## Installation

Add to your `shard.yml`:

```yaml
dependencies:
  {{name}}_do:
    github: dot-do/{{name}}
    version: ~> 0.1.0
```

Then run:

```bash
shards install
```

## Usage

```crystal
require "{{name}}_do"

# Create a client
client = {{Name}}Do::Client.new(api_key: ENV["DOTDO_KEY"]?)

# Connect
rpc = client.connect

# Use the client...

# Disconnect when done
client.disconnect
```

## Configuration

```crystal
require "{{name}}_do"

# Using options struct
options = {{Name}}Do::ClientOptions.new(
  api_key: "your-api-key",
  base_url: "https://{{name}}.do"
)
client = {{Name}}Do::Client.new(options)

# Or using named arguments
client = {{Name}}Do::Client.new(
  api_key: "your-api-key",
  base_url: "https://custom.{{name}}.do"
)

# Module-level helper
client = {{Name}}Do.connect(api_key: ENV["DOTDO_KEY"]?)
```

## Development

```bash
# Install dependencies
shards install

# Run tests
crystal spec

# Run linter
bin/ameba
```

## License

MIT
