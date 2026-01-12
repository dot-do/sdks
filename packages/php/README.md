# capnweb

[![Packagist Version](https://img.shields.io/packagist/v/dotdo/capnweb)](https://packagist.org/packages/dotdo/capnweb)
[![PHP Version](https://img.shields.io/packagist/php-v/dotdo/capnweb)](https://packagist.org/packages/dotdo/capnweb)
[![License](https://img.shields.io/packagist/l/dotdo/capnweb)](https://packagist.org/packages/dotdo/capnweb)

**Capability-based RPC that feels like native PHP.**

```php
$user = $api->users->get(id: 123)->profile->displayName;
```

One statement. One round-trip. Full pipelining. That's it.

---

## What Makes This Different

Cap'n Web brings **promise pipelining** to PHP. Traditional RPC requires a network round-trip for every call. Cap'n Web lets you chain calls that execute in a **single round-trip**:

```php
// One network request. Not four.
$displayName = $api->authenticate(token: $token)
    ->user
    ->profile
    ->displayName;
```

The magic: access properties and call methods on values that don't exist yet. The entire chain is sent to the server at once, and results flow back together.

---

## Installation

```bash
composer require dotdo/capnweb
```

Requires **PHP 8.1+** (Fibers, Enums, Named Arguments).

---

## Quick Start

```php
use CapnWeb\Session;

$api = Session::connect(url: 'wss://api.example.com/rpc');

try {
    // Looks synchronous. Fibers handle async underneath.
    $user = $api->users->get(id: 123);

    // Chain through properties - still one request
    $avatarUrl = $api->users->get(id: 123)->profile->avatar->url;

    // Named arguments for clarity
    $newUser = $api->users->create(
        name: 'Alice',
        email: 'alice@example.com',
        roles: ['admin', 'developer'],
    );

    echo "Welcome, {$newUser->name}!\n";
} finally {
    $api->close();
}
```

Every property access returns an `RpcPromise`. When you access a concrete value, the request fires. Chain without accessing values, and it pipelines automatically.

---

## Pipelining Without Thinking

The killer feature: **chain calls, and they pipeline**.

```php
use CapnWeb\Session;

$api = Session::connect(url: 'wss://api.example.com/rpc');

// These three lines make ONE network request
$auth = $api->authenticate(token: $token);     // RpcPromise - not sent yet
$userId = $auth->userId;                       // Pipelines through auth
$profile = $api->profiles->get(id: $userId);   // Uses userId before it resolves

// Access a concrete value - single round trip for everything
echo $profile->displayName;
```

Compare to traditional RPC:

```php
// Traditional approach - THREE round trips
$auth = $api->authenticate($token);      // Wait...
$userId = $auth->userId;                 // Wait...
$profile = $api->profiles->get($userId); // Wait...
```

Cap'n Web sends the entire call graph in one request. The server resolves dependencies internally.

---

## Connection Types

### WebSocket (Persistent)

```php
use CapnWeb\Session;

$api = Session::connect(
    url: 'wss://api.example.com/rpc',
    timeout: seconds(30),
    reconnect: true,
);
```

### HTTP Batch (Stateless)

```php
$api = Session::batch(
    url: 'https://api.example.com/rpc',
    timeout: seconds(10),
);

// Queue up calls - nothing sent yet
$user = $api->users->get(id: 123);
$posts = $api->posts->recent(limit: 10);
$notifications = $api->notifications->unread();

// Access any result - all three resolve in one HTTP POST
foreach ($posts as $post) {
    echo "{$post->title}\n";
}
```

---

## Generator-Based Streaming

Stream large datasets without loading everything into memory:

```php
use CapnWeb\Session;

$api = Session::connect(url: 'wss://api.example.com/rpc');

// Stream results as they arrive
foreach ($api->users->stream() as $user) {
    processUser($user);
}

// Stream with filtering
foreach ($api->events->stream(since: $lastEventId) as $event) {
    yield $event;  // Works in your own generators
}

// Chunked streaming for large data
foreach ($api->data->streamChunks(chunkSize: 1000) as $chunk) {
    $this->processBatch($chunk);
}
```

### Async Iterator Pattern

```php
$stream = $api->logs->tail(filter: 'error');

foreach ($stream as $log) {
    echo "[{$log->timestamp}] {$log->message}\n";

    if ($log->severity === 'critical') {
        $stream->close();
        break;
    }
}
```

---

## Error Handling with Enums

Cap'n Web uses PHP 8.1 enums for type-safe error handling:

```php
use CapnWeb\Exception\RpcException;
use CapnWeb\ErrorType;

try {
    $user = $api->users->get(id: 999);
} catch (RpcException $e) {
    match ($e->type) {
        ErrorType::NotFound => handleMissing($e->path),
        ErrorType::Unauthorized => redirect('/login'),
        ErrorType::RateLimited => sleep($e->retryAfter),
        ErrorType::ValidationError => showErrors($e->violations),
        ErrorType::ServerError => logAndRetry($e),
        default => throw $e,
    };
}
```

### Error Type Enum

```php
namespace CapnWeb;

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
    case Unknown = 'unknown';
}
```

### Exception Hierarchy

```php
use CapnWeb\Exception\{
    RpcException,           // Base class for all RPC errors
    ConnectionException,    // Network failures
    TimeoutException,       // Request timeouts
    ValidationException,    // Invalid arguments
};

try {
    $result = $api->dangerousOperation();
} catch (ValidationException $e) {
    // Access structured validation errors
    foreach ($e->violations as $field => $messages) {
        echo "{$field}: " . implode(', ', $messages) . "\n";
    }
} catch (TimeoutException $e) {
    // Retry with backoff
    retry(fn() => $api->dangerousOperation(), maxAttempts: 3);
} catch (ConnectionException $e) {
    // Reconnect
    $api->reconnect();
} catch (RpcException $e) {
    // Generic RPC error
    error_log("RPC Error [{$e->type->value}]: {$e->getMessage()}");
}
```

---

## Parallel Execution

Execute independent calls concurrently:

```php
// Parallel with named results
[$user, $posts, $notifications] = $api->all(
    $api->users->get(id: 123),
    $api->posts->recent(limit: 10),
    $api->notifications->unread(),
);

// Named keys for clarity
$results = $api->all(
    user: $api->users->get(id: 123),
    posts: $api->posts->recent(limit: 10),
    notifications: $api->notifications->unread(),
);

echo "Hello, {$results['user']->name}!\n";
echo "You have {$results['notifications']->count()} notifications.\n";
```

### Race Pattern

```php
// First result wins
$fastest = $api->race(
    $api->cache->get(key: 'user:123'),
    $api->database->users->get(id: 123),
);
```

---

## Server-Side Transforms

Execute transforms on the server to minimize data transfer:

```php
// Map: Transform each item server-side
$emails = $api->users->list()->map(fn($user) => $user->email);

// Filter: Server applies predicate
$admins = $api->users->list()->filter(fn($user) => $user->role === 'admin');

// Complex transforms with captured references
$enriched = $api->userIds->map(fn($id) => [
    'id' => $id,
    'profile' => $api->profiles->get(id: $id),
    'avatar' => $api->avatars->get(userId: $id),
    'recentPosts' => $api->posts->byAuthor(authorId: $id)->limit(5),
]);

// Only the final transformed data comes back
foreach ($enriched as $item) {
    renderUserCard($item);
}
```

---

## Exposing Local Objects (RPC Targets)

Let the server call back into your PHP code. Perfect for real-time subscriptions and bidirectional communication.

```php
use CapnWeb\Attribute\{RpcTarget, RpcMethod, RpcProperty};

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
$api->chat->subscribe(handler: $handler);

// The server can now call methods on $handler
```

### Closure Handlers with __invoke

For simple callbacks, use invokable closures:

```php
use CapnWeb\Attribute\RpcTarget;

// Simple event handler
$api->events->subscribe(
    topic: 'user.created',
    handler: new #[RpcTarget] class {
        public function __invoke(string $type, array $data): void
        {
            echo "[{$type}] " . json_encode($data) . "\n";
        }
    },
);

// Or with a typed handler
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

$api->events->subscribe(
    topic: 'order.*',
    handler: new EventLogger($logger),
);
```

---

## Workflows and Sagas

Cap'n Web supports long-running workflows with compensation (saga pattern):

```php
use CapnWeb\Workflow\{Workflow, Step, Compensation};
use CapnWeb\Attribute\RpcTarget;

#[RpcTarget]
class OrderWorkflow
{
    public function __construct(
        private readonly Session $api,
    ) {}

    public function execute(int $userId, array $items): OrderResult
    {
        $workflow = Workflow::create(name: 'order-checkout');

        try {
            // Step 1: Reserve inventory
            $reservation = $workflow->step(
                name: 'reserve-inventory',
                action: fn() => $this->api->inventory->reserve(items: $items),
                compensate: fn($res) => $this->api->inventory->release(
                    reservationId: $res->id,
                ),
            );

            // Step 2: Charge payment
            $payment = $workflow->step(
                name: 'charge-payment',
                action: fn() => $this->api->payments->charge(
                    userId: $userId,
                    amount: $reservation->total,
                ),
                compensate: fn($pay) => $this->api->payments->refund(
                    paymentId: $pay->id,
                ),
            );

            // Step 3: Create order
            $order = $workflow->step(
                name: 'create-order',
                action: fn() => $this->api->orders->create(
                    userId: $userId,
                    items: $items,
                    paymentId: $payment->id,
                    reservationId: $reservation->id,
                ),
            );

            // Step 4: Send confirmation
            $workflow->step(
                name: 'send-confirmation',
                action: fn() => $this->api->notifications->send(
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

### Event-Driven Workflows

```php
use CapnWeb\Workflow\EventWorkflow;

#[RpcTarget]
class ApprovalWorkflow
{
    #[RpcMethod]
    public function onSubmitted(Document $doc): void
    {
        $this->api->workflow->emit(
            event: 'document.submitted',
            data: ['documentId' => $doc->id],
        );
    }

    #[RpcMethod]
    public function onApproved(string $documentId, string $approverId): void
    {
        $this->api->documents->approve(
            documentId: $documentId,
            approverId: $approverId,
        );

        $this->api->workflow->emit(
            event: 'document.approved',
            data: compact('documentId', 'approverId'),
        );
    }

    #[RpcMethod]
    public function onRejected(string $documentId, string $reason): void
    {
        $this->api->documents->reject(
            documentId: $documentId,
            reason: $reason,
        );
    }
}

$api->workflow->register(handler: new ApprovalWorkflow($api));
```

---

## Type Safety

### PHPDoc for IDE Support

The dynamic proxy gives flexibility. PHPDoc gives autocomplete:

```php
/** @var UsersService $users */
$users = $api->users;

$user = $users->get(id: 123);    // IDE knows this returns User
$user->profile->displayName;     // Full autocomplete chain
```

### Interface Stubs

Define interfaces for full static analysis:

```php
interface ApiStub
{
    public function authenticate(string $token): AuthResult;
    public function users(): UsersStub;
    public function posts(): PostsStub;
}

interface UsersStub
{
    public function get(int $id): User;
    /** @return iterable<User> */
    public function find(array $criteria): iterable;
    public function create(CreateUserDto $data): User;
}

/** @var ApiStub $api */
$api = Session::connect(url: 'wss://api.example.com/rpc');
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

---

## Configuration

### Named Arguments Throughout

```php
use CapnWeb\Session;

$api = Session::connect(
    url: 'wss://api.example.com/rpc',
    timeout: seconds(30),
    heartbeat: seconds(15),
    reconnect: true,
    maxReconnectAttempts: 5,
    headers: [
        'Authorization' => "Bearer {$token}",
    ],
);
```

### Retry Configuration

```php
use CapnWeb\Retry;

$api = Session::connect(
    url: 'wss://api.example.com/rpc',
    retry: Retry::exponential(
        maxAttempts: 5,
        initialDelay: milliseconds(100),
        maxDelay: seconds(30),
        multiplier: 2.0,
    ),
);

// Or customize per-call
$result = $api->unstableService->call()
    ->retry(maxAttempts: 3, delay: seconds(1));
```

---

## Laravel Integration

Full-featured Laravel integration with Service Provider, Facade, Queue jobs, and Artisan commands.

```bash
composer require dotdo/capnweb-laravel
```

### Configuration

```php
// config/capnweb.php
return [
    'default' => env('CAPNWEB_CONNECTION', 'main'),

    'connections' => [
        'main' => [
            'url' => env('CAPNWEB_URL', 'wss://api.example.com/rpc'),
            'timeout' => 30,
            'reconnect' => true,
        ],
        'analytics' => [
            'url' => env('CAPNWEB_ANALYTICS_URL'),
            'timeout' => 60,
        ],
    ],

    // Automatic reconnection on connection loss
    'reconnect' => [
        'enabled' => true,
        'max_attempts' => 5,
        'delay' => 1000, // milliseconds
    ],
];
```

### Service Provider

```php
// app/Providers/CapnWebServiceProvider.php
namespace App\Providers;

use CapnWeb\Laravel\CapnWebServiceProvider as BaseProvider;

class CapnWebServiceProvider extends BaseProvider
{
    public function boot(): void
    {
        parent::boot();

        // Register custom error handlers
        $this->app['capnweb']->onError(function (RpcException $e) {
            if ($e->type === ErrorType::Unauthorized) {
                Auth::logout();
                throw new AuthenticationException();
            }
        });
    }
}
```

### Facade Usage

```php
use CapnWeb\Facades\Rpc;

// Simple calls
$user = Rpc::users->get(id: 123);

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

use CapnWeb\Session;
use App\Http\Requests\CreateUserRequest;

class UserController extends Controller
{
    public function __construct(
        private readonly Session $api,
    ) {}

    public function show(int $id)
    {
        $user = $this->api->users->get(id: $id);
        return view('users.show', compact('user'));
    }

    public function store(CreateUserRequest $request)
    {
        $user = $this->api->users->create(
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

use CapnWeb\Facades\Rpc;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;

class SyncUserToExternalService implements ShouldQueue
{
    use Dispatchable, Queueable;

    public function __construct(
        public readonly int $userId,
    ) {}

    public function handle(): void
    {
        $user = Rpc::users->get(id: $this->userId);

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

use CapnWeb\Facades\Rpc;
use Illuminate\Console\Command;

class RpcHealthCheck extends Command
{
    protected $signature = 'rpc:health {--connection=}';
    protected $description = 'Check RPC connection health';

    public function handle(): int
    {
        $connection = $this->option('connection') ?? config('capnweb.default');

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

### Event Broadcasting

```php
// app/Listeners/BroadcastRpcEvents.php
namespace App\Listeners;

use CapnWeb\Attribute\RpcTarget;
use CapnWeb\Facades\Rpc;

#[RpcTarget]
class BroadcastRpcEvents
{
    public function __invoke(string $channel, array $data): void
    {
        broadcast(new RpcEvent($channel, $data));
    }
}

// Register in service provider
Rpc::events->subscribe(
    topics: ['orders.*', 'users.*'],
    handler: new BroadcastRpcEvents(),
);
```

### Middleware

```php
namespace App\Http\Middleware;

use CapnWeb\Facades\Rpc;
use Closure;

class InjectRpcUser
{
    public function handle($request, Closure $next)
    {
        if ($token = $request->bearerToken()) {
            $request->attributes->set(
                'rpc_session',
                Rpc::authenticate(token: $token),
            );
        }

        return $next($request);
    }
}
```

---

## Symfony Integration

```bash
composer require dotdo/capnweb-symfony
```

### Configuration

```yaml
# config/packages/capnweb.yaml
capnweb:
    default_connection: main
    connections:
        main:
            url: '%env(CAPNWEB_URL)%'
            timeout: 30
        analytics:
            url: '%env(CAPNWEB_ANALYTICS_URL)%'
            timeout: 60
```

### Autowiring

```php
namespace App\Controller;

use CapnWeb\Session;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Annotation\Route;

class UserController extends AbstractController
{
    public function __construct(
        private readonly Session $api,
    ) {}

    #[Route('/users/{id}', name: 'user_show')]
    public function show(int $id): Response
    {
        $user = $this->api->users->get(id: $id);

        return $this->render('user/show.html.twig', [
            'user' => $user,
        ]);
    }
}
```

### Named Connections

```php
use CapnWeb\Symfony\Connection;

class ReportController extends AbstractController
{
    public function __construct(
        #[Connection('analytics')]
        private readonly Session $analytics,
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

use CapnWeb\Symfony\RpcMessage;

class ProcessOrder implements RpcMessage
{
    public function __construct(
        public readonly int $orderId,
    ) {}
}

// Handler
namespace App\MessageHandler;

use App\Message\ProcessOrder;
use CapnWeb\Session;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
class ProcessOrderHandler
{
    public function __construct(
        private readonly Session $api,
    ) {}

    public function __invoke(ProcessOrder $message): void
    {
        $order = $this->api->orders->get(id: $message->orderId);
        $this->api->fulfillment->process(order: $order);
    }
}
```

---

## Plain PHP Usage

No framework? No problem.

```php
<?php

declare(strict_types=1);

require_once __DIR__ . '/vendor/autoload.php';

use CapnWeb\Session;
use CapnWeb\Attribute\{RpcTarget, RpcMethod};
use CapnWeb\Exception\RpcException;
use CapnWeb\ErrorType;

#[RpcTarget]
class NotificationHandler
{
    public function __invoke(string $type, array $data): void
    {
        printf("[%s] %s\n", $type, json_encode($data));
    }
}

$api = Session::connect(
    url: 'wss://api.example.com/rpc',
    timeout: seconds(30),
);

try {
    // Authenticate and get profile (single round-trip via pipelining)
    $profile = $api->authenticate(token: getenv('API_TOKEN'))
        ->user
        ->profile;

    echo "Welcome, {$profile->displayName}!\n\n";

    // Parallel data fetching
    [$friends, $posts] = $api->all(
        $profile->friends->list(),
        $api->posts->byAuthor(authorId: $profile->userId)->limit(5),
    );

    echo "Friends: " . count($friends) . "\n";
    echo "Recent posts:\n";

    foreach ($posts as $post) {
        echo "  - {$post->title}\n";
    }

    // Subscribe to real-time notifications
    $api->notifications->subscribe(
        handler: new NotificationHandler(),
    );

    // Event loop for real-time updates
    while (true) {
        $api->tick();
        usleep(100_000);
    }

} catch (RpcException $e) {
    fprintf(
        STDERR,
        "RPC Error [%s]: %s\n",
        $e->type->value,
        $e->getMessage(),
    );
    exit(1);
} finally {
    $api->close();
}
```

---

## How Fibers Work

Cap'n Web uses **PHP 8.1 Fibers** to make async code look synchronous. When you call `$api->users->get(123)`, the Fiber suspends while waiting for the network response, then resumes with the result.

```php
// What you write:
$user = $api->users->get(id: 123);
echo $user->name;

// What happens under the hood:
// 1. get(123) creates an RpcPromise
// 2. Accessing $user->name triggers resolution
// 3. Fiber suspends, network request fires
// 4. Response arrives, Fiber resumes
// 5. echo prints the name
```

Your code reads top-to-bottom, but underneath it's fully non-blocking. Multiple requests can be in-flight simultaneously.

### Manual Fiber Control

```php
use CapnWeb\Fiber\{suspend, resume};

// Advanced: manual control when needed
$promise = $api->users->get(id: 123);

// Do other work while request is pending
doSomethingElse();

// Explicitly await the result
$user = await($promise);
```

---

## Security

### Token-Based Authentication

```php
$api = Session::connect(
    url: 'wss://api.example.com/rpc',
    headers: [
        'Authorization' => "Bearer {$token}",
    ],
);
```

### Capability-Based Security

The protocol itself provides security through capabilities:

```php
// Server returns a capability (not raw data)
$session = $api->authenticate(token: $token);

// The session IS the permission
// Without the session object, you can't call authenticated methods
$profile = $session->user->profile;

// Capabilities are unforgeable and can be revoked
$api->sessions->revoke(sessionId: $session->id);
```

### Input Validation

```php
use CapnWeb\Exception\ValidationException;

try {
    $user = $api->users->create(
        name: '',  // Invalid
        email: 'not-an-email',  // Invalid
    );
} catch (ValidationException $e) {
    // Structured validation errors
    // ['name' => ['required'], 'email' => ['invalid format']]
    foreach ($e->violations as $field => $errors) {
        echo "{$field}: " . implode(', ', $errors) . "\n";
    }
}
```

---

## Resource Management

### Connection Lifecycle

Always clean up connections:

```php
$api = Session::connect(url: 'wss://api.example.com/rpc');

try {
    // ... use the API
} finally {
    $api->close();
}
```

### RAII Pattern

For scoped connections:

```php
use CapnWeb\Session;

Session::scoped(
    url: 'wss://api.example.com/rpc',
    callback: function (Session $api) {
        $user = $api->users->get(id: 123);
        processUser($user);
    },
);
// Connection automatically closed
```

### Connection Pooling

For high-throughput scenarios:

```php
use CapnWeb\Pool;

$pool = Pool::create(
    url: 'wss://api.example.com/rpc',
    minConnections: 2,
    maxConnections: 10,
);

// Connections are reused
$api = $pool->acquire();
try {
    $user = $api->users->get(id: 123);
} finally {
    $pool->release($api);
}
```

---

## Requirements

- **PHP 8.1+** (Fibers, Enums, Named Arguments, Readonly Properties)
- `ext-json`
- One of: `ext-sockets`, `react/socket`, `amphp/socket` for WebSocket transport

---

## Design Philosophy

| Decision | Rationale |
|----------|-----------|
| Fibers over ReactPHP | Synchronous-looking code, easier debugging |
| Named arguments | Self-documenting API, IDE-friendly |
| Enums for errors | Type-safe, exhaustive matching |
| Attributes over interfaces | Less boilerplate, more PHP 8 native |
| Generator streaming | Memory-efficient, familiar iteration |
| Lazy resolution | Automatic pipelining without explicit batching |

---

## License

MIT
