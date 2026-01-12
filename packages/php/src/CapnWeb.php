<?php

declare(strict_types=1);

namespace CapnWeb;

use Closure;
use JsonSerializable;
use Stringable;

/**
 * Error types for RPC exceptions
 */
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

/**
 * Promise state for tracking resolution
 */
enum PromiseState: string
{
    case Pending = 'pending';
    case Resolved = 'resolved';
    case Rejected = 'rejected';
}

/**
 * RPC Target attribute for exposing objects to server
 */
#[\Attribute(\Attribute::TARGET_CLASS)]
readonly class RpcTarget
{
    public function __construct(
        public ?string $name = null,
    ) {}
}

/**
 * RPC Method attribute for exposing methods
 */
#[\Attribute(\Attribute::TARGET_METHOD)]
readonly class RpcMethod
{
    public function __construct(
        public ?string $name = null,
        public bool $async = false,
    ) {}
}

/**
 * RPC Property attribute for exposing properties
 */
#[\Attribute(\Attribute::TARGET_PROPERTY)]
readonly class RpcProperty
{
    public function __construct(
        public bool $readable = true,
        public bool $writable = false,
    ) {}
}

/**
 * Capture attribute for map expressions
 */
#[\Attribute(\Attribute::TARGET_PARAMETER)]
readonly class Capture
{
    public function __construct(
        public string $name,
    ) {}
}

/**
 * Exception for RPC errors
 */
class RpcException extends \Exception
{
    public function __construct(
        string $message,
        public readonly ErrorType $type = ErrorType::Unknown,
        public readonly ?string $path = null,
        public readonly ?int $retryAfter = null,
        public readonly array $violations = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}

/**
 * Connection exception for network failures
 */
class ConnectionException extends RpcException
{
    public function __construct(
        string $message,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, ErrorType::ConnectionLost, previous: $previous);
    }
}

/**
 * Timeout exception
 */
class TimeoutException extends RpcException
{
    public function __construct(
        string $message,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, ErrorType::Timeout, previous: $previous);
    }
}

/**
 * Validation exception with structured errors
 */
class ValidationException extends RpcException
{
    public function __construct(
        string $message,
        array $violations = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, ErrorType::ValidationError, violations: $violations, previous: $previous);
    }
}

/**
 * Represents a captured closure for server-side map operations
 */
readonly class MapExpression implements JsonSerializable
{
    public function __construct(
        public Closure $callback,
        public array $captures = [],
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'type' => 'map_expression',
            'captures' => array_map(
                fn(mixed $value): mixed => $value instanceof RpcPromise
                    ? $value->toReference()
                    : $value,
                $this->captures,
            ),
        ];
    }
}

/**
 * RPC Promise - represents a pending or resolved RPC result
 *
 * Supports promise pipelining and server-side map operations.
 *
 * @template T
 */
class RpcPromise implements Stringable, JsonSerializable
{
    private PromiseState $state = PromiseState::Pending;
    private mixed $value = null;
    private ?RpcException $error = null;

    /** @var array<array{Closure, Closure|null}> */
    private array $callbacks = [];

    /** @var array<string, mixed> */
    private array $pipelinedAccesses = [];

    public function __construct(
        private readonly ?Session $session = null,
        private readonly ?string $callId = null,
        private readonly ?string $method = null,
        private readonly array $args = [],
        private readonly ?RpcPromise $parent = null,
        private readonly ?string $accessPath = null,
    ) {}

    /**
     * Map a function over this promise's result (server-side execution)
     *
     * The callback is serialized and sent to the server, allowing
     * the transform to execute server-side without additional round trips.
     *
     * @template U
     * @param Closure(T): U $callback
     * @return RpcPromise<U>
     */
    public function map(Closure $callback): RpcPromise
    {
        $expression = new MapExpression(
            callback: $callback,
            captures: $this->extractCaptures($callback),
        );

        return new RpcPromise(
            session: $this->session,
            callId: $this->generateCallId(),
            method: '__map__',
            args: [$this, $expression],
            parent: $this,
        );
    }

