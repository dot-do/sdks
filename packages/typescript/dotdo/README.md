# platform.do

The official TypeScript/JavaScript SDK for the DotDo platform. This package provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform.do` is the highest-level SDK in the DotDo stack, built on top of:

- **[rpc.do](../rpc)** - Type-safe RPC client with proxy-based method invocation
- **[capnweb.do](../capnweb)** - Low-level Cap'n Proto over WebSocket transport

This layered architecture means you get the full power of Cap'n Proto's efficient binary serialization with a simple, idiomatic TypeScript API.

```
+------------------+
|   platform.do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc.do       |  <-- RPC proxy layer
+------------------+
|   capnweb.do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with jitter for transient failures
- **Type Safety**: Full TypeScript support with generics
- **Request Timeout**: Configurable timeouts per request or globally
- **Debug Logging**: Optional verbose logging for troubleshooting
- **Graceful Shutdown**: Clean connection cleanup

## Installation

```bash
# npm
npm install platform.do

# yarn
yarn add platform.do

# pnpm
pnpm add platform.do

# bun
bun add platform.do
```

## Quick Start

### Basic Usage

```typescript
import { DotDo, to } from 'platform.do';

// Quick one-liner with the `to` helper
const ai = await to<AIService>('ai');
const response = await ai.generate({ prompt: 'Hello, world!' });
console.log(response.text);
```

### With Configuration

```typescript
import { DotDo } from 'platform.do';

// Create a configured client
const client = new DotDo({
  apiKey: process.env.DOTDO_API_KEY,
  timeout: 30000,
  debug: true,
});

// Connect to a service
const ai = await client.connect<AIService>('ai');

// Make typed RPC calls
const result = await ai.complete({
  model: 'claude-3',
  prompt: 'Explain quantum computing',
  maxTokens: 1000,
});

// Clean up when done
await client.close();
```

## Configuration Options

### DotDoOptions

```typescript
interface DotDoOptions {
  // Authentication
  apiKey?: string;           // API key for Bearer auth
  auth?: AuthOptions;        // Full auth configuration

  // Connection Pool
  pool?: PoolOptions;        // Pool configuration

  // Retry Behavior
  retry?: RetryOptions;      // Retry configuration

  // Request Settings
  timeout?: number;          // Default timeout in ms
  baseUrl?: string;          // Override default .do domain

  // Development
  debug?: boolean;           // Enable debug logging
}
```

### AuthOptions

```typescript
interface AuthOptions {
  apiKey?: string;                    // API key auth
  accessToken?: string;               // OAuth access token
  headers?: Record<string, string>;   // Custom headers
}
```

### PoolOptions

```typescript
interface PoolOptions {
  minConnections?: number;    // Minimum connections (default: 1)
  maxConnections?: number;    // Maximum connections (default: 10)
  idleTimeout?: number;       // Idle timeout in ms (default: 30000)
  acquireTimeout?: number;    // Wait timeout in ms (default: 5000)
}
```

### RetryOptions

```typescript
interface RetryOptions {
  maxAttempts?: number;       // Max retry attempts (default: 3)
  baseDelay?: number;         // Base delay in ms (default: 100)
  maxDelay?: number;          // Max delay in ms (default: 10000)
  backoffMultiplier?: number; // Exponential factor (default: 2)
  retryableStatuses?: number[];  // HTTP codes to retry
  retryableErrors?: string[];    // Error codes to retry
}
```

## Authentication

### API Key Authentication

```typescript
const client = new DotDo({
  apiKey: 'your-api-key',
});
```

### OAuth Token

```typescript
const client = new DotDo({
  auth: {
    accessToken: 'oauth-access-token',
  },
});
```

### Custom Headers

```typescript
const client = new DotDo({
  auth: {
    headers: {
      'X-Custom-Auth': 'custom-value',
      'X-Tenant-ID': 'tenant-123',
    },
  },
});
```

### Environment Variables

The SDK automatically reads from environment variables:

```bash
export DOTDO_API_KEY=your-api-key
```

```typescript
const client = new DotDo(); // Uses DOTDO_API_KEY
```

## Connection Pooling

Connection pooling reduces latency by reusing WebSocket connections:

```typescript
const client = new DotDo({
  pool: {
    minConnections: 2,     // Pre-warm 2 connections
    maxConnections: 20,    // Allow up to 20 concurrent
    idleTimeout: 60000,    // Close idle after 60s
    acquireTimeout: 10000, // Wait up to 10s for connection
  },
});
```

### Pool Behavior

1. On first request, a connection is established
2. Subsequent requests reuse existing connections
3. If all connections are busy, new ones are created (up to max)
4. If at max, requests wait for an available connection
5. Idle connections are automatically cleaned up

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```typescript
const client = new DotDo({
  retry: {
    maxAttempts: 5,
    baseDelay: 200,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
  },
});
```

### Retry Timing Example

With default settings (baseDelay: 100, multiplier: 2):

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 100-125ms      |
| 3       | 200-250ms      |
| 4       | 400-500ms      |

Jitter (0-25%) is added to prevent thundering herd.

## Service Discovery

Services are automatically resolved to their `.do` domain:

```typescript
// Short form - resolves to https://ai.do
const ai = await client.connect('ai');

// Full URL - used as-is
const custom = await client.connect('https://api.example.com');

// With base URL override
const client = new DotDo({ baseUrl: 'https://staging.dotdo.dev' });
const ai = await client.connect('ai'); // https://staging.dotdo.dev/ai
```

