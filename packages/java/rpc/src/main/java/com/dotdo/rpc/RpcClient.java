package com.dotdo.rpc;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * RPC Client for DotDo platform.
 *
 * <p>Provides low-level RPC capabilities with support for both HTTP and WebSocket transports.
 * Designed for Java 21+ with virtual thread support.
 *
 * <p>Example usage:
 * <pre>{@code
 * try (var client = RpcClient.create("https://api.dotdo.com")) {
 *     var result = client.call("users.get", Map.of("id", "123"))
 *         .map(response -> response.get("user"))
 *         .await();
 *     System.out.println(result);
 * }
 * }</pre>
 */
public final class RpcClient implements AutoCloseable {

    private final String baseUrl;
    private final Config config;
    private final HttpClient httpClient;
    private final AtomicLong requestId = new AtomicLong(0);
    private final ConcurrentHashMap<Long, CompletableFuture<RpcResponse>> pending = new ConcurrentHashMap<>();

    private volatile WebSocket webSocket;
    private volatile boolean closed = false;

    private RpcClient(String baseUrl, Config config) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.config = config;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(config.connectTimeout())
                .build();
    }

    /**
     * Create a new RPC client.
     *
     * @param baseUrl the base URL of the RPC server
     * @return a new RpcClient instance
     */
    public static RpcClient create(String baseUrl) {
        return new RpcClient(baseUrl, Config.defaults());
    }

    /**
     * Create a new RPC client with custom configuration.
     *
     * @param baseUrl the base URL of the RPC server
     * @param config the client configuration
     * @return a new RpcClient instance
     */
    public static RpcClient create(String baseUrl, Config config) {
        return new RpcClient(baseUrl, config);
    }

    /**
     * Create a configuration builder.
     *
     * @return a new ConfigBuilder
     */
    public static ConfigBuilder builder() {
        return new ConfigBuilder();
    }

    // =========================================================================
    // RPC Methods
    // =========================================================================

    /**
     * Make an RPC call.
     *
     * @param method the method name (e.g., "users.get", "todos.create")
     * @param params the method parameters
     * @return a promise for the response
     */
    public RpcPromise<RpcResponse> call(String method, Object params) {
        long id = requestId.incrementAndGet();
        var future = new CompletableFuture<RpcResponse>();

        if (closed) {
            future.completeExceptionally(new RpcException("Client is closed"));
            return new RpcPromise<>(future);
        }

        try {
            String jsonBody = buildJsonRpcRequest(id, method, params);

            var request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/rpc"))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                    .timeout(config.requestTimeout())
                    .build();

            if (config.authToken() != null) {
                request = HttpRequest.newBuilder(request, (n, v) -> true)
                        .header("Authorization", "Bearer " + config.authToken())
                        .build();
            }

            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenApply(response -> {
                        if (response.statusCode() >= 200 && response.statusCode() < 300) {
                            return parseJsonRpcResponse(response.body());
                        } else {
                            throw new RpcException("HTTP " + response.statusCode() + ": " + response.body());
                        }
                    })
                    .whenComplete((response, error) -> {
                        if (error != null) {
                            future.completeExceptionally(error);
                        } else {
                            future.complete(response);
                        }
                    });

        } catch (Exception e) {
            future.completeExceptionally(new RpcException("Request failed: " + e.getMessage(), e));
        }

        return new RpcPromise<>(future);
    }

    /**
     * Make an RPC call without parameters.
     *
     * @param method the method name
     * @return a promise for the response
     */
    public RpcPromise<RpcResponse> call(String method) {
        return call(method, null);
    }

    // =========================================================================
    // WebSocket Support
    // =========================================================================

    /**
     * Connect via WebSocket for streaming/bidirectional RPC.
     *
     * @return a CompletableFuture that completes when connected
     */
    public CompletableFuture<Void> connectWebSocket() {
        String wsUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://") + "/ws";

        var listener = new WebSocket.Listener() {
            private final StringBuilder buffer = new StringBuilder();

            @Override
            public void onOpen(WebSocket ws) {
                webSocket = ws;
                ws.request(1);
            }

            @Override
            public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                buffer.append(data);
                if (last) {
                    handleWebSocketMessage(buffer.toString());
                    buffer.setLength(0);
                }
                ws.request(1);
                return null;
            }

            @Override
            public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
                webSocket = null;
                failAllPending(new RpcException("WebSocket closed: " + reason));
                return null;
            }

            @Override
            public void onError(WebSocket ws, Throwable error) {
                webSocket = null;
                failAllPending(new RpcException("WebSocket error: " + error.getMessage(), error));
            }
        };

        return httpClient.newWebSocketBuilder()
                .connectTimeout(config.connectTimeout())
                .buildAsync(URI.create(wsUrl), listener)
                .thenApply(ws -> null);
    }

    private void handleWebSocketMessage(String message) {
        // Parse JSON-RPC response and complete pending future
        try {
            RpcResponse response = parseJsonRpcResponse(message);
            Long id = response.id();
            if (id != null && pending.containsKey(id)) {
                CompletableFuture<RpcResponse> future = pending.remove(id);
                if (response.error() != null) {
                    future.completeExceptionally(new RpcException(response.error().toString()));
                } else {
                    future.complete(response);
                }
            }
        } catch (Exception e) {
            // Log error but don't crash
        }
    }

    private void failAllPending(RpcException error) {
        pending.forEach((id, future) -> future.completeExceptionally(error));
        pending.clear();
    }

    // =========================================================================
    // JSON-RPC Serialization
    // =========================================================================

    private String buildJsonRpcRequest(long id, String method, Object params) {
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
        if (params instanceof java.util.Map<?, ?> map) {
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
        if (params instanceof java.util.List<?> list) {
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

    private RpcResponse parseJsonRpcResponse(String json) {
        // Simple JSON parsing - in production, use a proper JSON library
        // This is a minimal implementation for the SDK
        Long id = null;
        Object result = null;
        Object error = null;

        // Extract id
        int idIdx = json.indexOf("\"id\":");
        if (idIdx >= 0) {
            int start = idIdx + 5;
            int end = start;
            while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) {
                end++;
            }
            if (end > start) {
                try {
                    id = Long.parseLong(json.substring(start, end).trim());
                } catch (NumberFormatException e) {
                    // id might be null or string
                }
            }
        }

        // Check for error
        if (json.contains("\"error\":")) {
            int errorIdx = json.indexOf("\"error\":");
            if (errorIdx >= 0) {
                error = extractJsonValue(json, errorIdx + 8);
            }
        }

        // Extract result
        if (json.contains("\"result\":")) {
            int resultIdx = json.indexOf("\"result\":");
            if (resultIdx >= 0) {
                result = extractJsonValue(json, resultIdx + 9);
            }
        }

        return new RpcResponse(id, result, error);
    }

    private Object extractJsonValue(String json, int start) {
        // Skip whitespace
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }
        if (start >= json.length()) return null;

        char c = json.charAt(start);
        if (c == '"') {
            // String value
            int end = start + 1;
            while (end < json.length() && json.charAt(end) != '"') {
                if (json.charAt(end) == '\\') end++;
                end++;
            }
            return json.substring(start + 1, end);
        } else if (c == '{' || c == '[') {
            // Object or array - return as string for now
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
            // Number
            int end = start;
            while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '.' || json.charAt(end) == '-' || json.charAt(end) == 'e' || json.charAt(end) == 'E')) {
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

    @Override
    public void close() {
        closed = true;
        if (webSocket != null) {
            webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "");
        }
        failAllPending(new RpcException("Client closed"));
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * RPC client configuration.
     */
    public record Config(
            Duration connectTimeout,
            Duration requestTimeout,
            String authToken,
            int maxRetries,
            Duration retryDelay
    ) {
        public static Config defaults() {
            return new Config(
                    Duration.ofSeconds(10),
                    Duration.ofSeconds(30),
                    null,
                    3,
                    Duration.ofMillis(100)
            );
        }
    }

    /**
     * Builder for RPC client configuration.
     */
    public static final class ConfigBuilder {
        private Duration connectTimeout = Duration.ofSeconds(10);
        private Duration requestTimeout = Duration.ofSeconds(30);
        private String authToken = null;
        private int maxRetries = 3;
        private Duration retryDelay = Duration.ofMillis(100);

        public ConfigBuilder connectTimeout(Duration timeout) {
            this.connectTimeout = timeout;
            return this;
        }

        public ConfigBuilder requestTimeout(Duration timeout) {
            this.requestTimeout = timeout;
            return this;
        }

        public ConfigBuilder auth(String token) {
            this.authToken = token;
            return this;
        }

        public ConfigBuilder maxRetries(int retries) {
            this.maxRetries = retries;
            return this;
        }

        public ConfigBuilder retryDelay(Duration delay) {
            this.retryDelay = delay;
            return this;
        }

        public Config build() {
            return new Config(connectTimeout, requestTimeout, authToken, maxRetries, retryDelay);
        }

        public RpcClient create(String baseUrl) {
            return RpcClient.create(baseUrl, build());
        }
    }

    // =========================================================================
    // RpcPromise with map() support
    // =========================================================================

    /**
     * A promise for an RPC response with functional transformation support.
     *
     * @param <T> the response type
     */
    public static final class RpcPromise<T> {
        private final CompletableFuture<T> future;

        RpcPromise(CompletableFuture<T> future) {
            this.future = future;
        }

        /**
         * Block until the result is available.
         *
         * @return the result
         * @throws RpcException if the call failed
         */
        public T await() {
            try {
                return future.join();
            } catch (Exception e) {
                Throwable cause = e.getCause();
                if (cause instanceof RpcException rpc) {
                    throw rpc;
                }
                throw new RpcException(e.getMessage(), e);
            }
        }

        /**
         * Block with a timeout.
         *
         * @param timeout maximum wait time
         * @return the result
         * @throws RpcException if the call failed or timed out
         */
        public T await(Duration timeout) {
            try {
                return future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            } catch (java.util.concurrent.TimeoutException e) {
                throw new RpcException("Request timed out after " + timeout);
            } catch (Exception e) {
                Throwable cause = e.getCause();
                if (cause instanceof RpcException rpc) {
                    throw rpc;
                }
                throw new RpcException(e.getMessage(), e);
            }
        }

        /**
         * Transform the result using a mapping function.
         *
         * <p>This is the functional interface method for transforming RPC responses.
         *
         * <p>Example:
         * <pre>{@code
         * String userName = client.call("users.get", params)
         *     .map(response -> response.result())
         *     .map(result -> ((Map<?, ?>) result).get("name"))
         *     .map(Object::toString)
         *     .await();
         * }</pre>
         *
         * @param mapper the transformation function
         * @param <U> the new result type
         * @return a new promise for the transformed result
         */
        public <U> RpcPromise<U> map(Function<T, U> mapper) {
            return new RpcPromise<>(future.thenApply(mapper));
        }

        /**
         * Transform the result with a function that returns a promise (flatMap).
         *
         * @param mapper the transformation function returning a promise
         * @param <U> the new result type
         * @return a new promise for the transformed result
         */
        public <U> RpcPromise<U> flatMap(Function<T, RpcPromise<U>> mapper) {
            return new RpcPromise<>(future.thenCompose(value -> mapper.apply(value).toFuture()));
        }

        /**
         * Handle errors with a recovery function.
         *
         * @param handler the error handler
         * @return a new promise that may recover from errors
         */
        public RpcPromise<T> recover(Function<Throwable, T> handler) {
            return new RpcPromise<>(future.exceptionally(handler));
        }

        /**
         * Execute a side effect when the result is available.
         *
         * @param action the action to execute
         * @return this promise for chaining
         */
        public RpcPromise<T> onSuccess(java.util.function.Consumer<T> action) {
            future.thenAccept(action);
            return this;
        }

        /**
         * Execute a side effect when an error occurs.
         *
         * @param action the action to execute
         * @return this promise for chaining
         */
        public RpcPromise<T> onError(java.util.function.Consumer<Throwable> action) {
            future.exceptionally(error -> {
                action.accept(error);
                return null;
            });
            return this;
        }

        /**
         * Get the underlying CompletableFuture.
         *
         * @return the future
         */
        public CompletableFuture<T> toFuture() {
            return future;
        }
    }

    // =========================================================================
    // RpcResponse
    // =========================================================================

    /**
     * An RPC response.
     */
    public record RpcResponse(
            Long id,
            Object result,
            Object error
    ) {
        /**
         * Get the result, throwing if there was an error.
         *
         * @return the result
         * @throws RpcException if there was an error
         */
        public Object getResult() {
            if (error != null) {
                throw new RpcException("RPC error: " + error);
            }
            return result;
        }

        /**
         * Check if this response contains an error.
         *
         * @return true if there was an error
         */
        public boolean isError() {
            return error != null;
        }

        /**
         * Check if this response was successful.
         *
         * @return true if successful
         */
        public boolean isSuccess() {
            return error == null;
        }
    }

    // =========================================================================
    // RpcException
    // =========================================================================

    /**
     * Exception thrown by RPC operations.
     */
    public static class RpcException extends RuntimeException {
        public RpcException(String message) {
            super(message);
        }

        public RpcException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
