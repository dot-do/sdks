# platform.do/sdk

The official PHP SDK for the DotDo platform. This library provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform.do/sdk` is the highest-level SDK in the DotDo stack, built on top of:

- **rpc.do/sdk** - Type-safe RPC client
- **capnweb.do/sdk** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic PHP API.

```
+------------------+
| platform.do/sdk  |  <-- You are here (auth, pooling, retries)
+------------------+
|   rpc.do/sdk     |  <-- RPC client layer
+------------------+
| capnweb.do/sdk   |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **PSR Compliance**: PSR-4 autoloading, PSR-7 HTTP messages
- **Type Safety**: Full PHP 8.2+ type declarations
- **Framework Agnostic**: Works with Laravel, Symfony, or standalone

## Requirements

- PHP 8.2+
- ext-json
- Composer

## Installation

```bash
composer require platform.do/sdk
```

## Quick Start

### Basic Usage

```php
<?php

use DotDo\DotDo;

// Create a client
$client = new DotDo([
    'api_key' => getenv('DOTDO_API_KEY'),
]);

// Make an RPC call
$result = $client->call('ai.generate', [
    'prompt' => 'Hello, world!',
    'model' => 'claude-3',
]);

print_r($result);

// Close when done
$client->close();
```

### Using Factory

```php
<?php

use DotDo\DotDoFactory;

// Create from environment
$client = DotDoFactory::fromEnvironment();

try {
    $result = $client->call('ai.generate', ['prompt' => 'Hello!']);
    echo $result['text'];
} finally {
    $client->close();
}
```

## Configuration

### Constructor Options

```php
$client = new DotDo([
    // Authentication
    'api_key' => 'your-api-key',
    'access_token' => 'oauth-token',
    'headers' => ['X-Custom' => 'value'],

    // Endpoint
    'endpoint' => 'wss://api.dotdo.dev/rpc',

    // Connection Pool
    'pool_size' => 10,
    'pool_timeout' => 30,

    // Retry Policy
    'max_retries' => 3,
    'retry_delay' => 0.1,
    'retry_max_delay' => 30,
    'retry_multiplier' => 2.0,

    // Request Settings
    'timeout' => 30,

    // Debug
    'debug' => false,
]);
```

### Environment Variables

```bash
# Authentication
export DOTDO_API_KEY=your-api-key
export DOTDO_ACCESS_TOKEN=oauth-token

# Endpoint
export DOTDO_ENDPOINT=wss://api.dotdo.dev/rpc

# Connection Pool
export DOTDO_POOL_SIZE=10
export DOTDO_POOL_TIMEOUT=30

# Retry
export DOTDO_MAX_RETRIES=3
export DOTDO_RETRY_DELAY=0.1

# Request
export DOTDO_TIMEOUT=30

# Debug
export DOTDO_DEBUG=true
```

### Laravel Integration

In `config/services.php`:

```php
'dotdo' => [
    'api_key' => env('DOTDO_API_KEY'),
    'endpoint' => env('DOTDO_ENDPOINT', 'wss://api.dotdo.dev/rpc'),
    'pool_size' => env('DOTDO_POOL_SIZE', 10),
    'timeout' => env('DOTDO_TIMEOUT', 30),
    'debug' => env('DOTDO_DEBUG', false),
],
```

Service provider:

```php
<?php

namespace App\Providers;

use DotDo\DotDo;
use Illuminate\Support\ServiceProvider;

class DotDoServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(DotDo::class, function ($app) {
            return new DotDo(config('services.dotdo'));
        });
    }
}
```

Usage in controllers:

```php
<?php

namespace App\Http\Controllers;

use DotDo\DotDo;

class AIController extends Controller
{
    public function __construct(
        private DotDo $dotdo
    ) {}

    public function generate(Request $request)
    {
        $result = $this->dotdo->call('ai.generate', [
            'prompt' => $request->input('prompt'),
        ]);

        return response()->json($result);
    }
}
```

### Symfony Integration

In `config/services.yaml`:

```yaml
services:
    DotDo\DotDo:
        arguments:
            - api_key: '%env(DOTDO_API_KEY)%'
              endpoint: '%env(DOTDO_ENDPOINT)%'
              pool_size: '%env(int:DOTDO_POOL_SIZE)%'
              timeout: '%env(int:DOTDO_TIMEOUT)%'
              debug: '%env(bool:DOTDO_DEBUG)%'
```

