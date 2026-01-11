# Cap'n Web PHP Client Syntax Exploration

## Package: `dotdo/capnweb`

This document explores divergent syntax approaches for an elegant, modern PHP client library for Cap'n Web RPC. Each approach prioritizes different PHP idioms and async strategies.

---

## Approach 1: Magic Methods with Fibers (PHP 8.1+)

**Philosophy**: Leverage PHP 8.1 Fibers for transparent async, `__call` magic for dynamic method forwarding, and readonly classes for immutable stubs.

**Inspirations**: Laravel's Facades, Symfony HttpClient's lazy responses

### Connection/Session Creation

```php
<?php

use CapnWeb\Session;
use CapnWeb\Transport\WebSocket;
use CapnWeb\Transport\HttpBatch;

// WebSocket session - persistent connection
$api = Session::connect('wss://api.example.com/rpc');

// HTTP batch - stateless, groups calls until await
$api = Session::batch('https://api.example.com/rpc');

// With explicit transport configuration
$api = Session::create(
    transport: new WebSocket('wss://api.example.com/rpc', [
        'timeout' => 30,
        'heartbeat' => 15,
    ])
);

// Disposable pattern with try-finally
$api = Session::connect('wss://api.example.com/rpc');
try {
    // ... use $api
} finally {
    $api->close();
}
```

### Making RPC Calls (Sync vs Async)

```php
<?php

// Synchronous-looking call (Fiber suspends internally)
$user = $api->users->get(123);
echo $user->name;  // Fiber resumes when result arrives

// Explicit async - returns RpcPromise immediately
$promise = $api->users->get(123)->async();

// Multiple calls - batched automatically in HTTP batch mode
$user1 = $api->users->get(1);
$user2 = $api->users->get(2);
// Both resolved in single round-trip

// Parallel execution with await_all()
[$profile, $friends] = await_all(
    $api->users->get(123)->profile,
    $api->users->get(123)->friends->list()
);
```

### Pipelining Syntax

```php
<?php

// Chain calls without awaiting intermediate results
// Single round-trip for entire chain!
$name = $api->authenticate($token)
            ->getUser()
            ->profile
            ->displayName;

// Property access through promises
$userId = $api->authenticate($token)->userId;

// Pass promises as arguments (resolved server-side)
$authApi = $api->authenticate($token)->async();
$profile = $api->getUserProfile($authApi->userId);

// The magic .map() method for server-side iteration
$friendProfiles = $api->users->get(123)
    ->friends
    ->map(fn($friend) => [
        'id' => $friend->id,
        'profile' => $api->getUserProfile($friend->id)
    ]);
```

### Error Handling

```php
<?php

use CapnWeb\Exception\RpcException;
use CapnWeb\Exception\ConnectionLostException;
use CapnWeb\Exception\TimeoutException;

// Standard exceptions
try {
    $user = $api->users->get(999);
} catch (RpcException $e) {
    echo "RPC failed: {$e->getMessage()}";
    echo "Remote type: {$e->getRemoteType()}";  // e.g., "NotFoundError"
    echo "Remote stack: {$e->getRemoteStack()}";
}

// Promise-style error handling
$api->users->get(123)
    ->then(fn($user) => processUser($user))
    ->catch(fn(RpcException $e) => handleError($e))
    ->finally(fn() => cleanup());

// Fiber-based try-catch just works
try {
    $result = $api->dangerousOperation();
} catch (TimeoutException $e) {
    $api->reconnect();
    retry();
}
```

### Exposing Local Objects as RPC Targets

```php
<?php

use CapnWeb\Attribute\RpcTarget;
use CapnWeb\Attribute\RpcMethod;
use CapnWeb\Attribute\RpcProperty;

#[RpcTarget]
class NotificationHandler
{
    #[RpcMethod]
    public function onNotification(string $type, array $data): void
    {
        echo "Received: {$type}";
    }

    #[RpcProperty(readable: true)]
    public readonly string $clientId;

    // Private methods/properties NOT exposed
    private function internalMethod(): void { }
}

// Register as callback target
$handler = new NotificationHandler();
$api->registerNotificationHandler($handler);

// Or pass directly - becomes a stub reference
$api->subscribe('events', $handler);
```

---

## Approach 2: Amp/ReactPHP Async with Typed Proxies

**Philosophy**: Embrace the PHP async ecosystem (Amp v3 or ReactPHP), use code generation for typed stubs, explicit promise handling.

**Inspirations**: Amp HTTP Client, gRPC PHP, Twirp

