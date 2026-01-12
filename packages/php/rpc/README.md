# rpc.do

[![Packagist Version](https://img.shields.io/packagist/v/rpc.do/sdk)](https://packagist.org/packages/rpc.do/sdk)
[![PHP Version](https://img.shields.io/packagist/php-v/rpc.do/sdk)](https://packagist.org/packages/rpc.do/sdk)
[![License](https://img.shields.io/packagist/l/rpc.do/sdk)](https://packagist.org/packages/rpc.do/sdk)

**The magic proxy that makes any `.do` service feel like native PHP.**

```php
use RpcDo\Client;

$api = Client::connect(url: 'wss://mongo.do');

// Call any method - no schema required
$users = $api->users->find(active: true);
$profile = $api->users->findOne(id: 123)->profile->settings;
```

One connection. Zero boilerplate. Full pipelining.

---

## What is rpc.do?

`rpc.do` is the managed RPC layer for the `.do` ecosystem in PHP. It sits between raw [capnweb](https://packagist.org/packages/dotdo/capnweb) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `$api->anything->you->want()` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Authenticate seamlessly** - Integrates with `oauth.do`

```
Your PHP Code
    |
    v
+----------+     +----------+     +-------------+
|  rpc.do  | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Magic proxy ($api->method())
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining
    +--- Auth integration
```

---

## rpc.do vs capnweb

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side `.map()` | Yes | Yes (enhanced) |
| Laravel Facade | No | Yes |
| PSR-18 HTTP Client | No | Yes |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc.do** when you're calling `.do` services and want maximum flexibility.

---

## Installation

```bash
composer require rpc.do/sdk
```

Or with specific version constraints:

```bash
composer require rpc.do/sdk:^1.0
```

### Requirements

- **PHP 8.2+** (Fibers, Enums, Named Arguments, Readonly Classes)
- `ext-json`
- One of: `ext-sockets`, `react/socket`, `amphp/socket` for WebSocket transport

### Optional Dependencies

```bash
# For async operations
composer require react/async react/socket

# For Laravel integration
composer require rpc.do/laravel

# For Symfony integration
composer require rpc.do/symfony
```

---

## Quick Start

### Basic Connection

```php
<?php

declare(strict_types=1);

use RpcDo\Client;

// Connect to any .do service
$client = Client::connect(url: 'wss://api.example.do');

try {
    // Call methods via the magic proxy
    $result = $client->hello(name: 'World');
    echo $result;  // "Hello, World!"
} finally {
    $client->close();
}
```

### With Authentication

```php
use RpcDo\Client;

$client = Client::connect(
    url: 'wss://api.example.do',
    token: 'your-api-key',
    headers: [
        'X-Custom-Header' => 'value',
    ],
);

// Authenticated calls
$user = $client->users->me();
```

### PSR-4 Autoloading

The package follows PSR-4 standards. After installation, classes are automatically available:

```php
use RpcDo\Client;
use RpcDo\Exception\RpcException;
use RpcDo\Exception\ConnectionException;
use RpcDo\Promise\RpcPromise;
use RpcDo\Proxy\MagicProxy;
```

---

## The Magic Proxy

The magic proxy intercepts all property access and method calls, sending them as RPC requests. PHP's `__get` and `__call` magic methods power this seamless experience.

### How It Works

```php
$client = Client::connect(url: 'wss://api.example.do');

// Every property access is recorded
$client                       // MagicProxy
$client->users                // MagicProxy with path ["users"]
$client->users->get           // MagicProxy with path ["users", "get"]
$client->users->get(id: 123)  // RPC call to "users.get" with args [123]
```

The proxy doesn't know what methods exist on the server. It records the path and sends it when you invoke a method.

### Nested Access

Access deeply nested APIs naturally:

```php
// All of these work
$client->users->get(id: 123);
$client->users->profiles->settings->theme->get();
$client->api->v2->admin->users->deactivate(userId: $userId);
```

### Dynamic Keys with ArrayAccess

Use bracket notation for dynamic property names:

```php
$tableName = 'users';
$result = $client->{$tableName}->find(active: true);

// Or with ArrayAccess syntax
$result = $client[$tableName]->find(active: true);

// Equivalent to
$result = $client->users->find(active: true);
```

### Named Arguments (PHP 8+)

PHP's named arguments make RPC calls self-documenting:

```php
// Clear and readable
$user = $client->users->create(
    name: 'Alice',
    email: 'alice@example.com',
    roles: ['admin', 'developer'],
    metadata: ['source' => 'api'],
);

// Compare to positional arguments
$user = $client->users->create('Alice', 'alice@example.com', ['admin', 'developer'], ['source' => 'api']);
```

---

## Promise Pipelining

The killer feature inherited from capnweb. Chain dependent calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response:

```php
// BAD: Three round trips
$session = $api->authenticate(token: $token);     // Wait...
$userId = $session->getUserId();                  // Wait...
$profile = $api->getUserProfile(userId: $userId); // Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```php
// GOOD: One round trip
$session = $api->authenticate(token: $token);     // RpcPromise - not sent yet
$userId = $session->userId;                       // Pipelines through session
$profile = $api->profiles->get(id: $userId);      // Uses userId before it resolves

// Access a concrete value - single round trip for everything
echo $profile->displayName;
```

### How Pipelining Works

1. **Recording phase**: Method calls return `RpcPromise` objects without sending anything
2. **Batching**: When you access a concrete value, rpc.do collects all recorded operations
3. **Single request**: Everything is sent as one batched request
4. **Server resolution**: The server evaluates dependencies and returns results

```php
$client = Client::connect(url: 'wss://api.example.do');

// Build the pipeline (no network yet)
$auth = $client->authenticate(token: $token);
$user = $auth->getUser();
$profile = $user->profile;
$settings = $profile->settings;

// Access concrete value triggers network (one round trip)
echo $settings->theme;
```

### Explicit Pipeline Resolution

For more control, explicitly resolve pipelines:

```php
use function RpcDo\await;

// Build pipeline
$profile = $client->authenticate(token: $token)->user->profile;

// Do other work...
prepareTemplate();
loadAssets();

// Explicitly await when needed
$resolvedProfile = await($profile);
echo $resolvedProfile->displayName;
```

### Parallel Pipelines with all()

Fork a pipeline to fetch multiple things at once:

```php
use RpcDo\Client;

$client = Client::connect(url: 'wss://api.example.do');

// Start with authentication
$session = $client->authenticate(token: $token);

// Branch into parallel requests (still one round trip!)
[$user, $permissions, $settings] = $client->all(
    $session->getUser(),
    $session->getPermissions(),
    $session->getSettings(),
);

// Or with named keys
$results = $client->all(
    user: $session->getUser(),
    permissions: $session->getPermissions(),
    settings: $session->getSettings(),
);

echo "Welcome, {$results['user']->name}!";
```

---

## Capabilities

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object.

### Creating Capabilities

```php
// Server returns a capability reference
$counter = $client->makeCounter(initial: 10);

// counter is now a proxy to the remote Counter object
echo $counter->getCapabilityId();  // e.g., "cap_abc123"

// Call methods on the capability
$value = $counter->value();          // 10
$newValue = $counter->increment(5);  // 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```php
// Create two counters
$counter1 = $client->makeCounter(initial: 10);
$counter2 = $client->makeCounter(initial: 20);

// Pass counter1 to a method
$result = $client->addCounters(a: $counter1, b: $counter2);
echo $result;  // 30
```

### Capability Lifecycle

Capabilities are automatically serialized when passed over RPC:

```php
// When you pass a capability...
$client->doSomething(counter: $counter);

// rpc.do converts it to: {"$ref": "cap_abc123"}
// The server knows to look up the capability and use that object
```

### Disposing Capabilities

Release remote resources when done:

```php
use RpcDo\Capability;

$connection = $client->database->connect(dsn: $dsn);

try {
    $result = $connection->query(sql: 'SELECT * FROM users');
    processResults($result);
} finally {
    // Release the remote connection
    Capability::dispose($connection);
}
```

---

## Server-Side Map

Transform collections on the server to avoid N+1 round trips.

### The N+1 Problem

```php
// BAD: N+1 round trips
$userIds = $client->listUserIds();  // 1 round trip
$profiles = [];

foreach ($userIds as $id) {
    $profiles[] = $client->getProfile(id: $id);  // N round trips
}
```

### The Solution: serverMap

```php
// GOOD: 1 round trip total
$userIds = $client->listUserIds();

$profiles = $client->serverMap(
    items: $userIds,
    expression: 'id => self.getProfile(id)',
    captures: ['self' => $client->getSelf()],
);
```

### How serverMap Works

1. **Expression serialization**: Your lambda is converted to a string expression
2. **Capture list**: Referenced capabilities (like `self`) are sent along
3. **Server execution**: The server applies the expression to each array element
4. **Single response**: All results return in one response

### RpcPromise::map() Method

For cleaner syntax when chaining:

```php
// Get numbers and square them server-side
$squared = $client->generateFibonacci(count: 10)
    ->map(
        expression: 'x => self.square(x)',
        captures: ['self' => $client->getSelf()],
    );

print_r($squared);  // [0, 1, 1, 4, 9, 25, ...]
```

### Map Constraints

The map expression has restrictions for security:

| Allowed | Not Allowed |
|---------|-------------|
| Property access | Arbitrary code execution |
| Method calls on captured refs | Closures |
| Simple expressions | Local variables |
| Captured capability refs | Side effects |

```php
// GOOD: Simple expression with captured ref
'x => self.transform(x)'

// GOOD: Property access
'user => user.profile.name'

// BAD: Arbitrary code (won't work)
'x => someLocalFunction(x)'

// BAD: PHP closures (won't work)
fn($x) => $x * 2
```

---

## Error Handling

rpc.do provides typed exceptions using PHP 8.1 enums for different failure scenarios.

### Error Type Enum

```php
namespace RpcDo;

enum ErrorType: string
{
    case NotFound = 'not_found';
    case Unauthorized = 'unauthorized';
    case Forbidden = 'forbidden';
    case ValidationError = 'validation_error';
    case RateLimited = 'rate_limited';
    case Timeout = 'timeout';
    case ConnectionLost = 'connection_lost';
    case ServerError = 'server_error';
    case CapabilityExpired = 'capability_expired';
    case Unknown = 'unknown';
}
```

### Exception Hierarchy

```php
use RpcDo\Exception\{
    RpcException,           // Base class for all RPC errors
    ConnectionException,    // Network failures
    TimeoutException,       // Request timeouts
    ValidationException,    // Invalid arguments
    CapabilityException,    // Invalid/expired capabilities
};
use RpcDo\ErrorType;

try {
    $user = $client->users->get(id: 999);
} catch (ValidationException $e) {
    // Access structured validation errors
    foreach ($e->violations as $field => $messages) {
        echo "{$field}: " . implode(', ', $messages) . "\n";
    }
} catch (TimeoutException $e) {
    // Retry with backoff
    retry(fn() => $client->users->get(id: 999), maxAttempts: 3);
} catch (ConnectionException $e) {
    // Reconnect
    $client->reconnect();
} catch (RpcException $e) {
    // Generic RPC error with enum type
    match ($e->type) {
        ErrorType::NotFound => handleMissing($e->path),
        ErrorType::Unauthorized => redirect('/login'),
        ErrorType::RateLimited => sleep($e->retryAfter),
        ErrorType::ServerError => logAndRetry($e),
        default => throw $e,
    };
}
```

### Error Propagation

Errors from the server are deserialized and re-thrown with full context:

```php
try {
    $client->riskyOperation();
} catch (RpcException $e) {
    echo "Error type: {$e->type->value}\n";    // "not_found"
    echo "Message: {$e->getMessage()}\n";      // "User not found"
    echo "Method: {$e->rpcMethod}\n";          // "users.get"
    echo "Code: {$e->getCode()}\n";            // 404

    // Access additional error data
    if ($e->data !== null) {
        print_r($e->data);  // ['userId' => 999]
    }
}
```

### Retry Patterns

Implement exponential backoff for transient failures:

```php
use RpcDo\Exception\{ConnectionException, TimeoutException, RpcException};
use RpcDo\Retry;

// Built-in retry helper
$result = Retry::exponential(
    fn() => $client->users->get(id: 123),
    maxAttempts: 5,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    multiplier: 2.0,
    retryOn: [ConnectionException::class, TimeoutException::class],
);

// Or manual implementation
function withRetry(callable $fn, int $maxAttempts = 3, int $baseDelayMs = 1000): mixed
{
    $lastException = null;

    for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
        try {
            return $fn();
        } catch (RpcException $e) {
            $lastException = $e;

            // Don't retry client errors
            if ($e->type === ErrorType::ValidationError) {
                throw $e;
            }

            // Retry connection and timeout errors
            if ($e instanceof ConnectionException || $e instanceof TimeoutException) {
                $delayMs = $baseDelayMs * (2 ** $attempt);
                usleep($delayMs * 1000);
                continue;
            }

            throw $e;
        }
    }

    throw $lastException;
}

// Usage
$result = withRetry(fn() => $client->users->get(id: 123));
```

---

## Async with ReactPHP

For high-concurrency applications, rpc.do integrates with ReactPHP.

### Setup

```bash
composer require react/async react/socket
```

### Basic Async Usage

```php
use RpcDo\Async\AsyncClient;
use function React\Async\await;
use function React\Async\async;

$client = AsyncClient::connect(url: 'wss://api.example.do');

// Non-blocking calls
$promise1 = $client->users->get(id: 123);
$promise2 = $client->posts->recent(limit: 10);
$promise3 = $client->notifications->unread();

// Await all in parallel
[$user, $posts, $notifications] = await(React\Promise\all([
    $promise1,
    $promise2,
    $promise3,
]));
```

### Concurrent Request Handling

```php
use RpcDo\Async\AsyncClient;
use React\EventLoop\Loop;
use function React\Async\async;
use function React\Async\await;

$client = AsyncClient::connect(url: 'wss://api.example.do');

// Process multiple users concurrently
$userIds = [1, 2, 3, 4, 5];

$promises = array_map(
    fn($id) => async(fn() => $client->users->enrichProfile(id: $id)),
    $userIds,
);

$enrichedProfiles = await(React\Promise\all($promises));
```

### Streaming with ReactPHP

```php
use RpcDo\Async\AsyncClient;
use React\EventLoop\Loop;

$client = AsyncClient::connect(url: 'wss://api.example.do');

// Subscribe to real-time events
$client->events->subscribe(
    topic: 'orders.*',
    callback: function (array $event) {
        echo "[{$event['type']}] " . json_encode($event['data']) . "\n";
    },
);

// Run the event loop
Loop::run();
```

---

## Async with Amp

Alternatively, use Amp for async operations.

### Setup

```bash
composer require amphp/amp amphp/socket
```

### Basic Amp Usage

```php
use RpcDo\Amp\AmpClient;
use function Amp\async;
use function Amp\Future\await;

$client = AmpClient::connect(url: 'wss://api.example.do');

// Non-blocking calls return Futures
$future1 = async(fn() => $client->users->get(id: 123));
$future2 = async(fn() => $client->posts->recent(limit: 10));
$future3 = async(fn() => $client->notifications->unread());

// Await all
[$user, $posts, $notifications] = await([$future1, $future2, $future3]);
```

### Cancellation Support

```php
use Amp\CancelledException;
use Amp\TimeoutCancellation;

try {
    $result = $client->longRunningOperation(
        data: $largeDataset,
        cancellation: new TimeoutCancellation(seconds: 30),
    );
} catch (CancelledException) {
    echo "Operation timed out after 30 seconds\n";
}
```

---

## Type Safety with PHPDoc

The dynamic proxy gives flexibility. PHPDoc gives IDE autocomplete and static analysis.

### Interface Stubs

Define interfaces for full PHPStan/Psalm support:

```php
/**
 * @method UserService users()
 * @method PostService posts()
 * @method AuthResult authenticate(string $token)
 */
interface ApiStub {}

interface UserService
{
    public function get(int $id): User;

    /** @return iterable<User> */
    public function find(array $criteria): iterable;

    public function create(CreateUserDto $data): User;
}

interface PostService
{
    public function recent(int $limit = 10): array;
    public function byAuthor(int $authorId): array;
}

/** @var ApiStub $api */
$api = Client::connect(url: 'wss://api.example.do');

// Full autocomplete now works
$user = $api->users()->get(id: 123);
```

### Readonly DTOs

```php
readonly class User
{
    public function __construct(
        public int $id,
        public string $name,
        public string $email,
        public ?Profile $profile = null,
        public UserRole $role = UserRole::User,
    ) {}
}

readonly class CreateUserDto
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
        public UserRole $role = UserRole::User,
    ) {}
}

enum UserRole: string
{
    case Admin = 'admin';
    case User = 'user';
    case Guest = 'guest';
}
```

### Generic PHPDoc Annotations

```php
use RpcDo\Client;
use RpcDo\Promise\RpcPromise;

/**
 * @template T
 * @param RpcPromise<T> $promise
 * @return T
 */
function resolvePromise(RpcPromise $promise): mixed
{
    return $promise->resolve();
}

/** @var RpcPromise<User> $userPromise */
$userPromise = $client->users->get(id: 123);

/** @var User $user */
$user = resolvePromise($userPromise);
```

---

## Laravel Integration

Full-featured Laravel integration with Service Provider, Facade, Queue jobs, and Artisan commands.

### Installation

```bash
composer require rpc.do/laravel
php artisan vendor:publish --provider="RpcDo\Laravel\ServiceProvider"
```

### Configuration

```php
// config/rpcdo.php
return [
    'default' => env('RPCDO_CONNECTION', 'main'),

    'connections' => [
        'main' => [
            'url' => env('RPCDO_URL', 'wss://api.example.do'),
            'token' => env('RPCDO_TOKEN'),
            'timeout' => 30,
            'reconnect' => true,
        ],
        'analytics' => [
            'url' => env('RPCDO_ANALYTICS_URL'),
            'timeout' => 60,
        ],
    ],

    'reconnect' => [
        'enabled' => true,
        'max_attempts' => 5,
        'delay_ms' => 1000,
    ],
];
```

### Facade Usage

```php
use RpcDo\Facades\Rpc;

// Simple calls
$user = Rpc::users()->get(id: 123);

// Named connection
$analytics = Rpc::connection('analytics');
$report = $analytics->reports->generate(
    startDate: now()->subMonth(),
    endDate: now(),
);

// Pipelining works transparently
$profile = Rpc::authenticate(token: $token)->user->profile;
```

### Dependency Injection

```php
namespace App\Http\Controllers;

use RpcDo\Client;
use App\Http\Requests\CreateUserRequest;

class UserController extends Controller
{
    public function __construct(
        private readonly Client $rpc,
    ) {}

    public function show(int $id)
    {
        $user = $this->rpc->users->get(id: $id);
        return view('users.show', compact('user'));
    }

    public function store(CreateUserRequest $request)
    {
        $user = $this->rpc->users->create(
            name: $request->name,
            email: $request->email,
            password: $request->password,
        );

        return redirect()
            ->route('users.show', $user->id)
            ->with('success', 'User created successfully.');
    }
}
```

### Queue Integration

Process RPC calls in background jobs:

```php
namespace App\Jobs;

use RpcDo\Facades\Rpc;
use RpcDo\Exception\RpcException;
use RpcDo\ErrorType;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Throwable;

class SyncUserToExternalService implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(
        public readonly int $userId,
    ) {}

    public function handle(): void
    {
        $user = Rpc::users()->get(id: $this->userId);

        Rpc::connection('external')->users->sync(
            externalId: $user->externalId,
            data: [
                'name' => $user->name,
                'email' => $user->email,
                'metadata' => $user->metadata,
            ],
        );
    }

    public function failed(Throwable $e): void
    {
        if ($e instanceof RpcException && $e->type === ErrorType::NotFound) {
            // User was deleted, skip sync
            return;
        }

        throw $e;
    }
}

// Dispatch
SyncUserToExternalService::dispatch(userId: 123);
```

### Artisan Commands

```php
namespace App\Console\Commands;

use RpcDo\Facades\Rpc;
use RpcDo\Exception\ConnectionException;
use Illuminate\Console\Command;

class RpcHealthCheck extends Command
{
    protected $signature = 'rpc:health {--connection=}';
    protected $description = 'Check RPC connection health';

    public function handle(): int
    {
        $connection = $this->option('connection') ?? config('rpcdo.default');

        try {
            $api = Rpc::connection($connection);
            $health = $api->health->check();

            $this->info("Connection: {$connection}");
            $this->info("Status: {$health->status}");
            $this->info("Latency: {$health->latencyMs}ms");

            return self::SUCCESS;
        } catch (ConnectionException $e) {
            $this->error("Failed to connect: {$e->getMessage()}");
            return self::FAILURE;
        }
    }
}
```

Built-in Artisan commands:

```bash
# Check connection health
php artisan rpc:health

# List available services
php artisan rpc:services

# Call an RPC method
php artisan rpc:call users.get --arg id=123

# Generate type stubs from server
php artisan rpc:generate-stubs
```

### Middleware

```php
namespace App\Http\Middleware;

use RpcDo\Facades\Rpc;
use Closure;
use Illuminate\Http\Request;

class InjectRpcSession
{
    public function handle(Request $request, Closure $next)
    {
        if ($token = $request->bearerToken()) {
            $session = Rpc::authenticate(token: $token);
            $request->attributes->set('rpc_session', $session);
        }

        return $next($request);
    }
}
```

### Event Broadcasting

```php
// app/Listeners/BroadcastRpcEvents.php
namespace App\Listeners;

use RpcDo\Attribute\RpcTarget;
use RpcDo\Facades\Rpc;

#[RpcTarget]
class BroadcastRpcEvents
{
    public function __invoke(string $channel, array $data): void
    {
        broadcast(new RpcEvent($channel, $data));
    }
}

// Register in service provider
Rpc::events()->subscribe(
    topics: ['orders.*', 'users.*'],
    handler: new BroadcastRpcEvents(),
);
```

---

## Symfony Integration

```bash
composer require rpc.do/symfony
```

### Configuration

```yaml
# config/packages/rpcdo.yaml
rpcdo:
    default_connection: main
    connections:
        main:
            url: '%env(RPCDO_URL)%'
            token: '%env(RPCDO_TOKEN)%'
            timeout: 30
        analytics:
            url: '%env(RPCDO_ANALYTICS_URL)%'
            timeout: 60
```

### Autowiring

```php
namespace App\Controller;

use RpcDo\Client;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Annotation\Route;

class UserController extends AbstractController
{
    public function __construct(
        private readonly Client $rpc,
    ) {}

    #[Route('/users/{id}', name: 'user_show')]
    public function show(int $id): Response
    {
        $user = $this->rpc->users->get(id: $id);

        return $this->render('user/show.html.twig', [
            'user' => $user,
        ]);
    }
}
```

### Named Connections

```php
use RpcDo\Symfony\Connection;

class ReportController extends AbstractController
{
    public function __construct(
        #[Connection('analytics')]
        private readonly Client $analytics,
    ) {}

    public function generate(): Response
    {
        $report = $this->analytics->reports->generate(
            startDate: new DateTimeImmutable('-30 days'),
            endDate: new DateTimeImmutable(),
        );

        return $this->json($report);
    }
}
```

### Messenger Integration

```php
namespace App\Message;

class ProcessOrder
{
    public function __construct(
        public readonly int $orderId,
    ) {}
}

// Handler
namespace App\MessageHandler;

use App\Message\ProcessOrder;
use RpcDo\Client;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
class ProcessOrderHandler
{
    public function __construct(
        private readonly Client $rpc,
    ) {}

    public function __invoke(ProcessOrder $message): void
    {
        $order = $this->rpc->orders->get(id: $message->orderId);
        $this->rpc->fulfillment->process(order: $order);
    }
}
```

---

## Exposing Local Objects (RPC Targets)

Let the server call back into your PHP code. Perfect for real-time subscriptions and bidirectional communication.

### Basic RPC Target

```php
use RpcDo\Attribute\{RpcTarget, RpcMethod, RpcProperty};

#[RpcTarget]
class ChatHandler
{
    #[RpcProperty(readable: true)]
    public readonly string $clientId;

    public function __construct()
    {
        $this->clientId = bin2hex(random_bytes(16));
    }

    #[RpcMethod]
    public function onMessage(string $from, string $content): void
    {
        echo "[{$from}]: {$content}\n";
    }

    #[RpcMethod]
    public function onTyping(string $user): void
    {
        echo "{$user} is typing...\n";
    }

    #[RpcMethod]
    public function onPresence(string $user, bool $online): void
    {
        $status = $online ? 'joined' : 'left';
        echo "{$user} {$status} the chat.\n";
    }

    // Called when server releases its reference
    public function __dispose(): void
    {
        echo "Chat handler disposed.\n";
    }
}

$handler = new ChatHandler();
$client->chat->subscribe(handler: $handler);

// The server can now call methods on $handler
```

### Closure Handlers with __invoke

For simple callbacks:

```php
use RpcDo\Attribute\RpcTarget;

// Simple event handler using anonymous class
$client->events->subscribe(
    topic: 'user.created',
    handler: new #[RpcTarget] class {
        public function __invoke(string $type, array $data): void
        {
            echo "[{$type}] " . json_encode($data) . "\n";
        }
    },
);

// Or with a named class
#[RpcTarget]
class EventLogger
{
    public function __construct(
        private readonly LoggerInterface $logger,
    ) {}

    public function __invoke(string $type, array $data): void
    {
        $this->logger->info("Event received", [
            'type' => $type,
            'data' => $data,
        ]);
    }
}

$client->events->subscribe(
    topic: 'order.*',
    handler: new EventLogger($logger),
);
```

---

## Workflows and Sagas

rpc.do supports long-running workflows with compensation (saga pattern):

```php
use RpcDo\Workflow\{Workflow, WorkflowException};
use RpcDo\Attribute\RpcTarget;

#[RpcTarget]
class OrderWorkflow
{
    public function __construct(
        private readonly Client $rpc,
    ) {}

    public function execute(int $userId, array $items): OrderResult
    {
        $workflow = Workflow::create(name: 'order-checkout');

        try {
            // Step 1: Reserve inventory
            $reservation = $workflow->step(
                name: 'reserve-inventory',
                action: fn() => $this->rpc->inventory->reserve(items: $items),
                compensate: fn($res) => $this->rpc->inventory->release(
                    reservationId: $res->id,
                ),
            );

            // Step 2: Charge payment
            $payment = $workflow->step(
                name: 'charge-payment',
                action: fn() => $this->rpc->payments->charge(
                    userId: $userId,
                    amount: $reservation->total,
                ),
                compensate: fn($pay) => $this->rpc->payments->refund(
                    paymentId: $pay->id,
                ),
            );

            // Step 3: Create order
            $order = $workflow->step(
                name: 'create-order',
                action: fn() => $this->rpc->orders->create(
                    userId: $userId,
                    items: $items,
                    paymentId: $payment->id,
                    reservationId: $reservation->id,
                ),
            );

            // Step 4: Send confirmation
            $workflow->step(
                name: 'send-confirmation',
                action: fn() => $this->rpc->notifications->send(
                    userId: $userId,
                    template: 'order-confirmation',
                    data: ['orderId' => $order->id],
                ),
                // No compensation needed - idempotent
            );

            return new OrderResult(
                success: true,
                orderId: $order->id,
            );

        } catch (WorkflowException $e) {
            // Automatic compensation runs in reverse order
            return new OrderResult(
                success: false,
                error: $e->getMessage(),
                compensated: $e->compensatedSteps,
            );
        }
    }
}
```

---

## Generator-Based Streaming

Stream large datasets without loading everything into memory:

```php
use RpcDo\Client;

$client = Client::connect(url: 'wss://api.example.do');

// Stream results as they arrive
foreach ($client->users->stream() as $user) {
    processUser($user);
}

// Stream with filtering
foreach ($client->events->stream(since: $lastEventId) as $event) {
    yield $event;  // Works in your own generators
}

// Chunked streaming for large data
foreach ($client->data->streamChunks(chunkSize: 1000) as $chunk) {
    $this->processBatch($chunk);
}
```

### Async Iterator Pattern

```php
$stream = $client->logs->tail(filter: 'error');

foreach ($stream as $log) {
    echo "[{$log->timestamp}] {$log->message}\n";

    if ($log->severity === 'critical') {
        $stream->close();
        break;
    }
}
```

---

## Connection Configuration

### Full Options

```php
use RpcDo\Client;
use RpcDo\Config;

$config = new Config(
    url: 'wss://api.example.do',
    token: 'your-api-key',
    timeout: 30,
    heartbeatInterval: 15,
    reconnect: true,
    maxReconnectAttempts: 5,
    headers: [
        'X-Request-ID' => bin2hex(random_bytes(8)),
        'X-Client-Version' => '1.0.0',
    ],
);

$client = Client::connect(config: $config);

// Or use named arguments directly
$client = Client::connect(
    url: 'wss://api.example.do',
    token: 'your-api-key',
    timeout: 30,
    reconnect: true,
);
```

### Multiple Connections

Connect to multiple `.do` services simultaneously:

```php
use RpcDo\Client;

// Connect to different services
$mongo = Client::connect(url: 'wss://mongo.do');
$kafka = Client::connect(url: 'wss://kafka.do');
$cache = Client::connect(url: 'wss://cache.do');

// Use them together
$users = $mongo->users->find(active: true);

foreach ($users as $user) {
    $kafka->events->publish(topic: 'user.sync', data: $user);
    $cache->users->set(key: $user->id, value: $user);
}

// Clean up all
$mongo->close();
$kafka->close();
$cache->close();
```

### Connection Pooling

For high-throughput scenarios:

```php
use RpcDo\Pool;

$pool = Pool::create(
    url: 'wss://api.example.do',
    minConnections: 2,
    maxConnections: 10,
);

// Connections are reused
$client = $pool->acquire();

try {
    $user = $client->users->get(id: 123);
} finally {
    $pool->release($client);
}
```

---

## Resource Management

### Connection Lifecycle

Always clean up connections:

```php
$client = Client::connect(url: 'wss://api.example.do');

try {
    // ... use the API
} finally {
    $client->close();
}
```

### Scoped Connections

For automatic cleanup:

```php
use RpcDo\Client;

Client::scoped(
    url: 'wss://api.example.do',
    callback: function (Client $client) {
        $user = $client->users->get(id: 123);
        processUser($user);
    },
);
// Connection automatically closed
```

---

## Testing

### Mock Server

Use the MockServer for unit tests:

```php
use PHPUnit\Framework\TestCase;
use RpcDo\Client;
use RpcDo\Testing\MockServer;

class MyServiceTest extends TestCase
{
    private MockServer $server;
    private Client $client;

    protected function setUp(): void
    {
        $this->server = new MockServer();
        $this->client = Client::connect(server: $this->server);
    }

    public function testCallsMethods(): void
    {
        $this->server->expect('square', [5])->willReturn(25);

        $result = $this->client->square(x: 5);

        $this->assertEquals(25, $result);
    }

    public function testHandlesCapabilities(): void
    {
        $this->server->expect('makeCounter', [10])
            ->willReturnCapability('counter', [
                'value' => fn() => 10,
                'increment' => fn($by) => 10 + $by,
            ]);

        $counter = $this->client->makeCounter(initial: 10);

        $this->assertNotNull($counter->getCapabilityId());
        $this->assertEquals(10, $counter->value());
        $this->assertEquals(15, $counter->increment(by: 5));
    }

    public function testHandlesErrors(): void
    {
        $this->server->expect('users.get', [999])
            ->willThrowRpcError('User not found', 404);

        $this->expectException(RpcException::class);
        $this->client->users->get(id: 999);
    }
}
```

### Mocking with Mockery

```php
use Mockery;
use RpcDo\Client;

$mock = Mockery::mock(Client::class);
$mock->shouldReceive('users->get')
    ->with(Mockery::on(fn($args) => $args['id'] === 123))
    ->andReturn((object) ['id' => 123, 'name' => 'Test User']);

$result = $mock->users->get(id: 123);
$this->assertEquals('Test User', $result->name);
```

---

## PSR Compliance

### PSR-4: Autoloading

```json
{
    "autoload": {
        "psr-4": {
            "RpcDo\\": "src/"
        }
    }
}
```

### PSR-18: HTTP Client (for HTTP batch mode)

```php
use RpcDo\Http\PsrHttpClient;
use Psr\Http\Client\ClientInterface;

// Use any PSR-18 compatible HTTP client
$httpClient = new GuzzleHttp\Client();
$rpcClient = Client::withHttpClient(
    url: 'https://api.example.do/rpc',
    httpClient: new PsrHttpClient($httpClient),
);
```

### PSR-3: Logging

```php
use Psr\Log\LoggerInterface;
use Monolog\Logger;
use Monolog\Handler\StreamHandler;

$logger = new Logger('rpc');
$logger->pushHandler(new StreamHandler('php://stdout'));

$client = Client::connect(
    url: 'wss://api.example.do',
    logger: $logger,
);
```

### PSR-14: Event Dispatcher

```php
use Psr\EventDispatcher\EventDispatcherInterface;
use RpcDo\Event\{RequestEvent, ResponseEvent, ErrorEvent};

$client = Client::connect(
    url: 'wss://api.example.do',
    eventDispatcher: $dispatcher,
);

// Listen for events
$dispatcher->addListener(RequestEvent::class, function (RequestEvent $event) {
    echo "Calling: {$event->method}\n";
});

$dispatcher->addListener(ResponseEvent::class, function (ResponseEvent $event) {
    echo "Response in {$event->durationMs}ms\n";
});

$dispatcher->addListener(ErrorEvent::class, function (ErrorEvent $event) {
    echo "Error: {$event->exception->getMessage()}\n";
});
```

---

## API Reference

### Module Exports

```php
// Main client
use RpcDo\Client;
use RpcDo\Config;

// Promises
use RpcDo\Promise\RpcPromise;

// Proxies
use RpcDo\Proxy\MagicProxy;
use RpcDo\Proxy\CapabilityProxy;

// Exceptions
use RpcDo\Exception\RpcException;
use RpcDo\Exception\ConnectionException;
use RpcDo\Exception\TimeoutException;
use RpcDo\Exception\ValidationException;
use RpcDo\Exception\CapabilityException;

// Enums
use RpcDo\ErrorType;

// Attributes
use RpcDo\Attribute\RpcTarget;
use RpcDo\Attribute\RpcMethod;
use RpcDo\Attribute\RpcProperty;

// Testing
use RpcDo\Testing\MockServer;

// Async (optional)
use RpcDo\Async\AsyncClient;
use RpcDo\Amp\AmpClient;
```

### Client Class

```php
class Client
{
    // Create a new connection
    public static function connect(
        string $url,
        ?string $token = null,
        int $timeout = 30,
        bool $reconnect = true,
        array $headers = [],
        ?LoggerInterface $logger = null,
    ): self;

    // Create with full config
    public static function fromConfig(Config $config): self;

    // Scoped connection with automatic cleanup
    public static function scoped(
        string $url,
        callable $callback,
        array $options = [],
    ): mixed;

    // Get self reference (capability ID 0)
    public function getSelf(): CapabilityProxy;

    // Execute parallel promises
    public function all(RpcPromise ...$promises): array;

    // Race - first result wins
    public function race(RpcPromise ...$promises): mixed;

    // Server-side map operation
    public function serverMap(
        array $items,
        string $expression,
        array $captures = [],
    ): array;

    // Pipeline builder
    public function pipeline(): PipelineBuilder;

    // Close the connection
    public function close(): void;

    // Reconnect
    public function reconnect(): void;

    // Magic property access
    public function __get(string $name): MagicProxy;

    // Magic method calls
    public function __call(string $name, array $arguments): RpcPromise;
}
```

### RpcPromise Class

```php
/**
 * @template T
 */
class RpcPromise
{
    /** @return T */
    public function resolve(): mixed;

    public function get(string $property): RpcPromise;

    public function call(string $method, mixed ...$args): RpcPromise;

    public function map(string $expression, array $captures = []): RpcPromise;

    public function getCapabilityId(): ?string;

    public function getPipelineOps(): array;
}
```

### Error Classes

```php
class RpcException extends Exception
{
    public readonly ErrorType $type;
    public readonly ?string $rpcMethod;
    public readonly mixed $data;
}

class ConnectionException extends RpcException {}
class TimeoutException extends RpcException {}
class ValidationException extends RpcException
{
    /** @var array<string, string[]> */
    public readonly array $violations;
}
class CapabilityException extends RpcException
{
    public readonly ?string $capabilityId;
}
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```php
#!/usr/bin/env php
<?php
/**
 * Complete rpc.do example: A todo application with capabilities,
 * pipelining, server-side mapping, and error handling.
 */

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use RpcDo\Client;
use RpcDo\Exception\{RpcException, CapabilityException};
use RpcDo\ErrorType;
use RpcDo\Attribute\RpcTarget;

// ---- Type Definitions (for IDE support) ----

/**
 * @property-read int $id
 * @property-read string $name
 * @property-read string $email
 */
interface User {}

/**
 * @property-read int $id
 * @property-read string $title
 * @property-read bool $done
 * @property-read int $ownerId
 */
interface Todo {}

// ---- Event Handler ----

#[RpcTarget]
class NotificationHandler
{
    public function __invoke(string $type, array $data): void
    {
        printf("[%s] %s\n", $type, json_encode($data));
    }
}

// ---- Main Application ----

function main(): void
{
    $token = getenv('API_TOKEN') ?: 'demo-token';

    echo "Connecting to Todo API...\n\n";

    $client = Client::connect(
        url: 'wss://todo.example.do',
        token: $token,
        timeout: 30,
    );

    try {
        // ---- Pipelined Authentication ----
        echo "1. Pipelined authentication (one round trip)\n";

        // These calls are pipelined - only one round trip!
        $session = $client->authenticate(token: $token);
        $user = $session->user;
        $todos = $session->todos;

        // Access concrete values triggers the network request
        echo "   Welcome, {$user->name}!\n";

        // ---- Capability Usage ----
        echo "\n2. Using capabilities\n";

        // todos is a capability - we can call methods on it
        $allTodos = $todos->list();
        echo "   You have " . count($allTodos) . " todos\n";

        // Create a new todo
        $newTodo = $todos->add(title: 'Learn rpc.do');
        echo "   Created: \"{$newTodo->title}\" (id: {$newTodo->id})\n";

        // ---- Server-Side Mapping ----
        echo "\n3. Server-side mapping (eliminates N+1)\n";

        // Generate fibonacci numbers and square them - all server-side
        $fibs = $client->generateFibonacci(count: 8);
        echo "   Fibonacci: [" . implode(', ', $fibs) . "]\n";

        $squared = $client->serverMap(
            items: $fibs,
            expression: 'x => self.square(x)',
            captures: ['self' => $client->getSelf()],
        );
        echo "   Squared:   [" . implode(', ', $squared) . "]\n";

        // ---- Parallel Execution ----
        echo "\n4. Parallel execution with all()\n";

        [$recentTodos, $completedCount, $stats] = $client->all(
            $todos->recent(limit: 5),
            $todos->countCompleted(),
            $client->stats->overview(),
        );

        echo "   Recent: " . count($recentTodos) . " todos\n";
        echo "   Completed: {$completedCount}\n";
        echo "   Total users: {$stats->totalUsers}\n";

        // ---- Error Handling ----
        echo "\n5. Error handling\n";

        try {
            $todos->get(id: 99999);
        } catch (RpcException $e) {
            match ($e->type) {
                ErrorType::NotFound => echo "   Expected: Not found error\n",
                default => throw $e,
            };
        }

        // ---- Real-time Subscriptions ----
        echo "\n6. Real-time subscription (10 seconds)\n";

        $handler = new NotificationHandler();
        $client->notifications->subscribe(handler: $handler);

        // Process events for a short time
        $endTime = time() + 10;
        while (time() < $endTime) {
            $client->tick();
            usleep(100_000);  // 100ms
        }

        // ---- Cleanup ----
        echo "\n7. Cleanup\n";

        $todos->delete(id: $newTodo->id);
        echo "   Deleted todo {$newTodo->id}\n";

        echo "\nDone!\n";

    } catch (CapabilityException $e) {
        fprintf(STDERR, "Capability error: %s\n", $e->getMessage());
        exit(1);
    } catch (RpcException $e) {
        fprintf(
            STDERR,
            "RPC Error [%s]: %s\n",
            $e->type->value,
            $e->getMessage(),
        );
        exit(1);
    } finally {
        $client->close();
    }
}

main();
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [dotdo/capnweb](https://packagist.org/packages/dotdo/capnweb) | The underlying RPC protocol |
| [rpc.do/laravel](https://packagist.org/packages/rpc.do/laravel) | Laravel integration |
| [rpc.do/symfony](https://packagist.org/packages/rpc.do/symfony) | Symfony integration |
| [oauth.do/sdk](https://packagist.org/packages/oauth.do/sdk) | OAuth integration for `.do` services |
| [mongo.do/sdk](https://packagist.org/packages/mongo.do/sdk) | MongoDB client built on rpc.do |
| [kafka.do/sdk](https://packagist.org/packages/kafka.do/sdk) | Kafka client built on rpc.do |
| [database.do/sdk](https://packagist.org/packages/database.do/sdk) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Zero boilerplate** | No schemas, no codegen, no build step |
| **Magic when you want it** | `$api->anything()` just works |
| **Types when you need them** | Full PHPDoc support, optional interfaces |
| **One round trip** | Pipelining by default |
| **PHP 8 native** | Named args, enums, attributes, readonly |
| **PSR compliant** | PSR-4, PSR-3, PSR-18, PSR-14 |
| **Framework agnostic** | Works standalone, Laravel, Symfony |

---

## Requirements

- **PHP 8.2+** (Fibers, Enums, Named Arguments, Readonly Classes)
- `ext-json`
- One of: `ext-sockets`, `react/socket`, `amphp/socket` for WebSocket transport

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.

---

## Support

- Documentation: [https://docs.rpc.do](https://docs.rpc.do)
- Issues: [https://github.com/dot-do/sdks/issues](https://github.com/dot-do/sdks/issues)
- Discord: [https://discord.gg/dotdo](https://discord.gg/dotdo)
