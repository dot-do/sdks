package com.dotdo;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * DotDo Platform SDK for Java 21+.
 *
 * <p>The main entry point for interacting with the DotDo platform.
 * Provides authentication, connection pooling, retry logic, and high-level APIs.
 *
 * <p>Example usage:
 * <pre>{@code
 * // Create and configure the client
 * var client = DotDo.builder()
 *     .apiKey("your-api-key")
 *     .baseUrl("https://api.dotdo.com")
 *     .build();
 *
 * // Make authenticated requests
 * var result = client.call("todos.list").await();
 *
 * // With automatic retry
 * var created = client.withRetry(3)
 *     .call("todos.create", Map.of("title", "Buy milk"))
 *     .await();
 * }</pre>
 */
public final class DotDo implements AutoCloseable {

    private final Config config;
    private final HttpClient httpClient;
    private final ConnectionPool connectionPool;
    private final AuthManager authManager;
    private final RetryPolicy retryPolicy;
    private final ScheduledExecutorService scheduler;

    private volatile boolean closed = false;

    private DotDo(Config config) {
        this.config = config;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(config.connectTimeout())
                .executor(config.virtualThreads()
                        ? Executors.newVirtualThreadPerTaskExecutor()
                        : Executors.newCachedThreadPool())
                .build();
        this.connectionPool = new ConnectionPool(config.maxConnections());
        this.authManager = new AuthManager(config);
        this.retryPolicy = new RetryPolicy(config.maxRetries(), config.retryDelay());
        this.scheduler = Executors.newSingleThreadScheduledExecutor();
    }

    /**
     * Create a new DotDo client builder.
     *
     * @return a new builder instance
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Create a client with default configuration and API key.
     *
     * @param apiKey the API key for authentication
     * @return a new DotDo client
     */
    public static DotDo create(String apiKey) {
        return builder().apiKey(apiKey).build();
    }

    // =========================================================================
    // API Methods
    // =========================================================================

    /**
     * Make an authenticated RPC call.
     *
     * @param method the method name (e.g., "todos.list", "users.get")
     * @return a promise for the response
     */
    public Promise<Response> call(String method) {
        return call(method, null);
    }

