# go.{{name}}.do

{{description}}

## Installation

```bash
go get go.{{name}}.do
```

## Usage

```go
package main

import (
	"context"
	"log"
	"os"

	{{name}} "go.{{name}}.do"
)

func main() {
	client, err := {{name}}.NewClient(os.Getenv("DOTDO_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	ctx := context.Background()
	rpc, err := client.Connect(ctx)
	if err != nil {
		log.Fatal(err)
	}

	// Use the RPC client...
}
```

## API Reference

### `Client`

The main client type for interacting with the {{name}}.do service.

#### Constructor Functions

- `NewClient(apiKey string)` - Create a new client with an API key
- `NewClientWithOptions(opts ClientOptions)` - Create a new client with custom options

#### Methods

- `Connect(ctx context.Context)` - Connect to the service and return an RPC client
- `Close()` - Close the connection to the service

### `ClientOptions`

Configuration options for the client.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `APIKey` | `string` | `""` | API key for authentication |
| `BaseURL` | `string` | `https://{{name}}.do` | Base URL for the service |

## Running Tests

```bash
go test ./...
```

## Conformance Tests

```bash
go test -run TestConformance
```

## License

MIT
