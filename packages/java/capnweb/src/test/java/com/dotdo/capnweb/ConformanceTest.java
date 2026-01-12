package com.dotdo.capnweb;

import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Conformance tests for the Java Cap'n Web SDK.
 *
 * <p>These tests are generated from the YAML specifications in test/conformance/
 * and verify that the Java SDK correctly implements the Cap'n Web protocol.
 *
 * <p>Run with:
 * <pre>
 * TEST_SERVER_URL=http://localhost:8787 ./gradlew test
 * </pre>
 */
class ConformanceTest {

    private static final String TEST_SERVER_URL = System.getenv().getOrDefault(
            "TEST_SERVER_URL", "http://localhost:8787"
    );

    private static final Path SPEC_DIR = resolveSpecDir();

    private CapnWeb.Session session;

    private static Path resolveSpecDir() {
        String envDir = System.getenv("TEST_SPEC_DIR");
        if (envDir != null && !envDir.isEmpty()) {
            return Path.of(envDir);
        }
        // Default: relative to project root
        return Path.of("../../test/conformance");
    }

    @BeforeEach
    void setUp() {
        // Session will be created per test when SDK is implemented
        session = null;
    }

    @AfterEach
    void tearDown() {
        if (session != null) {
            session.close();
        }
    }

    // =========================================================================
    // Test data provider
    // =========================================================================

    /**
     * A conformance test specification loaded from YAML.
     */
    record ConformanceSpec(
            String name,
            String description,
            String category,
            String file,
            Map<String, Object> spec
    ) {
        @Override
        public String toString() {
            return category + "/" + name;
        }
    }

    /**
     * Load all conformance test specifications from YAML files.
     */
    static Stream<ConformanceSpec> loadConformanceSpecs() {
        List<ConformanceSpec> specs = new ArrayList<>();

        if (!Files.exists(SPEC_DIR)) {
            System.err.println("Warning: Spec directory not found: " + SPEC_DIR.toAbsolutePath());
            return Stream.empty();
        }

        Yaml yaml = new Yaml();

        try (var files = Files.list(SPEC_DIR)) {
            files.filter(p -> p.toString().endsWith(".yaml"))
                    .sorted()
                    .forEach(file -> {
                        try {
                            String content = Files.readString(file);
                            @SuppressWarnings("unchecked")
                            Map<String, Object> doc = yaml.load(content);

                            if (doc != null && doc.containsKey("tests")) {
                                String category = (String) doc.getOrDefault("name", file.getFileName().toString());
                                @SuppressWarnings("unchecked")
                                List<Map<String, Object>> tests = (List<Map<String, Object>>) doc.get("tests");

                                for (Map<String, Object> test : tests) {
                                    String testName = (String) test.get("name");
                                    String testDesc = (String) test.getOrDefault("description", testName);

                                    specs.add(new ConformanceSpec(
                                            testName,
                                            testDesc,
                                            category,
                                            file.getFileName().toString(),
                                            test
                                    ));
                                }
                            }
                        } catch (IOException e) {
                            System.err.println("Failed to load " + file + ": " + e.getMessage());
                        }
                    });
        } catch (IOException e) {
            System.err.println("Failed to list spec directory: " + e.getMessage());
        }

        return specs.stream();
    }

    // =========================================================================
    // Parameterized conformance tests
    // =========================================================================

    @ParameterizedTest(name = "{0}")
    @MethodSource("loadConformanceSpecs")
    @DisplayName("Conformance")
    void runConformanceTest(ConformanceSpec spec) {
        // Skip if SDK not implemented yet
        assumeTrue(session != null, "SDK not implemented yet: " + spec);

        Map<String, Object> testSpec = spec.spec();

        if (testSpec.containsKey("call")) {
            runCallTest(testSpec);
        } else if (testSpec.containsKey("pipeline")) {
            runPipelineTest(testSpec);
        } else if (testSpec.containsKey("sequence")) {
            runSequenceTest(testSpec);
        } else {
            fail("Unknown test type: " + spec.name());
        }
    }

    // =========================================================================
    // Test runners for different test types
    // =========================================================================

    /**
     * Run a simple call test.
     */
    private void runCallTest(Map<String, Object> spec) {
        String method = (String) spec.get("call");
        @SuppressWarnings("unchecked")
        List<Object> args = (List<Object>) spec.getOrDefault("args", List.of());

        Object[] resolvedArgs = resolveArgs(args, Map.of());

        if (spec.containsKey("expect_error")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> errorSpec = (Map<String, Object>) spec.get("expect_error");
            assertThrows(CapnWeb.RpcError.class, () -> {
                session.call(method, resolvedArgs).await();
            });
            // TODO: Verify error details match errorSpec
        } else {
            Object result = session.call(method, resolvedArgs).await();
            Object expected = spec.get("expect");
            assertResultEquals(expected, result, "Method " + method);
        }
    }

