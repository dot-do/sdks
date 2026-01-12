package com.dotdo.capnweb;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * Cap'n Web SDK for Java 21+.
 *
 * <p>Provides capability-based RPC with promise pipelining, designed for virtual threads.
 *
 * <p>Example usage:
 * <pre>{@code
 * try (var session = CapnWeb.connect("wss://api.example.com/rpc")) {
 *     var result = session.call("square", 5).await();
 *     System.out.println(result); // 25
 * }
 * }</pre>
 */
public final class CapnWeb {

    private CapnWeb() {
        // Static utility class
    }

    /**
     * Connect to a Cap'n Web server.
     *
     * @param url the WebSocket URL of the server
     * @return a connected session
     * @throws RpcError if connection fails
     */
    public static Session connect(String url) {
        return connect(url, Config.defaults());
    }

    /**
     * Connect to a Cap'n Web server with custom configuration.
     *
     * @param url the WebSocket URL of the server
     * @param config connection configuration
     * @return a connected session
     * @throws RpcError if connection fails
     */
    public static Session connect(String url, Config config) {
        return new SessionImpl(url, config);
    }

    /**
     * Create a configuration builder.
     *
     * @param url the WebSocket URL
     * @return a new builder
     */
    public static ConfigBuilder builder(String url) {
        return new ConfigBuilder(url);
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * Connection configuration.
     */
    public record Config(
            Duration timeout,
            Duration pingInterval,
            String authToken,
            boolean virtualThreads
    ) {
        public static Config defaults() {
            return new Config(
                    Duration.ofSeconds(30),
                    Duration.ofSeconds(30),
                    null,
                    true
            );
        }
    }

    /**
     * Builder for connection configuration.
     */
    public static final class ConfigBuilder {
        private final String url;
        private Duration timeout = Duration.ofSeconds(30);
        private Duration pingInterval = Duration.ofSeconds(30);
        private String authToken = null;
        private boolean virtualThreads = true;

        ConfigBuilder(String url) {
            this.url = url;
        }

        public ConfigBuilder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        public ConfigBuilder pingInterval(Duration interval) {
            this.pingInterval = interval;
            return this;
        }

        public ConfigBuilder auth(String token) {
            this.authToken = token;
            return this;
        }

        public ConfigBuilder virtualThreads(boolean enabled) {
            this.virtualThreads = enabled;
            return this;
        }

        public Config build() {
            return new Config(timeout, pingInterval, authToken, virtualThreads);
        }

        public Session connect() {
            return CapnWeb.connect(url, build());
        }
    }

    // =========================================================================
    // Session
    // =========================================================================

    /**
     * A connected RPC session.
     *
     * <p>Sessions are thread-safe and can be shared across virtual threads.
     * Use try-with-resources for automatic cleanup.
     */
    public sealed interface Session extends AutoCloseable permits SessionImpl {

        /**
         * Call a method on the root capability.
         *
         * @param method the method name
         * @param args method arguments
         * @return a promise for the result
         */
        RpcPromise<Object> call(String method, Object... args);

        /**
         * Get a capability reference for pipelining.
         *
         * @param name capability name
         * @return a capability stub
         */
        Capability capability(String name);

        /**
         * Create a pipeline builder for batched calls.
         *
         * @return a new pipeline
         */
        Pipeline pipeline();

        /**
         * Check if the session is connected.
         *
         * @return true if connected
         */
        boolean isConnected();

        @Override
        void close();
    }

    /**
     * Internal session implementation.
     */
    static final class SessionImpl implements Session {
        private final String url;
        private final Config config;
        private final AtomicLong callId = new AtomicLong(0);
        private final ConcurrentHashMap<Long, CompletableFuture<Object>> pending = new ConcurrentHashMap<>();
        private volatile boolean connected = false;
        private WebSocket webSocket;

        SessionImpl(String url, Config config) {
            this.url = url;
            this.config = config;
            connect();
        }

        private void connect() {
            try {
                var client = HttpClient.newBuilder()
                        .connectTimeout(config.timeout())
                        .build();

                var listener = new WebSocket.Listener() {
                    private final StringBuilder messageBuffer = new StringBuilder();

                    @Override
                    public void onOpen(WebSocket webSocket) {
                        connected = true;
                        webSocket.request(1);
                    }

                    @Override
                    public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                        messageBuffer.append(data);
                        if (last) {
                            handleMessage(messageBuffer.toString());
                            messageBuffer.setLength(0);
                        }
                        webSocket.request(1);
                        return null;
                    }

                    @Override
                    public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                        connected = false;
                        return null;
                    }

                    @Override
                    public void onError(WebSocket webSocket, Throwable error) {
                        connected = false;
                        // Reject all pending calls
                        pending.forEach((id, future) ->
                                future.completeExceptionally(new RpcError.ConnectionError(error.getMessage()))
                        );
                        pending.clear();
                    }
                };

                this.webSocket = client.newWebSocketBuilder()
                        .connectTimeout(config.timeout())
                        .buildAsync(URI.create(url), listener)
                        .join();

            } catch (Exception e) {
                throw new RpcError.ConnectionError("Failed to connect: " + e.getMessage());
            }
        }