    /**
     * Alias for map() - remap for server-side collection transformation
     *
     * @template U
     * @param Closure(T): U $callback
     * @return RpcPromise<U>
     */
    public function remap(Closure $callback): RpcPromise
    {
        return $this->map($callback);
    }

    /**
     * Filter the collection server-side
     *
     * @param Closure(T): bool $predicate
     * @return RpcPromise<array<T>>
     */
    public function filter(Closure $predicate): RpcPromise
    {
        $expression = new MapExpression(
            callback: $predicate,
            captures: $this->extractCaptures($predicate),
        );

        return new RpcPromise(
            session: $this->session,
            callId: $this->generateCallId(),
            method: '__filter__',
            args: [$this, $expression],
            parent: $this,
        );
    }

    /**
     * Chain a callback when promise resolves
     *
     * @template U
     * @param Closure(T): U $onResolved
     * @param Closure(RpcException): U|null $onRejected
     * @return RpcPromise<U>
     */
    public function then(Closure $onResolved, ?Closure $onRejected = null): RpcPromise
    {
        $newPromise = new RpcPromise(session: $this->session);

        if ($this->state === PromiseState::Resolved) {
            try {
                $result = $onResolved($this->value);
                $newPromise->resolve($result);
            } catch (\Throwable $e) {
                $newPromise->reject(new RpcException($e->getMessage(), previous: $e));
            }
        } elseif ($this->state === PromiseState::Rejected) {
            if ($onRejected !== null) {
                try {
                    $result = $onRejected($this->error);
                    $newPromise->resolve($result);
                } catch (\Throwable $e) {
                    $newPromise->reject(new RpcException($e->getMessage(), previous: $e));
                }
            } else {
                $newPromise->reject($this->error);
            }
        } else {
            $this->callbacks[] = [
                fn($value) => $newPromise->resolve($onResolved($value)),
                $onRejected !== null
                    ? fn($error) => $newPromise->resolve($onRejected($error))
                    : fn($error) => $newPromise->reject($error),
            ];
        }

        return $newPromise;
    }

    /**
     * Catch rejections
     *
     * @template U
     * @param Closure(RpcException): U $onRejected
     * @return RpcPromise<T|U>
     */
    public function catch(Closure $onRejected): RpcPromise
    {
        return $this->then(fn($v) => $v, $onRejected);
    }

    /**
     * Always execute regardless of outcome
     *
     * @param Closure(): void $callback
     * @return RpcPromise<T>
     */
    public function finally(Closure $callback): RpcPromise
    {
        return $this->then(
            function ($value) use ($callback) {
                $callback();
                return $value;
            },
            function ($error) use ($callback) {
                $callback();
                throw $error;
            },
        );
    }

    /**
     * Wait for the promise to resolve (blocks with Fibers)
     *
     * @return T
     * @throws RpcException
     */
    public function await(): mixed
    {
        if ($this->state === PromiseState::Resolved) {
            return $this->value;
        }

        if ($this->state === PromiseState::Rejected) {
            throw $this->error;
        }

        // In a real implementation, this would use Fibers to suspend
        // and resume when the result arrives. For testing, we execute
        // the request synchronously.
        $this->session?->executeCall($this);

        if ($this->state === PromiseState::Rejected) {
            throw $this->error;
        }

        return $this->value;
    }

    /**
     * Resolve the promise with a value
     *
     * @param T $value
     */
    public function resolve(mixed $value): void
    {
        if ($this->state !== PromiseState::Pending) {
            return;
        }

        $this->state = PromiseState::Resolved;
        $this->value = $value;

        foreach ($this->callbacks as [$onResolved, $_]) {
            $onResolved($value);
        }

        $this->callbacks = [];
    }

    /**
     * Reject the promise with an error
     */
    public function reject(RpcException $error): void
    {
        if ($this->state !== PromiseState::Pending) {
            return;
        }

        $this->state = PromiseState::Rejected;
        $this->error = $error;

        foreach ($this->callbacks as [$_, $onRejected]) {
            if ($onRejected !== null) {
                $onRejected($error);
            }
        }

        $this->callbacks = [];
    }