    /**
     * Make an authenticated RPC call with parameters.
     *
     * @param method the method name
     * @param params the method parameters
     * @return a promise for the response
     */
    public Promise<Response> call(String method, Object params) {
        ensureNotClosed();

        return new Promise<>(retryPolicy.execute(() -> {
            var connection = connectionPool.acquire();
            try {
                String token = authManager.getToken();
                String jsonBody = buildJsonRpcRequest(method, params);

                var request = HttpRequest.newBuilder()
                        .uri(URI.create(config.baseUrl() + "/rpc"))
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .header("Authorization", "Bearer " + token)
                        .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                        .timeout(config.requestTimeout())
                        .build();

                return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                        .thenApply(response -> {
                            if (response.statusCode() == 401) {
                                authManager.invalidateToken();
                                throw new AuthException("Authentication failed");
                            }
                            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                                return parseResponse(response.body());
                            }
                            throw new DotDoException("HTTP " + response.statusCode() + ": " + response.body());
                        });
            } finally {
                connectionPool.release(connection);
            }
        }));
    }

    /**
     * Create a client with custom retry behavior.
     *
     * @param maxRetries maximum number of retry attempts
     * @return a client wrapper with custom retry settings
     */
    public RetryClient withRetry(int maxRetries) {
        return new RetryClient(this, maxRetries);
    }

    /**
     * Create a client with custom timeout.
     *
     * @param timeout the request timeout
     * @return a client wrapper with custom timeout
     */
    public TimeoutClient withTimeout(Duration timeout) {
        return new TimeoutClient(this, timeout);
    }

    // =========================================================================
    // Resource Management
    // =========================================================================

    private void ensureNotClosed() {
        if (closed) {
            throw new IllegalStateException("DotDo client has been closed");
        }
    }

    @Override
    public void close() {
        closed = true;
        scheduler.shutdown();
        connectionPool.close();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    // =========================================================================
    // JSON Serialization
    // =========================================================================

    private static final AtomicInteger requestIdGenerator = new AtomicInteger(0);

    private String buildJsonRpcRequest(String method, Object params) {
        int id = requestIdGenerator.incrementAndGet();
        var sb = new StringBuilder();
        sb.append("{\"jsonrpc\":\"2.0\",\"id\":").append(id);
        sb.append(",\"method\":\"").append(escapeJson(method)).append("\"");
        if (params != null) {
            sb.append(",\"params\":").append(serializeParams(params));
        }
        sb.append("}");
        return sb.toString();
    }

    private String serializeParams(Object params) {
        if (params == null) return "null";
        if (params instanceof String s) return "\"" + escapeJson(s) + "\"";
        if (params instanceof Number) return params.toString();
        if (params instanceof Boolean) return params.toString();
        if (params instanceof Map<?, ?> map) {
            var sb = new StringBuilder("{");
            boolean first = true;
            for (var entry : map.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append("\"").append(escapeJson(entry.getKey().toString())).append("\":");
                sb.append(serializeParams(entry.getValue()));
            }
            sb.append("}");
            return sb.toString();
        }
        if (params instanceof Iterable<?> list) {
            var sb = new StringBuilder("[");
            boolean first = true;
            for (var item : list) {
                if (!first) sb.append(",");
                first = false;
                sb.append(serializeParams(item));
            }
            sb.append("]");
            return sb.toString();
        }
        return "null";
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private Response parseResponse(String json) {
        // Simplified parsing - use Gson in production
        Object result = null;
        Object error = null;

        if (json.contains("\"error\":")) {
            int errorIdx = json.indexOf("\"error\":");
            if (errorIdx >= 0 && !json.substring(errorIdx).startsWith("\"error\":null")) {
                error = extractJsonValue(json, errorIdx + 8);
            }
        }

        if (json.contains("\"result\":")) {
            int resultIdx = json.indexOf("\"result\":");
            if (resultIdx >= 0) {
                result = extractJsonValue(json, resultIdx + 9);
            }
        }

        return new Response(result, error);
    }

    private Object extractJsonValue(String json, int start) {
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }
        if (start >= json.length()) return null;

        char c = json.charAt(start);
        if (c == '"') {
            int end = start + 1;
            while (end < json.length() && json.charAt(end) != '"') {
                if (json.charAt(end) == '\\') end++;
                end++;
            }
            return json.substring(start + 1, end);
        } else if (c == '{' || c == '[') {
            int depth = 1;
            int end = start + 1;
            while (end < json.length() && depth > 0) {
                char ch = json.charAt(end);
                if (ch == '{' || ch == '[') depth++;
                else if (ch == '}' || ch == ']') depth--;
                else if (ch == '"') {
                    end++;
                    while (end < json.length() && json.charAt(end) != '"') {
                        if (json.charAt(end) == '\\') end++;
                        end++;
                    }
                }
                end++;
            }
            return json.substring(start, end);
        } else if (c == 'n') {
            return null;
        } else if (c == 't') {
            return true;
        } else if (c == 'f') {
            return false;
        } else {
            int end = start;
            while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '.' || json.charAt(end) == '-')) {
                end++;
            }
            String numStr = json.substring(start, end);
            if (numStr.contains(".")) {
                return Double.parseDouble(numStr);
            } else {
                return Long.parseLong(numStr);
            }
        }
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * Client configuration.
     */
    public record Config(
            String baseUrl,
            String apiKey,
            String clientId,
            String clientSecret,
            Duration connectTimeout,
            Duration requestTimeout,
            int maxConnections,
            int maxRetries,
            Duration retryDelay,
            boolean virtualThreads
    ) {
        public static Config defaults() {
            return new Config(
                    "https://api.dotdo.com",
                    null,
                    null,
                    null,
                    Duration.ofSeconds(10),
                    Duration.ofSeconds(30),
                    10,
                    3,
                    Duration.ofMillis(100),
                    true
            );
        }
    }

    /**
     * Builder for DotDo client.
     */
    public static final class Builder {
        private String baseUrl = "https://api.dotdo.com";
        private String apiKey = null;
        private String clientId = null;
        private String clientSecret = null;
        private Duration connectTimeout = Duration.ofSeconds(10);
        private Duration requestTimeout = Duration.ofSeconds(30);
        private int maxConnections = 10;
        private int maxRetries = 3;
        private Duration retryDelay = Duration.ofMillis(100);
        private boolean virtualThreads = true;

        /**
         * Set the base URL for the DotDo API.
         */
        public Builder baseUrl(String url) {
            this.baseUrl = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
            return this;
        }

        /**
         * Set the API key for authentication.
         */
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        /**
         * Set OAuth2 client credentials.
         */
        public Builder oauth(String clientId, String clientSecret) {
            this.clientId = clientId;
            this.clientSecret = clientSecret;
            return this;
        }

        /**
         * Set the connection timeout.
         */
        public Builder connectTimeout(Duration timeout) {
            this.connectTimeout = timeout;
            return this;
        }

        /**
         * Set the request timeout.
         */
        public Builder requestTimeout(Duration timeout) {
            this.requestTimeout = timeout;
            return this;
        }

        /**
         * Set the maximum number of connections in the pool.
         */
        public Builder maxConnections(int max) {
            this.maxConnections = max;
            return this;
        }

        /**
         * Set the maximum number of retries.
         */
        public Builder maxRetries(int max) {
            this.maxRetries = max;
            return this;
        }

        /**
         * Set the delay between retries.
         */
        public Builder retryDelay(Duration delay) {
            this.retryDelay = delay;
            return this;
        }

        /**
         * Enable or disable virtual threads (default: enabled).
         */
        public Builder virtualThreads(boolean enabled) {
            this.virtualThreads = enabled;
            return this;
        }

        /**
         * Build the DotDo client.
         */
        public DotDo build() {
            if (apiKey == null && clientId == null) {
                throw new IllegalStateException("Either apiKey or oauth credentials must be provided");
            }
            var config = new Config(
                    baseUrl, apiKey, clientId, clientSecret,
                    connectTimeout, requestTimeout, maxConnections,
                    maxRetries, retryDelay, virtualThreads
            );
            return new DotDo(config);
        }
    }

    // =========================================================================
    // Promise with functional interface
    // =========================================================================

    /**
     * A promise for an async result.
     *
     * @param <T> the result type
     */
    public static final class Promise<T> {
        private final CompletableFuture<T> future;

        Promise(CompletableFuture<T> future) {
            this.future = future;
        }

        /**
         * Block until the result is available.
         */
        public T await() {
            try {
                return future.join();
            } catch (Exception e) {
                Throwable cause = e.getCause();
                if (cause instanceof DotDoException dde) {
                    throw dde;
                }
                throw new DotDoException(e.getMessage(), e);
            }
        }

        /**
         * Block with a timeout.
         */
        public T await(Duration timeout) {
            try {
                return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (java.util.concurrent.TimeoutException e) {
                throw new DotDoException("Request timed out after " + timeout);
            } catch (Exception e) {
                Throwable cause = e.getCause();
                if (cause instanceof DotDoException dde) {
                    throw dde;
                }
                throw new DotDoException(e.getMessage(), e);
            }
        }

        /**
         * Transform the result.
         */
        public <U> Promise<U> map(Function<T, U> mapper) {
            return new Promise<>(future.thenApply(mapper));
        }

        /**
         * Chain another async operation.
         */
        public <U> Promise<U> flatMap(Function<T, Promise<U>> mapper) {
            return new Promise<>(future.thenCompose(value -> mapper.apply(value).toFuture()));
        }

        /**
         * Handle errors.
         */
        public Promise<T> recover(Function<Throwable, T> handler) {
            return new Promise<>(future.exceptionally(handler));
        }

        /**
         * Get the underlying future.
         */
        public CompletableFuture<T> toFuture() {
            return future;
        }
    }

    // =========================================================================
    // Response
    // =========================================================================

    /**
     * API response.
     */
    public record Response(Object result, Object error) {
        /**
         * Get the result, throwing if there was an error.
         */
        public Object getResult() {
            if (error != null) {
                throw new DotDoException("API error: " + error);
            }
            return result;
        }

        /**
         * Check if successful.
         */
        public boolean isSuccess() {
            return error == null;
        }

        /**
         * Check if error.
         */
        public boolean isError() {
            return error != null;
        }
    }

    // =========================================================================
    // Authentication Manager
    // =========================================================================

    /**
     * Manages authentication tokens with automatic refresh.
     */
    static final class AuthManager {
        private final Config config;
        private final AtomicReference<TokenInfo> tokenRef = new AtomicReference<>();
        private final HttpClient httpClient = HttpClient.newHttpClient();

        AuthManager(Config config) {
            this.config = config;
        }

        String getToken() {
            // If API key is set, use it directly
            if (config.apiKey() != null) {
                return config.apiKey();
            }

            // Otherwise, use OAuth2 token
            TokenInfo token = tokenRef.get();
            if (token != null && !token.isExpired()) {
                return token.accessToken();
            }

            // Refresh token
            synchronized (this) {
                token = tokenRef.get();
                if (token == null || token.isExpired()) {
                    token = refreshToken();
                    tokenRef.set(token);
                }
            }
            return token.accessToken();
        }

        void invalidateToken() {
            tokenRef.set(null);
        }

        private TokenInfo refreshToken() {
            // OAuth2 client credentials flow
            String body = "grant_type=client_credentials" +
                    "&client_id=" + config.clientId() +
                    "&client_secret=" + config.clientSecret();

            var request = HttpRequest.newBuilder()
                    .uri(URI.create(config.baseUrl() + "/oauth/token"))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            try {
                var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) {
                    throw new AuthException("OAuth token refresh failed: " + response.body());
                }

                // Parse token response (simplified)
                String responseBody = response.body();
                String accessToken = extractStringValue(responseBody, "access_token");
                long expiresIn = extractLongValue(responseBody, "expires_in", 3600);

                return new TokenInfo(
                        accessToken,
                        Instant.now().plusSeconds(expiresIn - 60) // Refresh 60s before expiry
                );
            } catch (Exception e) {
                throw new AuthException("Failed to refresh token: " + e.getMessage(), e);
            }
        }

        private String extractStringValue(String json, String key) {
            int idx = json.indexOf("\"" + key + "\":");
            if (idx < 0) return null;
            int start = json.indexOf("\"", idx + key.length() + 3) + 1;
            int end = json.indexOf("\"", start);
            return json.substring(start, end);
        }

        private long extractLongValue(String json, String key, long defaultValue) {
            int idx = json.indexOf("\"" + key + "\":");
            if (idx < 0) return defaultValue;
            int start = idx + key.length() + 3;
            int end = start;
            while (end < json.length() && Character.isDigit(json.charAt(end))) {
                end++;
            }
            try {
                return Long.parseLong(json.substring(start, end));
            } catch (NumberFormatException e) {
                return defaultValue;
            }
        }

        record TokenInfo(String accessToken, Instant expiresAt) {
            boolean isExpired() {
                return Instant.now().isAfter(expiresAt);
            }
        }
    }

    // =========================================================================
    // Connection Pool
    // =========================================================================

    /**
     * Simple connection pool for managing HTTP connections.
     */
    static final class ConnectionPool implements AutoCloseable {
        private final int maxConnections;
        private final AtomicInteger activeConnections = new AtomicInteger(0);
        private final ConcurrentHashMap<Integer, ConnectionHandle> connections = new ConcurrentHashMap<>();
        private final AtomicInteger handleIdGenerator = new AtomicInteger(0);

        ConnectionPool(int maxConnections) {
            this.maxConnections = maxConnections;
        }

        ConnectionHandle acquire() {
            int current = activeConnections.get();
            if (current >= maxConnections) {
                // Wait for a connection to become available
                // In production, use a proper blocking queue
                while (activeConnections.get() >= maxConnections) {
                    try {
                        Thread.sleep(10);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new DotDoException("Interrupted while waiting for connection");
                    }
                }
            }

            activeConnections.incrementAndGet();
            int id = handleIdGenerator.incrementAndGet();
            var handle = new ConnectionHandle(id);
            connections.put(id, handle);
            return handle;
        }

        void release(ConnectionHandle handle) {
            if (connections.remove(handle.id()) != null) {
                activeConnections.decrementAndGet();
            }
        }

        @Override
        public void close() {
            connections.clear();
            activeConnections.set(0);
        }

        record ConnectionHandle(int id) {}
    }

    // =========================================================================
    // Retry Policy
    // =========================================================================

    /**
     * Implements retry logic with exponential backoff.
     */
    static final class RetryPolicy {
        private final int maxRetries;
        private final Duration baseDelay;

        RetryPolicy(int maxRetries, Duration baseDelay) {
            this.maxRetries = maxRetries;
            this.baseDelay = baseDelay;
        }

        <T> CompletableFuture<T> execute(Supplier<CompletableFuture<T>> operation) {
            return executeWithRetry(operation, 0);
        }

        private <T> CompletableFuture<T> executeWithRetry(Supplier<CompletableFuture<T>> operation, int attempt) {
            return operation.get().exceptionallyCompose(error -> {
                if (attempt >= maxRetries) {
                    return CompletableFuture.failedFuture(error);
                }

                // Check if error is retryable
                if (!isRetryable(error)) {
                    return CompletableFuture.failedFuture(error);
                }

                // Calculate delay with exponential backoff
                long delayMs = baseDelay.toMillis() * (1L << attempt);

                return CompletableFuture.runAsync(() -> {
                    try {
                        Thread.sleep(delayMs);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }).thenCompose(ignored -> executeWithRetry(operation, attempt + 1));
            });
        }

        private boolean isRetryable(Throwable error) {
            // Retry on connection errors and 5xx server errors
            if (error instanceof DotDoException dde) {
                String message = dde.getMessage();
                return message != null && (
                        message.contains("HTTP 5") ||
                        message.contains("Connection") ||
                        message.contains("timeout")
                );
            }
            return error instanceof java.io.IOException ||
                   error instanceof java.net.ConnectException ||
                   error instanceof java.net.SocketTimeoutException;
        }
    }

    // =========================================================================
    // Client Wrappers
    // =========================================================================

    /**
     * Client wrapper with custom retry settings.
     */
    public static final class RetryClient {
        private final DotDo client;
        private final RetryPolicy retryPolicy;

        RetryClient(DotDo client, int maxRetries) {
            this.client = client;
            this.retryPolicy = new RetryPolicy(maxRetries, client.config.retryDelay());
        }

        public Promise<Response> call(String method) {
            return call(method, null);
        }

        public Promise<Response> call(String method, Object params) {
            client.ensureNotClosed();
            return new Promise<>(retryPolicy.execute(() -> client.call(method, params).toFuture()));
        }
    }

    /**
     * Client wrapper with custom timeout.
     */
    public static final class TimeoutClient {
        private final DotDo client;
        private final Duration timeout;

        TimeoutClient(DotDo client, Duration timeout) {
            this.client = client;
            this.timeout = timeout;
        }

        public Promise<Response> call(String method) {
            return call(method, null);
        }

        public Promise<Response> call(String method, Object params) {
            var promise = client.call(method, params);
            return new Promise<>(promise.toFuture().orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS));
        }
    }

    // =========================================================================
    // Exceptions
    // =========================================================================

    /**
     * Base exception for DotDo operations.
     */
    public static class DotDoException extends RuntimeException {
        public DotDoException(String message) {
            super(message);
        }

        public DotDoException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Authentication exception.
     */
    public static class AuthException extends DotDoException {
        public AuthException(String message) {
            super(message);
        }

        public AuthException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