## Type-Safe RPC

Define interfaces for your services:

```typescript
interface AIService {
  generate(params: GenerateParams): Promise<GenerateResult>;
  embed(params: EmbedParams): Promise<EmbedResult>;
  models(): Promise<Model[]>;
}

interface GenerateParams {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

interface GenerateResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number };
}

// Fully typed client
const ai = await client.connect<AIService>('ai');
const result = await ai.generate({
  model: 'claude-3',
  prompt: 'Hello!',
}); // result is GenerateResult
```

## Convenience Functions

### Global Configuration

```typescript
import { configure, getClient, to } from 'platform.do';

// Configure once at app startup
configure({
  apiKey: process.env.DOTDO_API_KEY,
  timeout: 30000,
});

// Use anywhere without passing config
const ai = await to<AIService>('ai');
```

### One-off Connections

```typescript
import { DotDo } from 'platform.do';

const client = new DotDo({ apiKey: 'key' });

// Bypasses connection pool - for single-use connections
const ai = client.connectOnce<AIService>('ai');
await ai.someMethod();
```

## Error Handling

```typescript
import { DotDo, RpcError, ConnectionError, CapabilityError } from 'platform.do';

try {
  const ai = await client.connect('ai');
  const result = await ai.generate({ prompt: 'Hello' });
} catch (error) {
  if (error instanceof ConnectionError) {
    console.error('Connection failed:', error.message);
    // Retry logic, fallback, etc.
  } else if (error instanceof RpcError) {
    console.error('RPC failed:', error.code, error.message);
    // Handle application-level errors
  } else if (error instanceof CapabilityError) {
    console.error('Capability revoked:', error.message);
    // Re-authenticate or reconnect
  } else {
    throw error;
  }
}
```

### Error Types

| Error | Description |
|-------|-------------|
| `ConnectionError` | WebSocket connection failed |
| `RpcError` | Remote method returned an error |
| `CapabilityError` | Capability was revoked or invalid |
| `CapnwebError` | Low-level transport error |

## Testing Support

The SDK includes testing utilities for SDK conformance testing:

```typescript
import { createTestServer, createTestClient } from 'platform.do';

describe('AI Service', () => {
  let server: TestServerInstance;

  beforeAll(async () => {
    server = await createTestServer({ verbose: true });
  });

  afterAll(async () => {
    await server.shutdown();
  });

  it('should generate text', async () => {
    const client = createTestClient({
      serverUrl: server.url,
      debug: true,
    });

    const ai = await client.connect('test');
    const result = await ai.echo({ message: 'hello' });
    expect(result.message).toBe('hello');
  });
});
```

## Platform Features

When connected to the DotDo platform, you get access to:

### Managed Authentication

```typescript
// Auth is handled automatically
const client = new DotDo({ apiKey: process.env.DOTDO_API_KEY });
```

### Usage Metrics

```typescript
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```typescript
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```typescript
// Enable debug mode to see requests
const client = new DotDo({ debug: true });

// Logs are also available in the platform dashboard
```

## Re-exports

For convenience, `platform.do` re-exports types from the underlying packages:

```typescript
import {
  // From rpc.do
  connect,
  createConnection,
  type RpcProxy,
  type $,
  type Connection,
  type Recording,

  // Error types
  CapnwebError,
  ConnectionError,
  RpcError,
  CapabilityError,

  // From capnweb.do
  type TransportState,
  type ConnectionOptions,
  type ConnectionStats,
} from 'platform.do';
```

## Best Practices

### 1. Use a Single Client Instance

```typescript
// Good - create once, reuse
const client = new DotDo({ apiKey: process.env.DOTDO_API_KEY });
export { client };

// Bad - creates new connections each time
export function getAI() {
  return new DotDo({ apiKey: process.env.DOTDO_API_KEY }).connect('ai');
}
```

### 2. Clean Up on Shutdown

```typescript
process.on('SIGTERM', async () => {
  await client.close();
  process.exit(0);
});
```

### 3. Type Your Services

```typescript
// Good - type safety
const ai = await client.connect<AIService>('ai');

// Works but no type safety
const ai = await client.connect('ai');
```

### 4. Handle Errors Gracefully

```typescript
async function generateWithFallback(prompt: string) {
  try {
    const ai = await client.connect<AIService>('ai');
    return await ai.generate({ prompt });
  } catch (error) {
    console.error('Primary AI failed, trying fallback');
    const fallback = await client.connect<AIService>('ai-fallback');
    return await fallback.generate({ prompt });
  }
}
```

## API Reference

### DotDo Class

| Method | Description |
|--------|-------------|
| `constructor(options?)` | Create a new client |
| `connect<T>(service)` | Connect to a service with pooling |
| `connectOnce<T>(service)` | One-off connection without pooling |
| `getAuthHeaders()` | Get current auth headers |
| `close()` | Close all connections |

### Module Functions

| Function | Description |
|----------|-------------|
| `to<T>(service, options?)` | Quick connect using default client |
| `configure(options)` | Configure the default client |
| `getClient(options?)` | Get or create default client |
| `createTestServer(config?)` | Create a test server |
| `createTestClient(options)` | Create a test client |

## Requirements

- Node.js 18+ or Bun 1.0+
- TypeScript 5.0+ (for type definitions)

## License

MIT

## Links

- [Documentation](https://do.md/docs/typescript)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [API Reference](https://do.md/api)