### Connection/Session Creation

```php
<?php

use CapnWeb\Client;
use CapnWeb\Session;
use Amp\Websocket\Client\WebsocketHandshake;
use function Amp\async;
use function Amp\await;

// Amp-style async connection
$session = await(Client::connect('wss://api.example.com/rpc'));

// Get typed stub (interface generated from schema or inferred)
/** @var ApiStub $api */
$api = $session->getStub(ApiStub::class);

// ReactPHP style with event loop
$loop = React\EventLoop\Loop::get();
$client = new CapnWeb\ReactClient($loop);

$client->connect('wss://api.example.com/rpc')
    ->then(function (Session $session) {
        return $session->getStub(ApiStub::class);
    })
    ->then(function (ApiStub $api) {
        return $api->users()->get(123);
    })
    ->then(function (User $user) {
        echo $user->name;
    });

$loop->run();
```

### Making RPC Calls

```php
<?php

use function Amp\async;
use function Amp\await;
use function Amp\Future\awaitAll;

// Amp v3 style - explicit async/await
$user = await($api->users()->get(123));

// Parallel calls
[$user1, $user2] = awaitAll([
    async(fn() => $api->users()->get(1)),
    async(fn() => $api->users()->get(2)),
]);

// Cancellation support
$cancellation = new Amp\TimeoutCancellation(5.0);
try {
    $result = await($api->slowOperation(), $cancellation);
} catch (Amp\CancelledException $e) {
    echo "Operation timed out";
}

// ReactPHP style - promise chains
$api->users()->get(123)
    ->then(fn(User $user) => $user->name)
    ->then(fn(string $name) => echo $name);
```

### Pipelining Syntax

```php
<?php

// Builder pattern for pipelining - explicit, readable
$pipeline = $api->pipeline()
    ->push($api->authenticate($token))
    ->push(fn(AuthResult $auth) => $api->getUser($auth->userId))
    ->push(fn(User $user) => $user->profile())
    ->execute();

// Fluent chaining with ->pipe()
$profile = await(
    $api->authenticate($token)
        ->pipe(fn($auth) => $auth->getUser())
        ->pipe(fn($user) => $user->profile())
);

// Promise property access returns new promise
$userPromise = $api->authenticate($token)->then(fn($a) => $a->user);
$profilePromise = $userPromise->then(fn($u) => $u->profile);

// Shorthand: ->prop() for property pipelining
$name = await(
    $api->authenticate($token)
        ->prop('user')
        ->prop('profile')
        ->prop('displayName')
);
```

### Typed Stub Generation

```php
<?php

// Generated stub interface (via CLI tool or runtime reflection)
interface ApiStub extends \CapnWeb\Stub
{
    public function authenticate(string $token): Promise<AuthResult>;
    public function users(): UsersStub;
    public function getUserProfile(int|Promise<int> $userId): Promise<UserProfile>;
}

interface UsersStub extends \CapnWeb\Stub
{
    public function get(int $id): Promise<User>;
    public function list(array $filters = []): Promise<array>;
    public function create(CreateUserDto $data): Promise<User>;
}

// Runtime proxy generation (no codegen needed)
$api = $session->getStub(new class implements ApiStub {
    // PHPDoc types used for serialization hints
    /** @return Promise<User> */
    public function getUser(int $id): Promise { }
});
```

### Error Handling

```php
<?php

use CapnWeb\Exception\RpcException;
use CapnWeb\Exception\RpcError;

// Typed error matching
try {
    $user = await($api->users()->get(999));
} catch (RpcError $e) {
    match ($e->type) {
        'NotFoundError' => handleNotFound($e),
        'PermissionDenied' => handleForbidden($e),
        default => throw $e,
    };
}

// Promise rejection handling (ReactPHP style)
$api->users()->get(999)
    ->otherwise(fn(RpcException $e) => match ($e->type) {
        'NotFoundError' => null,
        default => throw $e,
    })
    ->then(fn(?User $user) => $user ?? createDefaultUser());
```

### Exposing Local Objects as RPC Targets

```php
<?php

use CapnWeb\RpcTarget;
use CapnWeb\Attribute\Expose;

// Implement RpcTarget interface for pass-by-reference
class ChatHandler implements RpcTarget
{
    #[Expose]
    public function onMessage(string $from, string $content): void
    {
        echo "[{$from}]: {$content}\n";
    }

    #[Expose]
    public function onTyping(string $user): void
    {
        echo "{$user} is typing...\n";
    }

    // Disposal hook - called when remote releases reference
    public function __dispose(): void
    {
        echo "Handler released\n";
    }
}

// Pass to server - becomes remote reference
await($api->chat()->subscribe(new ChatHandler()));
```

