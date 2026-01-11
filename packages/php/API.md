# Cap'n Web PHP Client API

> Package: `dotdo/capnweb`
> Requires: PHP 8.1+

## Design Philosophy

This API synthesizes four design approaches into one coherent system:

- **Transparent async via Fibers** - Write synchronous-looking code that suspends transparently
- **Full type safety via interfaces** - Generated stubs provide IDE autocomplete and static analysis
- **PHP 8 attributes for configuration** - Modern, declarative metadata for RPC targets
- **Fluent ergonomics** - Method chaining that feels natural to PHP developers

---

## Core API

### Connection

```php
use CapnWeb\Session;

// WebSocket (persistent, bidirectional)
$api = Session::connect('wss://api.example.com/rpc');

// HTTP batch (stateless, groups calls automatically)
$api = Session::batch('https://api.example.com/rpc');

// With options
$api = Session::connect('wss://api.example.com/rpc', [
    'timeout' => 30,
    'retries' => 3,
]);
```

### Method Calls

```php
// Synchronous-looking (Fiber suspends internally)
$user = $api->users->get(123);
echo $user->name;

// Parallel execution
[$user, $posts] = $api->all(
    $api->users->get(123),
    $api->posts->where(['author_id' => 123])->list()
);

// Explicit async when needed
$promise = $api->users->get(123)->async();
$promise->then(fn($user) => process($user));
```

### Pipelining

The killer feature of Cap'n Proto RPC. Chain calls without awaiting intermediate results.

```php
// Single round-trip for entire chain
$name = $api->authenticate($token)
    ->user
    ->profile
    ->displayName;

// Pass unresolved values as arguments (resolved server-side)
$auth = $api->authenticate($token);
$profile = $api->users->getProfile($auth->userId);  // Pipelined!

// Server-side iteration
$names = $api->users->list()
    ->map(fn($u) => $u->profile->displayName);
```

### Error Handling

```php
use CapnWeb\Exception\{RpcException, TimeoutException};

try {
    $user = $api->users->get(999);
} catch (RpcException $e) {
    match ($e->type) {
        'NotFound' => handleMissing(),
        'Forbidden' => handleAuth(),
        default => throw $e,
    };
}

// Promise-style
$api->users->get(123)
    ->catch(fn(RpcException $e) => fallback())
    ->then(fn($user) => process($user));
```

---

## RPC Targets (Pass-by-Reference)

Expose local objects that the server can call back into.

```php
use CapnWeb\Attribute\{RpcTarget, RpcMethod, RpcProperty};

#[RpcTarget]
class NotificationHandler
{
    #[RpcMethod]
    public function onMessage(string $type, mixed $data): void
    {
        echo "Received: {$type}";
    }

    #[RpcProperty(readable: true)]
    public readonly string $clientId;
}

// Register with server
$api->notifications->subscribe(new NotificationHandler());
```

---

## Type Definitions

### Core Interfaces

```php
namespace CapnWeb;

interface Session
{
    public static function connect(string $url, array $options = []): Stub;
    public static function batch(string $url, array $options = []): Stub;
}

interface Stub
{
    public function __get(string $name): Stub;
    public function __call(string $method, array $args): Promise;
    public function all(Promise ...$promises): array;
    public function close(): void;
}

interface Promise
{
    public function then(callable $onFulfilled): self;
    public function catch(callable $onRejected): self;
    public function finally(callable $callback): self;
    public function async(): self;
    public function await(): mixed;
}
```

### Attributes

```php
namespace CapnWeb\Attribute;

#[Attribute(Attribute::TARGET_CLASS)]
class RpcTarget {}

#[Attribute(Attribute::TARGET_METHOD)]
class RpcMethod
{
    public function __construct(
        public ?string $name = null,  // Override method name
    ) {}
}

#[Attribute(Attribute::TARGET_PROPERTY)]
class RpcProperty
{
    public function __construct(
        public bool $readable = true,
        public bool $writable = false,
    ) {}
}
```

### Generated Stubs (Optional)

For full IDE support, generate typed interfaces from your schema:

```php
// Generated or hand-written
interface ApiStub extends \CapnWeb\Stub
{
    public function authenticate(string $token): AuthResult|Promise;
    public function users(): UsersStub;
}

interface UsersStub extends \CapnWeb\Stub
{
    public function get(int $id): User|Promise;
    public function list(): array|Promise;
    public function create(array $data): User|Promise;
}

// Usage with type hints
/** @var ApiStub $api */
$api = Session::connect('wss://...');
$user = $api->users()->get(123);  // Full autocomplete
```

---

## Why This Design

### Fibers for Transparent Async

PHP 8.1 Fibers enable synchronous-looking code that suspends internally:

```php
// Looks synchronous, but $api->users->get() suspends the Fiber
// while waiting for the response, allowing other work to proceed
$user = $api->users->get(123);
```

No `await` keywords. No promise chains for simple cases. Just write code.

### Attributes for Declarative Configuration

PHP 8 attributes replace verbose configuration:

```php
// Instead of XML/YAML config or manual registration
#[RpcTarget]
class Handler {
    #[RpcMethod]
    public function onEvent(Event $e): void {}
}
```

### Magic Methods for Ergonomics, Interfaces for Types

Magic methods (`__call`, `__get`) provide the fluid syntax:

```php
$api->users->get(123)->profile->name
```

Generated interfaces provide IDE support when needed:

```php
/** @var UsersStub $users */
$users = $api->users;
$users->get(123);  // Autocomplete works
```

### Pipelining as Method Chains

Cap'n Proto's pipelining maps naturally to PHP's method chaining:

```php
// This entire chain executes in ONE round-trip
$api->authenticate($token)->user->profile->displayName
```

---

## Complete Example

```php
<?php

use CapnWeb\Session;
use CapnWeb\Attribute\{RpcTarget, RpcMethod};
use CapnWeb\Exception\RpcException;

// Connect
$api = Session::connect('wss://api.example.com/rpc');

try {
    // Authenticate and get profile (single round-trip via pipelining)
    $profile = $api->authenticate($token)
        ->user
        ->profile;

    echo "Welcome, {$profile->displayName}";

    // Parallel requests
    [$friends, $posts] = $api->all(
        $profile->friends->list(),
        $api->posts->where(['author_id' => $profile->userId])->recent(10)
    );

    // Subscribe to notifications
    $api->notifications->subscribe(new class {
        #[RpcMethod]
        public function onMessage(string $type, mixed $data): void {
            echo "[{$type}] " . json_encode($data);
        }
    });

} catch (RpcException $e) {
    error_log("RPC Error [{$e->type}]: {$e->getMessage()}");
} finally {
    $api->close();
}
```

---

## Adapters

The core API works standalone. Optional adapters integrate with popular frameworks:

| Adapter | Package | Features |
|---------|---------|----------|
| Laravel | `dotdo/capnweb-laravel` | Facade, config, service provider |
| Symfony | `dotdo/capnweb-symfony` | Bundle, autowiring, profiler |
| Amp | `dotdo/capnweb-amp` | Native Amp promises, cancellation |
| Swoole | `dotdo/capnweb-swoole` | Coroutines, connection pooling |