## Authentication

### API Key

```php
$client = new DotDo(['api_key' => 'your-api-key']);
```

### OAuth Token

```php
$client = new DotDo(['access_token' => 'oauth-access-token']);
```

### Custom Headers

```php
$client = new DotDo([
    'api_key' => 'your-api-key',
    'headers' => [
        'X-Tenant-ID' => 'tenant-123',
        'X-Request-ID' => uniqid(),
    ],
]);
```

### Dynamic Authentication

```php
$client = new DotDo([
    'auth_provider' => function () {
        $token = $this->fetchToken(); // Your token refresh logic
        return ['Authorization' => "Bearer $token"];
    },
]);
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```php
$client = new DotDo([
    'pool_size' => 20,     // Maximum concurrent connections
    'pool_timeout' => 60,  // Wait up to 60s for available connection
]);
```

### Pool Behavior

1. Connections are created on-demand up to `pool_size`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, calls block up to `pool_timeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```php
$stats = $client->poolStats();
echo "Available: " . $stats['available'] . "\n";
echo "In use: " . $stats['in_use'] . "\n";
echo "Total: " . $stats['total'] . "\n";
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```php
$client = new DotDo([
    'max_retries' => 5,
    'retry_delay' => 0.2,      // Start with 200ms
    'retry_max_delay' => 60,   // Cap at 60 seconds
    'retry_multiplier' => 2.0, // Double each time
]);
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Custom Retry Policy

```php
$client = new DotDo([
    'retry_policy' => function (Throwable $error, int $attempt): bool {
        if ($error instanceof RateLimitException) {
            usleep($error->getRetryAfter() * 1000);
            return true; // Retry
        }
        return $attempt < 5; // Retry up to 5 times
    },
]);
```

## Making RPC Calls

### Basic Call

```php
$result = $client->call('method.name', ['param' => 'value']);
```

### With Timeout Override

```php
$result = $client->call('ai.generate', ['prompt' => 'Long task...'], [
    'timeout' => 120, // 2 minute timeout
]);
```

### Async Calls (with ReactPHP/Amp)

```php
// Using ReactPHP
$promise = $client->callAsync('ai.generate', ['prompt' => 'Hello!']);

$promise->then(
    fn($result) => print_r($result),
    fn($error) => echo "Error: " . $error->getMessage()
);
```

### Typed Responses

```php
<?php

readonly class GenerateResponse
{
    public function __construct(
        public string $text,
        public Usage $usage,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            text: $data['text'],
            usage: Usage::fromArray($data['usage']),
        );
    }
}

readonly class Usage
{
    public function __construct(
        public int $promptTokens,
        public int $completionTokens,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            promptTokens: $data['prompt_tokens'],
            completionTokens: $data['completion_tokens'],
        );
    }
}

// Use typed response
$data = $client->call('ai.generate', ['prompt' => 'Hello!']);
$response = GenerateResponse::fromArray($data);

echo "Generated: " . $response->text . "\n";
echo "Tokens: " . $response->usage->completionTokens . "\n";
```

### Streaming Responses

```php
$client->stream('ai.generate', ['prompt' => 'Hello'], function ($chunk) {
    echo $chunk;
    flush();
});
```

## Error Handling

### Exception Hierarchy

```php
namespace DotDo\Exception;

class DotDoException extends \Exception {}
class AuthException extends DotDoException {}
class ConnectionException extends DotDoException {}
class TimeoutException extends DotDoException {}
class RateLimitException extends DotDoException {
    public function getRetryAfter(): int;
}
class RpcException extends DotDoException {
    public function getCode(): int;
}
class PoolExhaustedException extends DotDoException {}
```

### Error Handling Example

```php
use DotDo\Exception\{
    AuthException,
    RateLimitException,
    TimeoutException,
    RpcException,
    DotDoException
};

try {
    $result = $client->call('ai.generate', ['prompt' => 'Hello']);
} catch (AuthException $e) {
    echo "Authentication failed: " . $e->getMessage() . "\n";
    // Re-authenticate
} catch (RateLimitException $e) {
    echo "Rate limited. Retry after: " . $e->getRetryAfter() . "ms\n";
    usleep($e->getRetryAfter() * 1000);
    // Retry
} catch (TimeoutException $e) {
    echo "Request timed out\n";
} catch (RpcException $e) {
    echo "RPC error ({$e->getCode()}): {$e->getMessage()}\n";
} catch (DotDoException $e) {
    echo "DotDo error: " . $e->getMessage() . "\n";
}
```