        private void handleMessage(String message) {
            // TODO: Parse JSON-RPC response and complete pending futures
            // This is a stub implementation
        }

        @Override
        public RpcPromise<Object> call(String method, Object... args) {
            long id = callId.incrementAndGet();
            var future = new CompletableFuture<Object>();
            pending.put(id, future);

            // Build and send the RPC message
            // TODO: Implement actual message sending
            String json = buildCallMessage(id, method, args);

            if (webSocket != null && connected) {
                webSocket.sendText(json, true);
            } else {
                future.completeExceptionally(new RpcError.ConnectionError("Not connected"));
            }

            return new RpcPromiseImpl<>(future);
        }

        private String buildCallMessage(long id, String method, Object[] args) {
            // TODO: Use proper JSON serialization
            var sb = new StringBuilder();
            sb.append("{\"id\":").append(id);
            sb.append(",\"method\":\"").append(method).append("\"");
            sb.append(",\"args\":[");
            for (int i = 0; i < args.length; i++) {
                if (i > 0) sb.append(",");
                sb.append(serializeArg(args[i]));
            }
            sb.append("]}");
            return sb.toString();
        }

        private String serializeArg(Object arg) {
            if (arg == null) return "null";
            if (arg instanceof String s) return "\"" + s.replace("\"", "\\\"") + "\"";
            if (arg instanceof Number) return arg.toString();
            if (arg instanceof Boolean) return arg.toString();
            return "null"; // TODO: Complex types
        }

        @Override
        public Capability capability(String name) {
            return new CapabilityImpl(this, name);
        }

        @Override
        public Pipeline pipeline() {
            return new PipelineImpl(this);
        }

        @Override
        public boolean isConnected() {
            return connected;
        }

