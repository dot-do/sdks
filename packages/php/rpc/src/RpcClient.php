<?php

declare(strict_types=1);

namespace DotDo\Rpc;

use Closure;
use JsonSerializable;

/**
 * Response wrapper for RPC calls
 *
 * @template T
 */
readonly class RpcResponse implements JsonSerializable
{
    /**
     * @param T $data
     */
    public function __construct(
        public mixed $data,
        public ?string $error = null,
        public int $statusCode = 200,
        public array $metadata = [],
    ) {}

    public function isSuccess(): bool
    {
        return $this->error === null && $this->statusCode >= 200 && $this->statusCode < 300;
    }

    public function isError(): bool
    {
        return !$this->isSuccess();
    }

    /**
     * Map the response data using a closure
     *
     * @template U
     * @param Closure(T): U $mapper
     * @return RpcResponse<U>
     */
    public function map(Closure $mapper): RpcResponse
    {
        if ($this->isError()) {
            return new RpcResponse(
                data: null,
                error: $this->error,
                statusCode: $this->statusCode,
                metadata: $this->metadata,
            );
        }

        return new RpcResponse(
            data: $mapper($this->data),
            error: null,
            statusCode: $this->statusCode,
            metadata: $this->metadata,
        );
    }

    /**
     * Flat map for nested responses
     *
     * @template U
     * @param Closure(T): RpcResponse<U> $mapper
     * @return RpcResponse<U>
     */
    public function flatMap(Closure $mapper): RpcResponse
    {
        if ($this->isError()) {
            return new RpcResponse(
                data: null,
                error: $this->error,
                statusCode: $this->statusCode,
                metadata: $this->metadata,
            );
        }

        return $mapper($this->data);
    }

    /**
     * Get data or throw on error
     *
     * @return T
     * @throws RpcClientException
     */
    public function getOrThrow(): mixed
    {
        if ($this->isError()) {
            throw new RpcClientException(
                $this->error ?? 'Unknown RPC error',
                $this->statusCode,
            );
        }

        return $this->data;
    }

    /**
     * Get data or return default value
     *
     * @template D
     * @param D $default
     * @return T|D
     */
    public function getOrDefault(mixed $default): mixed
    {
        if ($this->isError()) {
            return $default;
        }

        return $this->data;
    }

    public function jsonSerialize(): array
    {
        return [
            'data' => $this->data,
            'error' => $this->error,
            'statusCode' => $this->statusCode,
            'metadata' => $this->metadata,
        ];
    }
}

/**
 * Exception for RPC client errors
 */
class RpcClientException extends \Exception
{
    public function __construct(
        string $message,
        public readonly int $statusCode = 0,
        public readonly ?string $rpcMethod = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, $statusCode, $previous);
    }
}

/**
 * RPC Client configuration
 */
readonly class RpcClientConfig
{
    public function __construct(
        public string $baseUrl,
        public int $timeout = 30,
        public int $retries = 3,
        public int $retryDelayMs = 100,
        public array $headers = [],
        public ?string $authToken = null,
    ) {}

    public function withAuthToken(string $token): self
    {
        return new self(
            baseUrl: $this->baseUrl,
            timeout: $this->timeout,
            retries: $this->retries,
            retryDelayMs: $this->retryDelayMs,
            headers: $this->headers,
            authToken: $token,
        );
    }

    public function withHeader(string $name, string $value): self
    {
        $headers = $this->headers;
        $headers[$name] = $value;

        return new self(
            baseUrl: $this->baseUrl,
            timeout: $this->timeout,
            retries: $this->retries,
            retryDelayMs: $this->retryDelayMs,
            headers: $headers,
            authToken: $this->authToken,
        );
    }
}

/**
 * RPC Client for making remote procedure calls
 *
 * Supports functional patterns like map() for transforming responses.
 */
class RpcClient
{
    private array $interceptors = [];

    public function __construct(
        private readonly RpcClientConfig $config,
    ) {}

    /**
     * Create a new client with the given base URL
     */
    public static function create(string $baseUrl, array $options = []): self
    {
        $config = new RpcClientConfig(
            baseUrl: rtrim($baseUrl, '/'),
            timeout: $options['timeout'] ?? 30,
            retries: $options['retries'] ?? 3,
            retryDelayMs: $options['retryDelayMs'] ?? 100,
            headers: $options['headers'] ?? [],
            authToken: $options['authToken'] ?? null,
        );

        return new self($config);
    }

    /**
     * Add a request interceptor
     */
    public function addInterceptor(Closure $interceptor): self
    {
        $this->interceptors[] = $interceptor;
        return $this;
    }

