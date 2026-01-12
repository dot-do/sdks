# {{name}}.do

{{description}}

## Installation

```bash
npm install {{name}}.do
# or
pnpm add {{name}}.do
# or
yarn add {{name}}.do
# or
bun add {{name}}.do
```

## Usage

```typescript
import { {{Name}}Client } from '{{name}}.do'

const client = new {{Name}}Client({
  apiKey: process.env.DOTDO_KEY,
})

// Connect and use the service
const rpc = await client.connect()
const result = await rpc.example()
console.log(result)
```

## API Reference

### `{{Name}}Client`

The main client class for interacting with the {{name}}.do service.

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | - | API key for authentication |
| `baseUrl` | `string` | `https://{{name}}.do` | Base URL for the service |

#### Methods

- `connect()`: Connect to the service and return an RPC client
- `disconnect()`: Disconnect from the service

## Running Tests

```bash
npm test
```

## Conformance Tests

```bash
npm run conformance
```

## License

MIT