        @Override
        public void close() {
            connected = false;
            if (webSocket != null) {
                webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "");
            }
            pending.forEach((id, future) ->
                    future.completeExceptionally(new RpcError.ConnectionError("Session closed"))
            );
            pending.clear();
        }
    }

    // =========================================================================
    // RpcPromise
    // =========================================================================

    /**
     * A promise for an RPC result.
     *
     * <p>Supports pipelining: you can call methods on the promise before awaiting it.
     *
     * @param <T> the result type
     */
    public sealed interface RpcPromise<T> permits RpcPromiseImpl {

        /**
         * Block until the result is available.
         *
         * @return the result
         * @throws RpcError if the call failed
         */
        T await();

        /**
         * Block with a timeout.
         *
         * @param timeout maximum wait time
         * @return the result
         * @throws RpcError if the call failed or timed out
         */
        T await(Duration timeout);

        /**
         * Pipeline a method call on the result.
         *
         * @param method the method to call
         * @param args method arguments
         * @return a promise for that call's result
         */
        RpcPromise<Object> call(String method, Object... args);

        /**
         * Transform the result.
         *
         * @param mapper transformation function
         * @param <U> the new result type
         * @return a promise for the transformed result
         */
        <U> RpcPromise<U> map(Function<T, U> mapper);

        /**
         * Get the underlying CompletableFuture.
         *
         * @return the future
         */
        CompletableFuture<T> toFuture();
    }

    /**
     * Internal RpcPromise implementation.
     */
    static final class RpcPromiseImpl<T> implements RpcPromise<T> {
        private final CompletableFuture<T> future;

        RpcPromiseImpl(CompletableFuture<T> future) {
            this.future = future;
        }

        @Override
        public T await() {
            try {
                return future.join();
            } catch (Exception e) {
                if (e.getCause() instanceof RpcError rpcError) {
                    throw rpcError;
                }
                throw new RpcError.InternalError(e.getMessage());
            }
        }

        @Override
        public T await(Duration timeout) {
            try {
                return future.orTimeout(timeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS).join();
            } catch (Exception e) {
                if (e.getCause() instanceof java.util.concurrent.TimeoutException) {
                    throw new RpcError.TimeoutError("Call timed out after " + timeout);
                }
                if (e.getCause() instanceof RpcError rpcError) {
                    throw rpcError;
                }
                throw new RpcError.InternalError(e.getMessage());
            }
        }

        @Override
        public RpcPromise<Object> call(String method, Object... args) {
            // Pipelined call - will be sent with the original call
            var nextFuture = future.thenCompose(result -> {
                // TODO: Implement actual pipelining
                return CompletableFuture.completedFuture((Object) null);
            });
            return new RpcPromiseImpl<>(nextFuture);
        }

        @Override
        public <U> RpcPromise<U> map(Function<T, U> mapper) {
            return new RpcPromiseImpl<>(future.thenApply(mapper));
        }

        @Override
        public CompletableFuture<T> toFuture() {
            return future;
        }
    }

    // =========================================================================
    // Capability
    // =========================================================================

    /**
     * A capability reference for pipelining.
     */
    public sealed interface Capability permits CapabilityImpl {

        /**
         * Call a method on this capability.
         *
         * @param method the method name
         * @param args method arguments
         * @return a promise for the result
         */
        RpcPromise<Object> call(String method, Object... args);

        /**
         * Get a nested capability.
         *
         * @param name capability name
         * @return the nested capability
         */
        Capability get(String name);
    }

    /**
     * Internal Capability implementation.
     */
    static final class CapabilityImpl implements Capability {
        private final SessionImpl session;
        private final String path;

        CapabilityImpl(SessionImpl session, String path) {
            this.session = session;
            this.path = path;
        }

        @Override
        public RpcPromise<Object> call(String method, Object... args) {
            String fullMethod = path.isEmpty() ? method : path + "." + method;
            return session.call(fullMethod, args);
        }

        @Override
        public Capability get(String name) {
            String newPath = path.isEmpty() ? name : path + "." + name;
            return new CapabilityImpl(session, newPath);
        }
    }

    // =========================================================================
    // Pipeline
    // =========================================================================

    /**
     * A pipeline builder for batched calls.
     */
    public sealed interface Pipeline permits PipelineImpl {

        /**
         * Add a call to the pipeline.
         *
         * @param method the method name
         * @param args method arguments
         * @return this pipeline for chaining
         */
        Pipeline call(String method, Object... args);

        /**
         * Execute all pipelined calls in a single round trip.
         *
         * @return the final result
         */
        Object execute();
    }

    /**
     * Internal Pipeline implementation.
     */
    static final class PipelineImpl implements Pipeline {
        private final SessionImpl session;
        private RpcPromise<Object> lastPromise;

        PipelineImpl(SessionImpl session) {
            this.session = session;
        }

        @Override
        public Pipeline call(String method, Object... args) {
            if (lastPromise == null) {
                lastPromise = session.call(method, args);
            } else {
                lastPromise = lastPromise.call(method, args);
            }
            return this;
        }

        @Override
        public Object execute() {
            if (lastPromise == null) {
                return null;
            }
            return lastPromise.await();
        }
    }

    // =========================================================================
    // RpcError
    // =========================================================================

    /**
     * Sealed hierarchy of RPC errors.
     *
     * <p>Use pattern matching for exhaustive error handling:
     * <pre>{@code
     * try {
     *     session.call("method").await();
     * } catch (RpcError e) {
     *     switch (e) {
     *         case RpcError.NotFound(var resource, var id) ->
     *             System.out.println(resource + " " + id + " not found");
     *         case RpcError.PermissionDenied(var action, var reason) ->
     *             System.out.println("Cannot " + action + ": " + reason);
     *         case RpcError.ConnectionError(var message) ->
     *             System.out.println("Connection failed: " + message);
     *         // ... handle other cases
     *     }
     * }
     * }</pre>
     */
    public sealed abstract class RpcError extends RuntimeException {

        protected RpcError(String message) {
            super(message);
        }

        protected RpcError(String message, Throwable cause) {
            super(message, cause);
        }

        /**
         * Resource not found.
         */
        public static final class NotFound extends RpcError {
            private final String resource;
            private final String id;

            public NotFound(String resource, String id) {
                super(resource + " '" + id + "' not found");
                this.resource = resource;
                this.id = id;
            }

            public String resource() { return resource; }
            public String id() { return id; }
        }

        /**
         * Permission denied.
         */
        public static final class PermissionDenied extends RpcError {
            private final String action;
            private final String reason;

            public PermissionDenied(String action, String reason) {
                super("Cannot " + action + ": " + reason);
                this.action = action;
                this.reason = reason;
            }

            public String action() { return action; }
            public String reason() { return reason; }
        }

        /**
         * Invalid input.
         */
        public static final class InvalidInput extends RpcError {
            private final String field;

            public InvalidInput(String field, String message) {
                super("Invalid " + field + ": " + message);
                this.field = field;
            }

            public String field() { return field; }
        }

        /**
         * Service unavailable.
         */
        public static final class Unavailable extends RpcError {
            private final Duration retryAfter;

            public Unavailable(Duration retryAfter) {
                super("Service unavailable. Retry after " + retryAfter);
                this.retryAfter = retryAfter;
            }

            public Duration retryAfter() { return retryAfter; }
        }

        /**
         * Rate limited.
         */
        public static final class RateLimited extends RpcError {
            private final int limit;
            private final Duration resetAfter;

            public RateLimited(int limit, Duration resetAfter) {
                super("Rate limited (" + limit + "/min). Resets in " + resetAfter);
                this.limit = limit;
                this.resetAfter = resetAfter;
            }

            public int limit() { return limit; }
            public Duration resetAfter() { return resetAfter; }
        }

        /**
         * Connection error.
         */
        public static final class ConnectionError extends RpcError {
            public ConnectionError(String message) {
                super(message);
            }
        }

        /**
         * Timeout error.
         */
        public static final class TimeoutError extends RpcError {
            public TimeoutError(String message) {
                super(message);
            }
        }

        /**
         * Internal server error.
         */
        public static final class InternalError extends RpcError {
            public InternalError(String message) {
                super(message);
            }
        }

        /**
         * Method not found.
         */
        public static final class MethodNotFound extends RpcError {
            private final String method;

            public MethodNotFound(String method) {
                super("Method '" + method + "' not found");
                this.method = method;
            }

            public String method() { return method; }
        }

        /**
         * Generic RPC error from the server.
         */
        public static final class ServerError extends RpcError {
            private final String type;
            private final String serverMessage;

            public ServerError(String type, String message) {
                super(type + ": " + message);
                this.type = type;
                this.serverMessage = message;
            }

            public String type() { return type; }
            public String serverMessage() { return serverMessage; }
        }
    }
}