    /**
     * Make an RPC call
     *
     * @template T
     * @param string $method
     * @param array $params
     * @return RpcResponse<T>
     */
    public function call(string $method, array $params = []): RpcResponse
    {
        $request = $this->buildRequest($method, $params);

        // Apply interceptors
        foreach ($this->interceptors as $interceptor) {
            $request = $interceptor($request);
        }

        return $this->executeWithRetry($request);
    }

    /**
     * Make an RPC call and map the result
     *
     * @template T
     * @template U
     * @param string $method
     * @param array $params
     * @param Closure(T): U $mapper
     * @return RpcResponse<U>
     */
    public function callAndMap(string $method, array $params, Closure $mapper): RpcResponse
    {
        return $this->call($method, $params)->map($mapper);
    }

    /**
     * Batch multiple RPC calls
     *
     * @param array<string, array{method: string, params?: array}> $calls
     * @return array<string, RpcResponse>
     */
    public function batch(array $calls): array
    {
        $results = [];

        foreach ($calls as $key => $call) {
            $results[$key] = $this->call(
                $call['method'],
                $call['params'] ?? [],
            );
        }

        return $results;
    }

    /**
     * Map over a collection returned by an RPC call
     *
     * @template T
     * @template U
     * @param string $method
     * @param array $params
     * @param Closure(T): U $mapper
     * @return RpcResponse<array<U>>
     */
    public function callAndMapEach(string $method, array $params, Closure $mapper): RpcResponse
    {
        return $this->call($method, $params)->map(
            fn(array $items) => array_map($mapper, $items)
        );
    }

    /**
     * Filter a collection returned by an RPC call
     *
     * @template T
     * @param string $method
     * @param array $params
     * @param Closure(T): bool $predicate
     * @return RpcResponse<array<T>>
     */
    public function callAndFilter(string $method, array $params, Closure $predicate): RpcResponse
    {
        return $this->call($method, $params)->map(
            fn(array $items) => array_values(array_filter($items, $predicate))
        );
    }

    /**
     * Build the request payload
     */
    private function buildRequest(string $method, array $params): array
    {
        return [
            'jsonrpc' => '2.0',
            'method' => $method,
            'params' => $params,
            'id' => bin2hex(random_bytes(8)),
        ];
    }

    /**
     * Execute request with retry logic
     *
     * @return RpcResponse
     */
    private function executeWithRetry(array $request): RpcResponse
    {
        $lastException = null;
        $attempts = 0;

        while ($attempts < $this->config->retries) {
            try {
                return $this->execute($request);
            } catch (RpcClientException $e) {
                $lastException = $e;
                $attempts++;

                if ($attempts < $this->config->retries) {
                    usleep($this->config->retryDelayMs * 1000 * $attempts);
                }
            }
        }

        return new RpcResponse(
            data: null,
            error: $lastException?->getMessage() ?? 'Request failed after retries',
            statusCode: $lastException?->statusCode ?? 500,
        );
    }

    /**
     * Execute the HTTP request
     */
    private function execute(array $request): RpcResponse
    {
        $headers = $this->config->headers;
        $headers['Content-Type'] = 'application/json';

        if ($this->config->authToken !== null) {
            $headers['Authorization'] = 'Bearer ' . $this->config->authToken;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => $this->buildHeaders($headers),
                'content' => json_encode($request),
                'timeout' => $this->config->timeout,
                'ignore_errors' => true,
            ],
        ]);

        $response = @file_get_contents($this->config->baseUrl, false, $context);

        if ($response === false) {
            throw new RpcClientException(
                'Failed to connect to RPC server',
                statusCode: 0,
                rpcMethod: $request['method'],
            );
        }

        $decoded = json_decode($response, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new RpcClientException(
                'Invalid JSON response from server',
                statusCode: 500,
                rpcMethod: $request['method'],
            );
        }

        if (isset($decoded['error'])) {
            return new RpcResponse(
                data: null,
                error: $decoded['error']['message'] ?? 'Unknown error',
                statusCode: $decoded['error']['code'] ?? 500,
            );
        }

        return new RpcResponse(
            data: $decoded['result'] ?? null,
            error: null,
            statusCode: 200,
        );
    }

    /**
     * Build HTTP headers string
     */
    private function buildHeaders(array $headers): string
    {
        $lines = [];

        foreach ($headers as $name => $value) {
            $lines[] = "{$name}: {$value}";
        }

        return implode("\r\n", $lines);
    }
}