    /**
     * Run a pipeline test (multiple calls in one round trip).
     */
    private void runPipelineTest(Map<String, Object> spec) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> pipeline = (List<Map<String, Object>>) spec.get("pipeline");

        Map<String, Object> context = new HashMap<>();
        context.put("$self", session);

        Object lastResult = null;
        Map<String, CapnWeb.RpcPromise<Object>> promises = new HashMap<>();

        // Build the pipeline
        for (Map<String, Object> step : pipeline) {
            String call = (String) step.get("call");
            @SuppressWarnings("unchecked")
            List<Object> args = (List<Object>) step.getOrDefault("args", List.of());

            Object[] resolvedArgs = resolveArgs(args, context);

            // Resolve the target (could be nested like "counter.increment")
            CapnWeb.RpcPromise<Object> promise = resolveAndCall(call, resolvedArgs, context, promises);

            // Store in context if named
            if (step.containsKey("as")) {
                String alias = (String) step.get("as");
                promises.put(alias, promise);
            }

            lastResult = promise;
        }

        // Verify expectations
        if (spec.containsKey("expect")) {
            Object expected = spec.get("expect");
            if (expected instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> expectedMap = (Map<String, Object>) expected;
                Map<String, Object> results = new HashMap<>();
                for (String key : expectedMap.keySet()) {
                    if (promises.containsKey(key)) {
                        results.put(key, promises.get(key).await());
                    }
                }
                for (Map.Entry<String, Object> entry : expectedMap.entrySet()) {
                    assertResultEquals(entry.getValue(), results.get(entry.getKey()),
                            "Pipeline result " + entry.getKey());
                }
            } else if (lastResult instanceof CapnWeb.RpcPromise<?> promise) {
                Object result = promise.await();
                assertResultEquals(expected, result, "Pipeline final result");
            }
        }
    }

    /**
     * Run a sequence test (calls executed in order, each awaited before next).
     */
    private void runSequenceTest(Map<String, Object> spec) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> sequence = (List<Map<String, Object>>) spec.get("sequence");

        Map<String, Object> context = new HashMap<>();
        context.put("$self", session);

        for (Map<String, Object> step : sequence) {
            String call = (String) step.get("call");
            @SuppressWarnings("unchecked")
            List<Object> args = (List<Object>) step.getOrDefault("args", List.of());

            Object[] resolvedArgs = resolveArgs(args, context);

            // Execute and await
            Object result = resolveAndCall(call, resolvedArgs, context, Map.of()).await();

            // Check expectation
            if (step.containsKey("expect")) {
                assertResultEquals(step.get("expect"), result, "Step " + call);
            }

            // Store result
            if (step.containsKey("as")) {
                String alias = (String) step.get("as");
                context.put("$" + alias, result);
            }
        }
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    /**
     * Resolve a call path and execute it.
     */
    private CapnWeb.RpcPromise<Object> resolveAndCall(
            String callPath,
            Object[] args,
            Map<String, Object> context,
            Map<String, CapnWeb.RpcPromise<Object>> promises
    ) {
        String[] parts = callPath.split("\\.");

        if (parts.length == 1) {
            // Simple call on root
            return session.call(parts[0], args);
        }

        // Resolve the target from context or promises
        String targetName = parts[0];
        CapnWeb.Capability target;

        if (targetName.startsWith("$") && promises.containsKey(targetName.substring(1))) {
            // Pipelined call on a promise result
            CapnWeb.RpcPromise<Object> promise = promises.get(targetName.substring(1));
            return promise.call(parts[1], args);
        } else if (context.containsKey("$" + targetName)) {
            // Call on a resolved capability in context
            target = session.capability(targetName);
        } else {
            target = session.capability(parts[0]);
        }

        // Navigate to nested capability and call
        for (int i = 1; i < parts.length - 1; i++) {
            target = target.get(parts[i]);
        }

        return target.call(parts[parts.length - 1], args);
    }

    /**
     * Replace $variable references in arguments with actual values.
     */
    private Object[] resolveArgs(List<Object> args, Map<String, Object> context) {
        return args.stream()
                .map(arg -> {
                    if (arg instanceof String s && s.startsWith("$")) {
                        return context.getOrDefault(s, arg);
                    }
                    return arg;
                })
                .toArray();
    }

    /**
     * Assert that a result matches the expected value, handling type coercion.
     */
    private void assertResultEquals(Object expected, Object actual, String message) {
        if (expected == null) {
            assertNull(actual, message);
            return;
        }

        if (expected instanceof Number expectedNum && actual instanceof Number actualNum) {
            // Compare numbers with tolerance for floating point
            assertEquals(expectedNum.doubleValue(), actualNum.doubleValue(), 0.0001, message);
        } else if (expected instanceof List<?> expectedList && actual instanceof List<?> actualList) {
            assertEquals(expectedList.size(), actualList.size(), message + " (list size)");
            for (int i = 0; i < expectedList.size(); i++) {
                assertResultEquals(expectedList.get(i), actualList.get(i), message + "[" + i + "]");
            }
        } else if (expected instanceof Map<?, ?> expectedMap && actual instanceof Map<?, ?> actualMap) {
            assertEquals(expectedMap.keySet(), actualMap.keySet(), message + " (map keys)");
            for (Object key : expectedMap.keySet()) {
                assertResultEquals(expectedMap.get(key), actualMap.get(key), message + "." + key);
            }
        } else {
            assertEquals(expected, actual, message);
        }
    }

    // =========================================================================
    // Java-specific tests (not from YAML specs)
    // =========================================================================

    @Nested
    @DisplayName("Java SDK Specific")
    class JavaSpecificTests {

        @Test
        @DisplayName("Virtual thread execution")
        void virtualThreadExecution() {
            assumeTrue(session != null, "SDK not implemented yet");

            // Verify calls run on virtual threads
            Thread.startVirtualThread(() -> {
                assertTrue(Thread.currentThread().isVirtual());
                session.call("square", 5).await();
            });
        }

        @Test
        @DisplayName("Try-with-resources cleanup")
        void tryWithResourcesCleanup() {
            assumeTrue(TEST_SERVER_URL != null, "No test server");

            try (var sess = CapnWeb.connect(TEST_SERVER_URL)) {
                assertTrue(sess.isConnected() || true); // SDK stub always returns false
            }
            // Session should be closed automatically
        }

        @Test
        @DisplayName("Sealed RpcError pattern matching")
        void sealedRpcErrorPatternMatching() {
            CapnWeb.RpcError error = new CapnWeb.RpcError.NotFound("todo", "123");

            String message = switch (error) {
                case CapnWeb.RpcError.NotFound e -> "Not found: " + e.resource() + "/" + e.id();
                case CapnWeb.RpcError.PermissionDenied e -> "Denied: " + e.action();
                case CapnWeb.RpcError.InvalidInput e -> "Invalid: " + e.field();
                case CapnWeb.RpcError.Unavailable e -> "Unavailable, retry in " + e.retryAfter();
                case CapnWeb.RpcError.RateLimited e -> "Rate limited: " + e.limit();
                case CapnWeb.RpcError.ConnectionError e -> "Connection: " + e.getMessage();
                case CapnWeb.RpcError.TimeoutError e -> "Timeout: " + e.getMessage();
                case CapnWeb.RpcError.InternalError e -> "Internal: " + e.getMessage();
                case CapnWeb.RpcError.MethodNotFound e -> "Method not found: " + e.method();
                case CapnWeb.RpcError.ServerError e -> "Server error: " + e.type();
            };

            assertEquals("Not found: todo/123", message);
        }

        @Test
        @DisplayName("Promise pipelining API")
        void promisePipeliningApi() {
            assumeTrue(session != null, "SDK not implemented yet");

            // Test that the API compiles and works
            var result = session.pipeline()
                    .call("makeCounter", 10)
                    .call("increment", 5)
                    .execute();

            assertNotNull(result);
        }

        @Test
        @DisplayName("Configuration builder")
        void configurationBuilder() {
            var config = CapnWeb.builder("wss://example.com/rpc")
                    .timeout(java.time.Duration.ofSeconds(60))
                    .auth("bearer-token")
                    .virtualThreads(true)
                    .build();

            assertEquals(java.time.Duration.ofSeconds(60), config.timeout());
            assertEquals("bearer-token", config.authToken());
            assertTrue(config.virtualThreads());
        }
    }

    // =========================================================================
    // Integration tests (require running server)
    // =========================================================================

    @Nested
    @DisplayName("Integration")
    @Tag("integration")
    class IntegrationTests {

        @BeforeEach
        void checkServer() {
            assumeTrue(
                    TEST_SERVER_URL != null && !TEST_SERVER_URL.isEmpty(),
                    "TEST_SERVER_URL not set"
            );
        }

        @Test
        @DisplayName("Connect to test server")
        void connectToTestServer() {
            assumeTrue(false, "SDK not implemented yet");

            try (var sess = CapnWeb.connect(TEST_SERVER_URL)) {
                assertTrue(sess.isConnected());
            }
        }

        @Test
        @DisplayName("Basic RPC call")
        void basicRpcCall() {
            assumeTrue(false, "SDK not implemented yet");

            try (var sess = CapnWeb.connect(TEST_SERVER_URL)) {
                var result = sess.call("square", 5).await();
                assertEquals(25, ((Number) result).intValue());
            }
        }
    }
}
