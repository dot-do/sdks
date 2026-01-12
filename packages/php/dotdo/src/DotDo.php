<?php

declare(strict_types=1);

namespace DotDo;

use Closure;
use DotDo\CapnWeb\Session;
use DotDo\CapnWeb\RpcException;
use DotDo\CapnWeb\ErrorType;

/**
 * Authentication provider interface
 */
interface AuthProvider
{
    /**
     * Get the current access token
     */
    public function getAccessToken(): ?string;

    /**
     * Refresh the access token if needed
     */
    public function refreshToken(): void;

    /**
     * Check if the token is expired
     */
    public function isExpired(): bool;
}

/**
 * API key authentication provider
 */
readonly class ApiKeyAuth implements AuthProvider
{
    public function __construct(
        private string $apiKey,
    ) {}

    public function getAccessToken(): ?string
    {
        return $this->apiKey;
    }

    public function refreshToken(): void
    {
        // API keys don't need refresh
    }

    public function isExpired(): bool
    {
        return false;
    }
}

/**
 * OAuth2 token authentication provider
 */
class OAuth2Auth implements AuthProvider
{
    private ?string $accessToken = null;
    private ?string $refreshToken = null;
    private ?int $expiresAt = null;

    public function __construct(
        private readonly string $clientId,
        private readonly string $clientSecret,
        private readonly string $tokenUrl,
    ) {}

    public function getAccessToken(): ?string
    {
        if ($this->isExpired()) {
            $this->refreshToken();
        }

        return $this->accessToken;
    }

    public function refreshToken(): void
    {
        if ($this->refreshToken === null) {
            throw new AuthenticationException('No refresh token available');
        }

        // Stub implementation - in production would make HTTP call
        // to tokenUrl with refresh_token grant
        $this->accessToken = 'refreshed_' . bin2hex(random_bytes(16));
        $this->expiresAt = time() + 3600;
    }

    public function isExpired(): bool
    {
        if ($this->expiresAt === null) {
            return true;
        }

        return time() >= ($this->expiresAt - 60); // 60 second buffer
    }

    /**
     * Set tokens from OAuth response
     */
    public function setTokens(string $accessToken, ?string $refreshToken, int $expiresIn): void
    {
        $this->accessToken = $accessToken;
        $this->refreshToken = $refreshToken;
        $this->expiresAt = time() + $expiresIn;
    }
}

/**
 * Authentication exception
 */
class AuthenticationException extends \Exception {}

/**
 * Connection pool entry
 */
class PooledConnection
{
    public function __construct(
        public readonly Session $session,
        public readonly int $createdAt,
        public int $lastUsedAt,
        public int $useCount = 0,
    ) {}

    public function isHealthy(): bool
    {
        return $this->session->isConnected();
    }

    public function touch(): void
    {
        $this->lastUsedAt = time();
        $this->useCount++;
    }
}

/**
 * Connection pool for managing multiple sessions
 */
class ConnectionPool
{
    /** @var array<string, PooledConnection[]> */
    private array $pools = [];

    public function __construct(
        private readonly int $maxConnectionsPerHost = 10,
        private readonly int $maxIdleTimeSeconds = 300,
        private readonly int $maxConnectionAgeSeconds = 3600,
    ) {}

    /**
     * Get a connection from the pool or create a new one
     */
    public function acquire(string $url, array $options = []): Session
    {
        $host = parse_url($url, PHP_URL_HOST) ?? $url;

        if (!isset($this->pools[$host])) {
            $this->pools[$host] = [];
        }

        // Clean up stale connections
        $this->cleanupPool($host);

        // Find an available healthy connection
        foreach ($this->pools[$host] as $pooled) {
            if ($pooled->isHealthy()) {
                $pooled->touch();
                return $pooled->session;
            }
        }

        // Create new connection if under limit
        if (count($this->pools[$host]) < $this->maxConnectionsPerHost) {
            $session = Session::connect(
                url: $url,
                timeout: $options['timeout'] ?? 30,
                reconnect: $options['reconnect'] ?? true,
                headers: $options['headers'] ?? [],
            );

            $now = time();
            $pooled = new PooledConnection(
                session: $session,
                createdAt: $now,
                lastUsedAt: $now,
            );

            $this->pools[$host][] = $pooled;
            $pooled->touch();

            return $session;
        }

        // All connections busy, wait or throw
        throw new RpcException(
            'Connection pool exhausted for host: ' . $host,
            ErrorType::ConnectionLost,
        );
    }

