# {{name.do}}

{{Name}} API for the DotDo Platform.

## Overview

`{{name.do}}` provides a {{Name}}-compatible API that runs over the DotDo RPC protocol, enabling:

- Promise pipelining for minimal round trips
- Server-side `.map()` operations
- Full type safety without code generation
- Drop-in replacement for existing {{Name}} clients

## Installation

### TypeScript/JavaScript

```bash
npm install @dotdo/{{name}}
```

### Python

```bash
pip install dotdo-{{name}}
```

## Quick Start

### TypeScript

```typescript
import { {{Name}}Client } from '@dotdo/{{name}}';

const client = new {{Name}}Client(process.env.DOTDO_KEY);

// Use {{Name}}-compatible API
const result = await client.doSomething();
```

### Python

```python
from dotdo_{{name_do}} import {{Name}}Client

client = {{Name}}Client(os.environ['DOTDO_KEY'])

# Use {{Name}}-compatible API
result = await client.do_something()
```

## Architecture

This package is built on the DotDo RPC stack:

```
{{name.do}} (this package)
    |
    v
dotdo (Platform SDK)
    |
    v
@dotdo/rpc ($ Proxy)
    |
    v
@dotdo/capnweb (Protocol)
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Development mode
npm run dev
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/typescript` | TypeScript/JavaScript SDK |
| `packages/python` | Python SDK |

## License

MIT