---

## Approach 3: Laravel-Style Fluent Builder with Facades

**Philosophy**: Maximum developer ergonomics via facades, fluent API, and implicit batching. Feels like Eloquent for RPC.

**Inspirations**: Laravel HTTP Client, Eloquent Builder, Laravel Pennant

### Connection/Session Creation

```php
<?php

use CapnWeb\Facades\Rpc;

// Global facade (configured via service provider)
// config/capnweb.php defines connections
$user = Rpc::connection('api')->users->get(123);

// Or default connection
$user = Rpc::users->get(123);

// Inline connection
$user = Rpc::connect('wss://api.example.com')
    ->users
    ->get(123);

// Laravel service provider auto-configuration
// In AppServiceProvider:
public function boot(): void
{
    Rpc::configure([
        'default' => 'main',
        'connections' => [
            'main' => [
                'url' => env('RPC_URL'),
                'transport' => 'websocket',
            ],
        ],
    ]);
}
```

### Making RPC Calls

```php
<?php

use CapnWeb\Facades\Rpc;

// Fluent, chainable syntax
$user = Rpc::users->find(123);
$users = Rpc::users->where('status', 'active')->get();

// Batch multiple calls explicitly
$results = Rpc::batch(function ($rpc) {
    $user = $rpc->users->get(1);
    $posts = $rpc->posts->where('author', 1)->get();

    return compact('user', 'posts');
});

echo $results['user']->name;

// Retry with exponential backoff
$result = Rpc::retry(3, 100)->users->get(123);

// Timeout configuration
$result = Rpc::timeout(5)->users->get(123);

// Cache RPC results (Laravel Cache integration)
$user = Rpc::cache(ttl: 3600)->users->get(123);
```

### Pipelining Syntax

```php
<?php

use CapnWeb\Facades\Rpc;

// Automatic pipelining via deferred resolution
$auth = Rpc::authenticate($token);          // Not awaited yet
$profile = Rpc::users->getProfile($auth->userId);  // Pipelined!
$friends = $auth->user->friends->list();    // Also pipelined

// Resolve all at once - single round trip
$results = Rpc::resolve($profile, $friends);

// Method chaining IS pipelining
$displayName = Rpc::authenticate($token)
    ->getUser()
    ->profile
    ->displayName
    ->get();  // ->get() triggers resolution

// Through() for transformation
$avatar = Rpc::users->get(123)
    ->through(fn($user) => $user->profile)
    ->through(fn($profile) => $profile->avatar)
    ->get();

// Map over collections (server-side)
$names = Rpc::users->list()
    ->map(fn($user) => $user->name)
    ->get();
```

### Error Handling

```php
<?php

use CapnWeb\Facades\Rpc;
use CapnWeb\Exceptions\RpcException;

// Laravel-style exception handling
Rpc::users->get(123)
    ->throw()  // Throw on any error
    ->json();

// Conditional throwing
Rpc::users->get(123)
    ->throwIf(fn($response) => $response->isEmpty())
    ->throwUnless(fn($response) => $response->isValid());

// Rescue pattern
$user = Rpc::users->get(123)
    ->rescue(fn(RpcException $e) => User::guest());

// onError callback (doesn't break chain)
Rpc::users->get(123)
    ->onError(fn($e) => Log::error('RPC failed', ['error' => $e]))
    ->get();

// Exception transformers
Rpc::mapException(function (RpcException $e) {
    return match ($e->type) {
        'NotFoundError' => new ModelNotFoundException($e->getMessage()),
        'ValidationError' => new ValidationException($e->data),
        default => $e,
    };
});
```

### Exposing Local Objects as RPC Targets

```php
<?php

use CapnWeb\Contracts\Targetable;
use CapnWeb\Facades\Rpc;

// Trait-based approach for Laravel models/classes
class NotificationHandler implements Targetable
{
    use \CapnWeb\Concerns\AsRpcTarget;

    // Methods prefixed with 'rpc' are exposed
    public function rpcOnNotification(string $type, mixed $data): void
    {
        event(new NotificationReceived($type, $data));
    }

    // Or use attribute
    #[\CapnWeb\Attributes\Rpc]
    public function handleEvent(string $event): void
    {
        // ...
    }
}

// Closure-based callbacks
Rpc::events->subscribe(
    Rpc::callback(function (string $event, array $data) {
        broadcast(new ServerEvent($event, $data));
    })
);

// Anonymous target with array syntax
Rpc::events->subscribe(Rpc::target([
    'onMessage' => fn($msg) => broadcast($msg),
    'onError' => fn($err) => Log::error($err),
]));
```

