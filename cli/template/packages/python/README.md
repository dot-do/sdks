# {{name}}-do

{{description}}

## Installation

```bash
pip install {{name}}-do
# or
uv add {{name}}-do
# or
poetry add {{name}}-do
```

## Usage

```python
import os
from {{name}}_do import {{Name}}Client

client = {{Name}}Client(api_key=os.environ['DOTDO_KEY'])

# Connect and use the service
rpc = await client.connect()
result = await rpc.example()
print(result)
```

## API Reference

### `{{Name}}Client`

The main client class for interacting with the {{name}}.do service.

#### Constructor Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | `str \| None` | `None` | API key for authentication |
| `base_url` | `str` | `https://{{name}}.do` | Base URL for the service |

#### Methods

- `connect() -> RpcClient`: Connect to the service and return an RPC client
- `disconnect() -> None`: Disconnect from the service

## Running Tests

```bash
pytest
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run linting
ruff check .

# Run type checking
mypy src
```

## License

MIT