### Using Result Pattern

```php
$result = $client->callResult('ai.generate', ['prompt' => 'Hello']);

if ($result->isSuccess()) {
    print_r($result->getValue());
} else {
    echo "Error: " . $result->getError()->getMessage() . "\n";
}
```

## Collections API

### Working with Collections

```php
$users = $client->collection('users');

// Create a document
$users->set('user-123', [
    'name' => 'Alice',
    'email' => 'alice@example.com',
]);

// Read a document
$user = $users->get('user-123');
print_r($user);

// Update a document
$users->update('user-123', ['name' => 'Alice Smith']);

// Delete a document
$users->delete('user-123');
```

### Querying Collections

```php
$users = $client->collection('users');

// Build a query
$results = $users->query()
    ->where('status', '==', 'active')
    ->where('age', '>=', 18)
    ->orderBy('created_at', 'desc')
    ->limit(10)
    ->get();

foreach ($results as $user) {
    print_r($user);
}
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `==`     | Equal to |
| `!=`     | Not equal to |
| `<`      | Less than |
| `<=`     | Less than or equal |
| `>`      | Greater than |
| `>=`     | Greater than or equal |
| `in`     | In array |
| `not_in` | Not in array |

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```php
// Auth is handled automatically
$client = new DotDo(['api_key' => getenv('DOTDO_API_KEY')]);
```

### Usage Metrics

```php
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```php
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```php
// Enable debug mode for verbose logging
$client = new DotDo(['debug' => true]);
```

## Best Practices

### 1. Use Try-Finally for Cleanup

```php
$client = new DotDo(['api_key' => 'key']);

try {
    $result = $client->call('method', $params);
    // Process result
} finally {
    $client->close();
}
```

### 2. Reuse Client Instance

```php
// Good - single client instance
class AIService
{
    private static ?DotDo $client = null;

    public static function getClient(): DotDo
    {
        if (self::$client === null) {
            self::$client = new DotDo(['api_key' => getenv('DOTDO_API_KEY')]);
        }
        return self::$client;
    }
}

// Bad - new client per request
function badGenerate(string $prompt): array
{
    $client = new DotDo(['api_key' => 'key']); // Creates new pool!
    return $client->call('ai.generate', ['prompt' => $prompt]);
    // Missing close()!
}
```

### 3. Use Type Declarations

```php
// Good - typed response
readonly class Response
{
    public function __construct(
        public string $text,
    ) {}
}

$response = Response::fromArray($client->call('method', $params));

// Works but no type safety
$response = $client->call('method', $params);
```

### 4. Handle All Exceptions

```php
// Good - specific exception handling
try {
    $client->call('method', $params);
} catch (RateLimitException $e) {
    usleep($e->getRetryAfter() * 1000);
    // Retry
} catch (AuthException $e) {
    $this->refreshCredentials();
    // Retry
} catch (DotDoException $e) {
    $this->logger->error('DotDo error', ['exception' => $e]);
    throw $e;
}

// Bad - catch-all
try {
    $client->call('method', $params);
} catch (Exception $e) {
    // Swallowing all exceptions
}
```

## API Reference

### DotDo Class

```php
class DotDo
{
    // Constructor
    public function __construct(array $options = []);

    // RPC Calls
    public function call(string $method, array $params = [], array $options = []): array;
    public function callResult(string $method, array $params = []): Result;
    public function callAsync(string $method, array $params = []): PromiseInterface;

    // Streaming
    public function stream(string $method, array $params, callable $callback): void;

    // Collections
    public function collection(string $name): Collection;

    // Pool Statistics
    public function poolStats(): array;

    // Lifecycle
    public function close(): void;
}
```

### Collection Class

```php
class Collection
{
    public function get(string $id): ?array;
    public function set(string $id, array $data): void;
    public function update(string $id, array $data): void;
    public function delete(string $id): void;
    public function query(): Query;
}
```

### Query Class

```php
class Query
{
    public function where(string $field, string $operator, mixed $value): self;
    public function orderBy(string $field, string $direction = 'asc'): self;
    public function limit(int $count): self;
    public function offset(int $count): self;
    public function get(): array;
    public function first(): ?array;
}
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/php)
- [Packagist](https://packagist.org/packages/platform.do/sdk)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