---

## Approach 4: Attribute-Driven with Swoole Coroutines

**Philosophy**: High-performance with Swoole coroutines, attribute-based configuration, connection pooling, and zero-copy where possible.

**Inspirations**: Hyperf Framework, Swoole HTTP Client, PHP-PM

### Connection/Session Creation

```php
<?php

use CapnWeb\Client;
use CapnWeb\Pool\ConnectionPool;
use CapnWeb\Attribute\Connection;

// Coroutine-aware client (auto-detects Swoole)
$client = new Client('wss://api.example.com/rpc');
$api = $client->getStub();

// Connection pooling for high concurrency
$pool = new ConnectionPool(
    factory: fn() => Client::connect('wss://api.example.com/rpc'),
    minConnections: 5,
    maxConnections: 50,
    idleTimeout: 30,
);

// Automatic pool management via coroutine context
$user = $pool->execute(fn($api) => $api->users->get(123));

// Attribute-based configuration on classes
#[Connection(
    url: 'wss://api.example.com/rpc',
    pool: true,
    maxConnections: 20,
)]
class UserService
{
    public function __construct(
        private readonly ApiStub $api,  // Auto-injected from pool
    ) {}

    public function getUser(int $id): User
    {
        return $this->api->users->get($id);
    }
}
```

### Making RPC Calls (Coroutine-Based)

```php
<?php

use function Swoole\Coroutine\run;
use function Swoole\Coroutine\go;
use function Swoole\Coroutine\batch;
use CapnWeb\Client;

run(function () {
    $api = Client::connect('wss://api.example.com/rpc')->getStub();

    // Coroutine-transparent calls (looks sync, is async)
    $user = $api->users->get(123);
    echo $user->name;

    // Parallel coroutines
    $results = batch([
        'user' => fn() => $api->users->get(1),
        'posts' => fn() => $api->posts->list(['limit' => 10]),
        'stats' => fn() => $api->analytics->summary(),
    ]);

    // WaitGroup for coordination
    $wg = new \Swoole\Coroutine\WaitGroup();
    $users = [];

    foreach ([1, 2, 3, 4, 5] as $id) {
        $wg->add();
        go(function () use ($api, $id, &$users, $wg) {
            $users[$id] = $api->users->get($id);
            $wg->done();
        });
    }

    $wg->wait();
});
```

### Pipelining Syntax

```php
<?php

use CapnWeb\Pipeline;
use CapnWeb\Attribute\Pipeline as PipelineAttr;

// Explicit pipeline builder
$pipeline = Pipeline::create($api)
    ->call('authenticate', [$token])
    ->then(fn($auth) => ['getUser', [$auth->userId]])
    ->then(fn($user) => ['fetchProfile', [$user->id]])
    ->execute();

// Attribute-based pipeline definition
#[PipelineAttr]
class AuthenticatedProfilePipeline
{
    public function __construct(
        private readonly string $token,
    ) {}

    #[PipelineAttr\Step(1)]
    public function authenticate(ApiStub $api): mixed
    {
        return $api->authenticate($this->token);
    }

    #[PipelineAttr\Step(2)]
    public function getUser(ApiStub $api, $auth): mixed
    {
        return $api->users->get($auth->userId);
    }

    #[PipelineAttr\Step(3)]
    public function getProfile(ApiStub $api, User $user): mixed
    {
        return $user->profile;
    }
}

$profile = Pipeline::run(new AuthenticatedProfilePipeline($token), $api);

// Channel-based streaming
$channel = $api->events->stream()->toChannel();

go(function () use ($channel) {
    while ($event = $channel->pop()) {
        processEvent($event);
    }
});
```

### Error Handling