    /**
     * Check if promise is pending
     */
    public function isPending(): bool
    {
        return $this->state === PromiseState::Pending;
    }

    /**
     * Check if promise is resolved
     */
    public function isResolved(): bool
    {
        return $this->state === PromiseState::Resolved;
    }

    /**
     * Check if promise is rejected
     */
    public function isRejected(): bool
    {
        return $this->state === PromiseState::Rejected;
    }

    /**
     * Get the call ID for this promise
     */
    public function getCallId(): ?string
    {
        return $this->callId;
    }

    /**
     * Get the method name
     */
    public function getMethod(): ?string
    {
        return $this->method;
    }

    /**
     * Get the arguments
     */
    public function getArgs(): array
    {
        return $this->args;
    }

    /**
     * Get the parent promise (for pipelining)
     */
    public function getParent(): ?RpcPromise
    {
        return $this->parent;
    }

    /**
     * Get the access path (for pipelining)
     */
    public function getAccessPath(): ?string
    {
        return $this->accessPath;
    }

    /**
     * Convert to a reference for serialization
     */
    public function toReference(): array
    {
        return [
            'type' => 'promise_ref',
            'callId' => $this->callId,
            'method' => $this->method,
            'args' => $this->args,
        ];
    }

    /**
     * Magic getter for property access (pipelining)
     */
    public function __get(string $name): RpcPromise
    {
        $path = $this->accessPath !== null
            ? "{$this->accessPath}.{$name}"
            : $name;

        if (!isset($this->pipelinedAccesses[$path])) {
            $this->pipelinedAccesses[$path] = new RpcPromise(
                session: $this->session,
                callId: $this->generateCallId(),
                method: '__get__',
                args: [$name],
                parent: $this,
                accessPath: $path,
            );
        }

        return $this->pipelinedAccesses[$path];
    }

    /**
     * Magic method call (pipelining)
     */
    public function __call(string $name, array $arguments): RpcPromise
    {
        return new RpcPromise(
            session: $this->session,
            callId: $this->generateCallId(),
            method: $name,
            args: $arguments,
            parent: $this,
        );
    }

    public function __toString(): string
    {
        return match ($this->state) {
            PromiseState::Pending => '[RpcPromise:pending]',
            PromiseState::Resolved => '[RpcPromise:resolved=' . json_encode($this->value) . ']',
            PromiseState::Rejected => '[RpcPromise:rejected=' . $this->error->getMessage() . ']',
        };
    }

    public function jsonSerialize(): mixed
    {
        return $this->toReference();
    }

    private function generateCallId(): string
    {
        return bin2hex(random_bytes(8));
    }

    /**
     * Extract captured variables from a closure
     */
    private function extractCaptures(Closure $callback): array
    {
        $reflection = new \ReflectionFunction($callback);
        $captures = [];

        foreach ($reflection->getStaticVariables() as $name => $value) {
            $captures[$name] = $value;
        }

        return $captures;
    }
}

/**
 * RPC Session - manages connection to a Cap'n Web server
 */
class Session
{
    /** @var array<string, RpcPromise> */
    private array $pendingCalls = [];

    private bool $connected = false;

    private function __construct(
        private readonly string $url,
        private readonly int $timeout,
        private readonly bool $reconnect,
        private readonly array $headers,
    ) {}

    /**
     * Connect to a Cap'n Web server via WebSocket
     */
    public static function connect(
        string $url,
        int $timeout = 30,
        bool $reconnect = false,
        array $headers = [],
    ): self {
        $session = new self(
            url: $url,
            timeout: $timeout,
            reconnect: $reconnect,
            headers: $headers,
        );

        $session->doConnect();

        return $session;
    }

    /**
     * Create a batch session for HTTP transport
     */
    public static function batch(
        string $url,
        int $timeout = 30,
        array $headers = [],
    ): self {
        return new self(
            url: $url,
            timeout: $timeout,
            reconnect: false,
            headers: $headers,
        );
    }

