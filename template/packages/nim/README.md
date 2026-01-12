# {{name}}.do Nim SDK

{{description}}

## Installation

Add to your `.nimble` file:

```nim
requires "{{name}}_do >= 0.1.0"
```

Or install directly:

```bash
nimble install {{name}}_do
```

## Usage

```nim
import std/[asyncdispatch, os]
import {{name}}_do

proc main() {.async.} =
  # Create a client
  let client = new{{Name}}Client(apiKey = getEnv("DOTDO_KEY"))

  # Connect
  let rpc = await client.connect()

  # Use the client...

  # Disconnect when done
  await client.disconnect()

waitFor main()
```

## Configuration

```nim
import std/options
import {{name}}_do

# Using keyword arguments
let client1 = new{{Name}}Client(
  apiKey = "your-api-key",
  baseUrl = "https://{{name}}.do"
)

# Using options object
let opts = new{{Name}}ClientOptions(
  apiKey = some("your-api-key"),
  baseUrl = "https://custom.{{name}}.do"
)
let client2 = new{{Name}}Client(opts)
```

## Development

```bash
# Install dependencies
nimble install

# Run tests
nimble test

# Build
nimble build
```

## License

MIT