    /**
     * Release a connection back to the pool
     */
    public function release(Session $session): void
    {
        // Connection remains in pool, just update last used time
        foreach ($this->pools as $host => $connections) {
            foreach ($connections as $pooled) {
                if ($pooled->session === $session) {
                    $pooled->lastUsedAt = time();
                    return;
                }
            }
        }
    }

    /**
     * Close all connections in the pool
     */
    public function closeAll(): void
    {
        foreach ($this->pools as $host => $connections) {
            foreach ($connections as $pooled) {
                $pooled->session->close();
            }
        }

        $this->pools = [];
    }

    /**
     * Get pool statistics
     */
    public function stats(): array
    {
        $stats = [];

        foreach ($this->pools as $host => $connections) {
            $healthy = 0;
            $totalUses = 0;

            foreach ($connections as $pooled) {
                if ($pooled->isHealthy()) {
                    $healthy++;
                }
                $totalUses += $pooled->useCount;
            }

            $stats[$host] = [
                'total' => count($connections),
                'healthy' => $healthy,
                'totalUses' => $totalUses,
            ];
        }

        return $stats;
    }

    /**
     * Clean up stale connections
     */
    private function cleanupPool(string $host): void
    {
        $now = time();

        $this->pools[$host] = array_filter(
            $this->pools[$host],
            function (PooledConnection $pooled) use ($now): bool {
                // Remove connections that are too old
                if (($now - $pooled->createdAt) > $this->maxConnectionAgeSeconds) {
                    $pooled->session->close();
                    return false;
                }

                // Remove idle connections
                if (($now - $pooled->lastUsedAt) > $this->maxIdleTimeSeconds) {
                    $pooled->session->close();
                    return false;
                }

                // Remove unhealthy connections
                if (!$pooled->isHealthy()) {
                    return false;
                }

                return true;
            },
        );
    }
}

/**
 * Retry configuration
 */
readonly class RetryConfig
{
    public function __construct(
        public int $maxAttempts = 3,
        public int $initialDelayMs = 100,
        public int $maxDelayMs = 10000,
        public float $backoffMultiplier = 2.0,
        public bool $retryOnConnectionLost = true,
        public bool $retryOnTimeout = true,
        public bool $retryOnRateLimited = true,
        public array $retryableErrors = [],
    ) {}

    /**
     * Calculate delay for attempt number
     */
    public function delayForAttempt(int $attempt): int
    {
        $delay = (int) ($this->initialDelayMs * pow($this->backoffMultiplier, $attempt - 1));
        return min($delay, $this->maxDelayMs);
    }

    /**
     * Check if an error type should be retried
     */
    public function shouldRetry(ErrorType $errorType): bool
    {
        return match ($errorType) {
            ErrorType::ConnectionLost => $this->retryOnConnectionLost,
            ErrorType::Timeout => $this->retryOnTimeout,
            ErrorType::RateLimited => $this->retryOnRateLimited,
            default => in_array($errorType, $this->retryableErrors, true),
        };
    }
}

/**
 * Retry executor with exponential backoff
 */
class RetryExecutor
{
    public function __construct(
        private readonly RetryConfig $config,
    ) {}

    /**
     * Execute a callable with retry logic
     *
     * @template T
     * @param Closure(): T $operation
     * @return T
     * @throws RpcException
     */
    public function execute(Closure $operation): mixed
    {
        $attempt = 0;
        $lastException = null;

        while ($attempt < $this->config->maxAttempts) {
            $attempt++;

            try {
                return $operation();
            } catch (RpcException $e) {
                $lastException = $e;

                if (!$this->config->shouldRetry($e->type)) {
                    throw $e;
                }

                if ($attempt < $this->config->maxAttempts) {
                    $delay = $this->getDelay($e, $attempt);
                    usleep($delay * 1000);
                }
            }
        }

        throw $lastException ?? new RpcException(
            'Operation failed after ' . $this->config->maxAttempts . ' attempts',
        );
    }

    /**
     * Get delay for the current attempt, considering rate limit headers
     */
    private function getDelay(RpcException $e, int $attempt): int
    {
        // Respect rate limit retry-after if present
        if ($e->type === ErrorType::RateLimited && $e->retryAfter !== null) {
            return $e->retryAfter * 1000; // Convert seconds to ms
        }

        return $this->config->delayForAttempt($attempt);
    }
}