    /**
     * Execute within a scoped connection
     *
     * @template T
     * @param string $url
     * @param Closure(Session): T $callback
     * @return T
     */
    public static function scoped(string $url, Closure $callback): mixed
    {
        $session = self::connect($url);
        try {
            return $callback($session);
        } finally {
            $session->close();
        }
    }

    /**
     * Magic getter for API access
     */
    public function __get(string $name): RpcPromise
    {
        return new RpcPromise(
            session: $this,
            callId: $this->generateCallId(),
            method: '__get__',
            args: [$name],
        );
    }

    /**
     * Magic method call
     */
    public function __call(string $name, array $arguments): RpcPromise
    {
        return new RpcPromise(
            session: $this,
            callId: $this->generateCallId(),
            method: $name,
            args: $arguments,
        );
    }

    /**
     * Execute multiple calls in parallel
     *
     * @param RpcPromise ...$promises
     * @return array
     */
    public function all(RpcPromise ...$promises): array
    {
        // In a real implementation, this would batch all calls
        // and resolve them in parallel
        return array_map(fn($p) => $p->await(), $promises);
    }

    /**
     * Race multiple promises - first to resolve wins
     *
     * @param RpcPromise ...$promises
     * @return mixed
     */
    public function race(RpcPromise ...$promises): mixed
    {
        // In a real implementation, this would race the requests
        foreach ($promises as $promise) {
            try {
                return $promise->await();
            } catch (RpcException) {
                continue;
            }
        }

        throw new RpcException('All promises rejected');
    }

    /**
     * Execute an RPC call (internal)
     */
    public function executeCall(RpcPromise $promise): void
    {
        $method = $promise->getMethod();
        $args = $promise->getArgs();
        $callId = $promise->getCallId();

        // Build the full call chain for pipelining
        $callChain = $this->buildCallChain($promise);

        try {
            $result = $this->sendRequest($callChain);
            $promise->resolve($result);
        } catch (RpcException $e) {
            $promise->reject($e);
        }
    }

    /**
     * Process incoming messages (for WebSocket)
     */
    public function tick(): void
    {
        // In a real implementation, this would process
        // incoming WebSocket messages
    }

    /**
     * Close the connection
     */
    public function close(): void
    {
        $this->connected = false;
        $this->pendingCalls = [];
    }

    /**
     * Reconnect to the server
     */
    public function reconnect(): void
    {
        $this->close();
        $this->doConnect();
    }

    /**
     * Check if connected
     */
    public function isConnected(): bool
    {
        return $this->connected;
    }

    /**
     * Get the server URL
     */
    public function getUrl(): string
    {
        return $this->url;
    }

    private function doConnect(): void
    {
        // In a real implementation, this would establish
        // the WebSocket connection
        $this->connected = true;
    }

    private function generateCallId(): string
    {
        return bin2hex(random_bytes(8));
    }

    /**
     * Build the full call chain for pipelining
     */
    private function buildCallChain(RpcPromise $promise): array
    {
        $chain = [];
        $current = $promise;

        while ($current !== null) {
            array_unshift($chain, [
                'callId' => $current->getCallId(),
                'method' => $current->getMethod(),
                'args' => $current->getArgs(),
            ]);
            $current = $current->getParent();
        }

        return $chain;
    }

    /**
     * Send an RPC request to the server
     */
    private function sendRequest(array $callChain): mixed
    {
        // This is a stub implementation for testing.
        // In a real implementation, this would:
        // 1. Serialize the call chain to JSON
        // 2. Send over WebSocket or HTTP
        // 3. Parse the response
        // 4. Handle errors

        throw new RpcException(
            'Session not connected to a real server',
            ErrorType::ConnectionLost,
        );
    }
}

/**
 * Helper function to create a duration in seconds
 */
function seconds(int $seconds): int
{
    return $seconds;
}

/**
 * Helper function to create a duration in milliseconds
 */
function milliseconds(int $ms): int
{
    return $ms;
}

/**
 * Await a promise (convenience function)
 *
 * @template T
 * @param RpcPromise<T> $promise
 * @return T
 */
function await(RpcPromise $promise): mixed
{
    return $promise->await();
}