```php
<?php

use CapnWeb\Exception\RpcException;
use CapnWeb\Attribute\RetryPolicy;
use CapnWeb\Attribute\Timeout;
use CapnWeb\Attribute\CircuitBreaker;

// Attribute-based resilience
#[RetryPolicy(maxAttempts: 3, delay: 100, multiplier: 2.0)]
#[Timeout(seconds: 5)]
#[CircuitBreaker(failureThreshold: 5, recoveryTime: 30)]
class ResilientUserService
{
    public function __construct(private readonly ApiStub $api) {}

    public function getUser(int $id): User
    {
        return $this->api->users->get($id);
    }
}

// Manual circuit breaker
$breaker = new CircuitBreaker(
    failureThreshold: 5,
    recoveryTime: 30,
);

try {
    $user = $breaker->execute(fn() => $api->users->get(123));
} catch (CircuitOpenException $e) {
    return User::fallback();
}

// Coroutine-aware exception handling with defer
$api = Client::connect('wss://api.example.com/rpc')->getStub();

defer(function () use ($api) {
    $api->close();
});

try {
    $user = $api->users->get(999);
} catch (RpcException $e) {
    if ($e->isRetryable()) {
        // Exponential backoff via coroutine sleep
        \Swoole\Coroutine::sleep(pow(2, $attempt) * 0.1);
        retry();
    }
    throw $e;
}
```

### Exposing Local Objects as RPC Targets

```php
<?php

use CapnWeb\Attribute\RpcTarget;
use CapnWeb\Attribute\RpcMethod;
use CapnWeb\Attribute\Disposable;
use CapnWeb\Contract\RpcTargetInterface;

#[RpcTarget]
class StreamingHandler implements RpcTargetInterface
{
    private \Swoole\Coroutine\Channel $channel;

    public function __construct()
    {
        $this->channel = new \Swoole\Coroutine\Channel(100);
    }

    #[RpcMethod]
    public function onData(array $chunk): void
    {
        $this->channel->push($chunk);
    }

    #[RpcMethod]
    public function onComplete(): void
    {
        $this->channel->close();
    }

    #[RpcMethod]
    public function onError(string $message): void
    {
        $this->channel->push(new \Exception($message));
        $this->channel->close();
    }

    #[Disposable]
    public function dispose(): void
    {
        // Cleanup when remote releases reference
        $this->channel->close();
    }

    public function getChannel(): \Swoole\Coroutine\Channel
    {
        return $this->channel;
    }
}

// Usage
$handler = new StreamingHandler();
$api->data->stream('large-dataset', $handler);

// Consume in coroutine
go(function () use ($handler) {
    while (($data = $handler->getChannel()->pop()) !== false) {
        if ($data instanceof \Exception) {
            throw $data;
        }
        processChunk($data);
    }
});
```

---

## Summary Comparison

| Feature | Approach 1: Fibers | Approach 2: Amp/React | Approach 3: Laravel | Approach 4: Swoole |
|---------|-------------------|----------------------|--------------------|--------------------|
| **Async Model** | Fibers (transparent) | Explicit promises | Deferred/Batch | Coroutines |
| **Syntax Style** | Magic methods | Typed stubs | Fluent builder | Attributes |
| **Pipelining** | Automatic chaining | Builder pattern | Method chains | Pipeline classes |
| **Learning Curve** | Low | Medium | Low (Laravel devs) | Medium-High |
| **Performance** | Good | Good | Good | Excellent |
| **IDE Support** | Limited (magic) | Excellent (types) | Good (Laravel) | Good |
| **Ecosystem** | Standalone | Amp/ReactPHP | Laravel | Swoole/Hyperf |

---

## Recommended Hybrid Approach

For the `dotdo/capnweb` package, consider combining the best elements:

1. **Core**: Fiber-based async (Approach 1) for sync-looking code
2. **Types**: Generated stub interfaces (Approach 2) for IDE support
3. **DX**: Fluent builder API (Approach 3) for ergonomics
4. **Performance**: Swoole adapter (Approach 4) for high-load scenarios

```php
<?php

use CapnWeb\Session;

// Simple usage (Fiber-based, sync-looking)
$api = Session::connect('wss://api.example.com/rpc');
$user = $api->users->get(123);

// Typed stub for IDE support
/** @var UserService $users */
$users = $api->users;
$user = $users->get(123);  // Full autocomplete!

// Fluent builder for complex queries
$result = $api->users
    ->where('active', true)
    ->with('profile', 'friends')
    ->pipeline(fn($user) => $user->enrichWithAnalytics())
    ->get();

// Attribute-based targets
#[RpcTarget]
class MyHandler {
    #[RpcMethod]
    public function onEvent(Event $e): void { }
}
```

This hybrid approach would provide:
- **Zero-boilerplate** for simple cases
- **Full typing** when needed
- **Maximum ergonomics** for complex workflows
- **High performance** in production environments