/**
 * Main DotDo client - entry point for the platform SDK
 */
class DotDo
{
    private ?ConnectionPool $connectionPool = null;
    private ?RetryExecutor $retryExecutor = null;

    private function __construct(
        private readonly string $baseUrl,
        private readonly AuthProvider $auth,
        private readonly RetryConfig $retryConfig,
        private readonly array $options,
    ) {}

    /**
     * Create a new DotDo client with API key authentication
     */
    public static function withApiKey(string $apiKey, array $options = []): self
    {
        $baseUrl = $options['baseUrl'] ?? 'wss://api.dotdo.io';

        return new self(
            baseUrl: $baseUrl,
            auth: new ApiKeyAuth($apiKey),
            retryConfig: $options['retry'] ?? new RetryConfig(),
            options: $options,
        );
    }

    /**
     * Create a new DotDo client with OAuth2 authentication
     */
    public static function withOAuth2(
        string $clientId,
        string $clientSecret,
        string $tokenUrl,
        array $options = [],
    ): self {
        $baseUrl = $options['baseUrl'] ?? 'wss://api.dotdo.io';

        return new self(
            baseUrl: $baseUrl,
            auth: new OAuth2Auth($clientId, $clientSecret, $tokenUrl),
            retryConfig: $options['retry'] ?? new RetryConfig(),
            options: $options,
        );
    }

    /**
     * Create a new DotDo client with custom auth provider
     */
    public static function withAuth(AuthProvider $auth, array $options = []): self
    {
        $baseUrl = $options['baseUrl'] ?? 'wss://api.dotdo.io';

        return new self(
            baseUrl: $baseUrl,
            auth: $auth,
            retryConfig: $options['retry'] ?? new RetryConfig(),
            options: $options,
        );
    }

    /**
     * Get a connection from the pool
     */
    public function connect(): Session
    {
        $pool = $this->getConnectionPool();

        $headers = [];
        $token = $this->auth->getAccessToken();
        if ($token !== null) {
            $headers['Authorization'] = 'Bearer ' . $token;
        }

        return $pool->acquire($this->baseUrl, [
            'headers' => $headers,
            'timeout' => $this->options['timeout'] ?? 30,
            'reconnect' => $this->options['reconnect'] ?? true,
        ]);
    }

    /**
     * Execute an operation with automatic connection management and retries
     *
     * @template T
     * @param Closure(Session): T $operation
     * @return T
     */
    public function execute(Closure $operation): mixed
    {
        $executor = $this->getRetryExecutor();

        return $executor->execute(function () use ($operation) {
            $session = $this->connect();

            try {
                return $operation($session);
            } finally {
                $this->getConnectionPool()->release($session);
            }
        });
    }

    /**
     * Execute a scoped operation with a dedicated connection
     *
     * @template T
     * @param Closure(Session): T $operation
     * @return T
     */
    public function scoped(Closure $operation): mixed
    {
        $headers = [];
        $token = $this->auth->getAccessToken();
        if ($token !== null) {
            $headers['Authorization'] = 'Bearer ' . $token;
        }

        return Session::scoped($this->baseUrl, function (Session $session) use ($operation) {
            return $this->getRetryExecutor()->execute(fn() => $operation($session));
        });
    }

    /**
     * Get pool statistics
     */
    public function poolStats(): array
    {
        return $this->getConnectionPool()->stats();
    }

    /**
     * Close all connections
     */
    public function close(): void
    {
        $this->connectionPool?->closeAll();
        $this->connectionPool = null;
    }

    /**
     * Get the base URL
     */
    public function getBaseUrl(): string
    {
        return $this->baseUrl;
    }

    /**
     * Get the auth provider
     */
    public function getAuth(): AuthProvider
    {
        return $this->auth;
    }

    private function getConnectionPool(): ConnectionPool
    {
        if ($this->connectionPool === null) {
            $this->connectionPool = new ConnectionPool(
                maxConnectionsPerHost: $this->options['maxConnections'] ?? 10,
                maxIdleTimeSeconds: $this->options['maxIdleTime'] ?? 300,
                maxConnectionAgeSeconds: $this->options['maxConnectionAge'] ?? 3600,
            );
        }

        return $this->connectionPool;
    }

    private function getRetryExecutor(): RetryExecutor
    {
        if ($this->retryExecutor === null) {
            $this->retryExecutor = new RetryExecutor($this->retryConfig);
        }

        return $this->retryExecutor;
    }
}
