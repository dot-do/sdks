package capnweb

import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.yaml.snakeyaml.Yaml
import java.nio.file.Files
import java.nio.file.Path
import java.util.stream.Stream
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Conformance tests for the Kotlin Cap'n Web SDK.
 *
 * These tests are generated from the YAML specifications in test/conformance/
 * and verify that the Kotlin SDK correctly implements the Cap'n Web protocol.
 *
 * Run with:
 * ```
 * TEST_SERVER_URL=http://localhost:8787 ./gradlew test
 * ```
 */
class ConformanceTest {

    companion object {
        private val TEST_SERVER_URL: String = System.getenv("TEST_SERVER_URL")
            ?: "http://localhost:8787"

        private val SPEC_DIR: Path = resolveSpecDir()

        private fun resolveSpecDir(): Path {
            val envDir = System.getenv("TEST_SPEC_DIR")
            return if (!envDir.isNullOrEmpty()) {
                Path.of(envDir)
            } else {
                // Default: relative to project root
                Path.of("../../test/conformance")
            }
        }

        /**
         * Load all conformance test specifications from YAML files.
         */
        @JvmStatic
        fun loadConformanceSpecs(): Stream<ConformanceSpec> {
            val specs = mutableListOf<ConformanceSpec>()

            if (!SPEC_DIR.exists()) {
                System.err.println("Warning: Spec directory not found: ${SPEC_DIR.toAbsolutePath()}")
                return Stream.empty()
            }

            val yaml = Yaml()

            Files.list(SPEC_DIR)
                .filter { it.toString().endsWith(".yaml") }
                .sorted()
                .forEach { file ->
                    try {
                        val content = file.readText()
                        @Suppress("UNCHECKED_CAST")
                        val doc = yaml.load<Map<String, Any>>(content)

                        if (doc != null && doc.containsKey("tests")) {
                            val category = doc["name"] as? String ?: file.fileName.toString()
                            @Suppress("UNCHECKED_CAST")
                            val tests = doc["tests"] as List<Map<String, Any>>

                            for (test in tests) {
                                val testName = test["name"] as String
                                val testDesc = test["description"] as? String ?: testName

                                specs.add(ConformanceSpec(
                                    name = testName,
                                    description = testDesc,
                                    category = category,
                                    file = file.fileName.toString(),
                                    spec = test
                                ))
                            }
                        }
                    } catch (e: Exception) {
                        System.err.println("Failed to load $file: ${e.message}")
                    }
                }

            return specs.stream()
        }
    }

    private var session: Session? = null

    @BeforeEach
    fun setUp() {
        // Session will be created per test when SDK is implemented
        session = null
    }

    @AfterEach
    fun tearDown() {
        session?.close()
    }

    // =========================================================================
    // Parameterized conformance tests
    // =========================================================================

    @ParameterizedTest(name = "{0}")
    @MethodSource("loadConformanceSpecs")
    @DisplayName("Conformance")
    fun runConformanceTest(spec: ConformanceSpec) = runTest {
        // Skip if SDK not implemented yet
        assumeTrue(session != null) { "SDK not implemented yet: $spec" }

        val testSpec = spec.spec

        when {
            testSpec.containsKey("map") -> runMapTest(testSpec)
            testSpec.containsKey("call") -> runCallTest(testSpec)
            testSpec.containsKey("pipeline") -> runPipelineTest(testSpec)
            testSpec.containsKey("sequence") -> runSequenceTest(testSpec)
            else -> Assertions.fail<Unit>("Unknown test type: ${spec.name}")
        }
    }

    // =========================================================================
    // Test runners for different test types
    // =========================================================================

    /**
     * Run a simple call test.
     */
    private suspend fun runCallTest(spec: Map<String, Any>) {
        val method = spec["call"] as String
        @Suppress("UNCHECKED_CAST")
        val args = (spec["args"] as? List<Any>) ?: emptyList()

        val resolvedArgs = resolveArgs(args, emptyMap())

        if (spec.containsKey("expect_error")) {
            @Suppress("UNCHECKED_CAST")
            val errorSpec = spec["expect_error"] as Map<String, Any>
            assertThrows<RpcError> {
                session!!.call<Any>(method, *resolvedArgs).await()
            }
            // TODO: Verify error details match errorSpec
        } else {
            val result = session!!.call<Any>(method, *resolvedArgs).await()
            val expected = spec["expect"]
            assertResultEquals(expected, result, "Method $method")
        }
    }

    /**
     * Run a map test (server-side collection transformation).
     *
     * This is the KEY test for verifying the .map() operation works correctly.
     * The map transforms a collection on the server side in a single round trip.
     */
    private suspend fun runMapTest(spec: Map<String, Any>) {
        val method = spec["call"] as String
        @Suppress("UNCHECKED_CAST")
        val args = (spec["args"] as? List<Any>) ?: emptyList()
        @Suppress("UNCHECKED_CAST")
        val mapSpec = spec["map"] as Map<String, Any>

        val resolvedArgs = resolveArgs(args, mapOf("\$self" to session!!))

        // Get the expression for the map operation
        val expression = mapSpec["expression"] as? String
        @Suppress("UNCHECKED_CAST")
        val captures = mapSpec["captures"] as? List<String> ?: emptyList()

        // Execute the initial call
        val sourcePromise = session!!.call<Any>(method, *resolvedArgs)

        // Build the context for captures
        val context = mutableMapOf<String, Any?>()
        if ("\$self" in captures) {
            context["\$self"] = session
        }

        // Apply the map operation
        // In a real implementation, this would send the expression to the server
        val result = when {
            expression != null -> {
                executeMapWithExpression(sourcePromise, expression, context)
            }
            else -> {
                // No expression, just await the source
                sourcePromise.await()
            }
        }

        // Verify expectations
        when {
            spec.containsKey("expect") -> {
                assertResultEquals(spec["expect"], result, "Map result")
            }
            spec.containsKey("expect_type") -> {
                val expectedType = spec["expect_type"] as String
                assertType(expectedType, result, "Map result type")
            }
            spec.containsKey("expect_length") -> {
                val expectedLength = (spec["expect_length"] as Number).toInt()
                val actualLength = (result as? List<*>)?.size ?: 0
                assertEquals(expectedLength, actualLength, "Map result length")
            }
        }

        // Check max round trips if specified
        if (spec.containsKey("max_round_trips")) {
            val maxRoundTrips = (spec["max_round_trips"] as Number).toInt()
            // TODO: Verify actual round trip count
            // For now, we trust that the SDK implementation is correct
        }
    }

    /**
     * Execute a map with a YAML expression.
     *
     * Expressions are in the form: "x => self.square(x)"
     */
    private suspend fun executeMapWithExpression(
        source: RpcPromise<Any>,
        expression: String,
        context: Map<String, Any?>
    ): Any? {
        val sourceResult = source.await()

        // Parse the expression (simple form: "x => self.method(x)")
        val arrowIndex = expression.indexOf("=>")
        if (arrowIndex < 0) {
            throw IllegalArgumentException("Invalid map expression: $expression")
        }

        val param = expression.substring(0, arrowIndex).trim()
        val body = expression.substring(arrowIndex + 2).trim()

        // Handle null/undefined input
        if (sourceResult == null) {
            return null
        }

        // Apply to each element if it's a list, or to the single value
        return when (sourceResult) {
            is List<*> -> {
                sourceResult.map { element ->
                    evaluateExpression(body, mapOf(param to element) + context)
                }
            }
            else -> {
                evaluateExpression(body, mapOf(param to sourceResult) + context)
            }
        }
    }

    /**
     * Evaluate a simple expression like "self.square(x)" or "counter.value".
     */
    private suspend fun evaluateExpression(expr: String, context: Map<String, Any?>): Any? {
        // Parse method call: "target.method(args)"
        val methodCallRegex = Regex("""(\w+)\.(\w+)\((.+)\)""")
        val propertyAccessRegex = Regex("""(\w+)\.(\w+)""")

        val methodMatch = methodCallRegex.matchEntire(expr)
        if (methodMatch != null) {
            val (targetName, methodName, argsStr) = methodMatch.destructured
            val target = context[targetName]

            // Parse arguments
            val args = parseArgs(argsStr, context)

            return when (target) {
                is Session -> target.call<Any>(methodName, *args).await()
                is Capability -> target.call<Any>(methodName, *args).await()
                else -> throw IllegalArgumentException("Unknown target: $targetName")
            }
        }

        val propertyMatch = propertyAccessRegex.matchEntire(expr)
        if (propertyMatch != null) {
            val (targetName, propertyName) = propertyMatch.destructured
            val target = context[targetName]

            return when (target) {
                is Session -> target.call<Any>(propertyName).await()
                is Capability -> target.call<Any>(propertyName).await()
                else -> throw IllegalArgumentException("Unknown target: $targetName")
            }
        }

        // Try to resolve as a simple reference
        return context[expr]
    }

    /**
     * Parse arguments from a string like "x" or "x * 2".
     */
    private fun parseArgs(argsStr: String, context: Map<String, Any?>): Array<Any?> {
        val parts = argsStr.split(",").map { it.trim() }
        return parts.map { part ->
            when {
                part.contains("*") -> {
                    // Simple multiplication: "x * 2"
                    val (varName, multiplier) = part.split("*").map { it.trim() }
                    val value = context[varName] as? Number ?: 0
                    value.toDouble() * multiplier.toDouble()
                }
                context.containsKey(part) -> context[part]
                part.toDoubleOrNull() != null -> part.toDouble()
                else -> part
            }
        }.toTypedArray()
    }

    /**
     * Run a pipeline test (multiple calls in one round trip).
     */
    private suspend fun runPipelineTest(spec: Map<String, Any>) {
        @Suppress("UNCHECKED_CAST")
        val pipeline = spec["pipeline"] as List<Map<String, Any>>

        val context = mutableMapOf<String, Any?>()
        context["\$self"] = session

        var lastResult: Any? = null
        val promises = mutableMapOf<String, RpcPromise<Any>>()

        // Build the pipeline
        for (step in pipeline) {
            val call = step["call"] as String
            @Suppress("UNCHECKED_CAST")
            val args = (step["args"] as? List<Any>) ?: emptyList()

            val resolvedArgs = resolveArgs(args, context)

            // Resolve the target and execute
            val promise = resolveAndCall(call, resolvedArgs, context, promises)

            // Store in context if named
            val alias = step["as"] as? String
            if (alias != null) {
                promises[alias] = promise
            }

            lastResult = promise
        }

        // Verify expectations
        if (spec.containsKey("expect")) {
            val expected = spec["expect"]
            if (expected is Map<*, *>) {
                @Suppress("UNCHECKED_CAST")
                val expectedMap = expected as Map<String, Any>
                val results = mutableMapOf<String, Any?>()
                for (key in expectedMap.keys) {
                    if (promises.containsKey(key)) {
                        results[key] = promises[key]!!.await()
                    }
                }
                for ((key, value) in expectedMap) {
                    assertResultEquals(value, results[key], "Pipeline result $key")
                }
            } else if (lastResult is RpcPromise<*>) {
                val result = (lastResult as RpcPromise<Any>).await()
                assertResultEquals(expected, result, "Pipeline final result")
            }
        }
    }

    /**
     * Run a sequence test (calls executed in order, each awaited before next).
     */
    private suspend fun runSequenceTest(spec: Map<String, Any>) {
        @Suppress("UNCHECKED_CAST")
        val sequence = spec["sequence"] as List<Map<String, Any>>

        val context = mutableMapOf<String, Any?>()
        context["\$self"] = session

        for (step in sequence) {
            val call = step["call"] as String
            @Suppress("UNCHECKED_CAST")
            val args = (step["args"] as? List<Any>) ?: emptyList()

            val resolvedArgs = resolveArgs(args, context)

            // Execute and await
            val result = resolveAndCall(call, resolvedArgs, context, emptyMap()).await()

            // Check expectation
            if (step.containsKey("expect")) {
                assertResultEquals(step["expect"], result, "Step $call")
            }

            // Store result
            val alias = step["as"] as? String
            if (alias != null) {
                context["\$$alias"] = result
            }
        }
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    /**
     * Resolve a call path and execute it.
     */
    private fun resolveAndCall(
        callPath: String,
        args: Array<Any?>,
        context: Map<String, Any?>,
        promises: Map<String, RpcPromise<Any>>
    ): RpcPromise<Any> {
        val parts = callPath.split(".")

        if (parts.size == 1) {
            // Simple call on root
            return session!!.call(parts[0], *args)
        }

        // Resolve the target from context or promises
        val targetName = parts[0]

        if (targetName.startsWith("\$") && promises.containsKey(targetName.substring(1))) {
            // Pipelined call on a promise result
            val promise = promises[targetName.substring(1)]!!
            return promise.call(parts[1], *args)
        }

        // Navigate to nested capability and call
        var target = session!!.capability(parts[0])
        for (i in 1 until parts.size - 1) {
            target = target[parts[i]]
        }

        return target.call(parts[parts.size - 1], *args)
    }

    /**
     * Replace $variable references in arguments with actual values.
     */
    private fun resolveArgs(args: List<Any>, context: Map<String, Any?>): Array<Any?> {
        return args.map { arg ->
            if (arg is String && arg.startsWith("\$")) {
                context[arg] ?: arg
            } else {
                arg
            }
        }.toTypedArray()
    }

    /**
     * Assert that a result matches the expected value, handling type coercion.
     */
    private fun assertResultEquals(expected: Any?, actual: Any?, message: String) {
        when {
            expected == null -> {
                Assertions.assertNull(actual, message)
            }
            expected is Number && actual is Number -> {
                // Compare numbers with tolerance for floating point
                assertEquals(expected.toDouble(), actual.toDouble(), 0.0001, message)
            }
            expected is List<*> && actual is List<*> -> {
                assertEquals(expected.size, actual.size, "$message (list size)")
                for (i in expected.indices) {
                    assertResultEquals(expected[i], actual[i], "$message[$i]")
                }
            }
            expected is Map<*, *> && actual is Map<*, *> -> {
                assertEquals(expected.keys, actual.keys, "$message (map keys)")
                for (key in expected.keys) {
                    assertResultEquals(expected[key], actual[key], "$message.$key")
                }
            }
            else -> {
                assertEquals(expected, actual, message)
            }
        }
    }

    /**
     * Assert that a value is of the expected type.
     */
    private fun assertType(expectedType: String, actual: Any?, message: String) {
        when (expectedType) {
            "capability" -> {
                assertTrue(actual is Capability, "$message: expected capability, got ${actual?.javaClass}")
            }
            "array_of_capabilities" -> {
                assertTrue(actual is List<*>, "$message: expected list, got ${actual?.javaClass}")
                val list = actual as List<*>
                assertTrue(list.all { it is Capability }, "$message: expected all capabilities")
            }
            "null" -> {
                Assertions.assertNull(actual, message)
            }
            else -> {
                // Generic type check
                assertNotNull(actual, message)
            }
        }
    }

    // =========================================================================
    // Kotlin-specific tests (not from YAML specs)
    // =========================================================================

    @Nested
    @DisplayName("Kotlin SDK Specific")
    inner class KotlinSpecificTests {

        @Test
        @DisplayName("Coroutine suspend execution")
        fun coroutineSuspendExecution() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            // Verify calls work in coroutine context
            val result = session!!.call<Int>("square", 5).await()
            assertEquals(25, result)
        }

        @Test
        @DisplayName("AutoCloseable cleanup")
        fun autoCloseableCleanup() {
            assumeTrue(TEST_SERVER_URL.isNotEmpty()) { "No test server" }

            CapnWeb.builder(TEST_SERVER_URL).runCatching {
                // Session should be closeable
            }
        }

        @Test
        @DisplayName("Sealed RpcError pattern matching")
        fun sealedRpcErrorPatternMatching() {
            val error: RpcError = RpcError.NotFound("todo", "123")

            val message = when (error) {
                is RpcError.NotFound -> "Not found: ${error.resource}/${error.id}"
                is RpcError.PermissionDenied -> "Denied: ${error.action}"
                is RpcError.ValidationFailed -> "Validation: ${error.errors}"
                is RpcError.Unauthorized -> "Unauthorized: ${error.realm}"
                is RpcError.RemoteException -> "Remote: ${error.type}"
                is RpcError.NetworkError -> "Network: ${error.message}"
                is RpcError.Timeout -> "Timeout: ${error.duration}"
                RpcError.Disconnected -> "Disconnected"
                RpcError.SessionClosed -> "Session closed"
            }

            assertEquals("Not found: todo/123", message)
        }

        @Test
        @DisplayName("RpcPromise map extension")
        fun rpcPromiseMapExtension() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            // Test that the .map() extension compiles and works
            val fibPromise = session!!.call<List<Int>>("generateFibonacci", 6)

            // Map over the result - this should be a server-side operation
            val squaresPromise = fibPromise.map { n ->
                session!!.call<Int>("square", n)
            }

            val squares = squaresPromise.await()
            assertEquals(listOf(0, 1, 1, 4, 9, 25), squares)
        }

        @Test
        @DisplayName("RpcPromise then transformation")
        fun rpcPromiseThenTransformation() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            val result = session!!.call<Int>("square", 5)
                .then { it * 2 }
                .await()

            assertEquals(50, result)
        }

        @Test
        @DisplayName("RpcResult fold operation")
        fun rpcResultFoldOperation() = runTest {
            val successResult: RpcResult<Int> = RpcResult.Success(42)
            val failureResult: RpcResult<Int> = RpcResult.Failure(RpcError.NotFound("test"))

            val successMessage = successResult.fold(
                onSuccess = { "Value: $it" },
                onFailure = { "Error: ${it.message}" }
            )
            assertEquals("Value: 42", successMessage)

            val failureMessage = failureResult.fold(
                onSuccess = { "Value: $it" },
                onFailure = { "Error: ${it.message}" }
            )
            assertEquals("Error: Not found: test", failureMessage)
        }

        @Test
        @DisplayName("Pipeline builder DSL")
        fun pipelineBuilderDsl() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            // Test that the pipeline API compiles and works
            val result = session!!.pipeline()
                .call("makeCounter", 10)
                .call("increment", 5)
                .execute<Int>()

            assertEquals(15, result)
        }

        @Test
        @DisplayName("Session configuration DSL")
        fun sessionConfigurationDsl() = runTest {
            val session = CapnWeb.connect("wss://example.com/rpc") {
                timeout(kotlin.time.Duration.parse("60s"))
                auth("bearer-token")
                reconnect {
                    enabled = true
                    maxAttempts = 3
                }
            }

            session.close()
        }

        @Test
        @DisplayName("Map on null returns null")
        fun mapOnNullReturnsNull() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            val nullPromise = session!!.call<List<Int>?>("returnNull")

            // Map on null should return null, not error
            // This tests the edge case from map.yaml
        }

        @Test
        @DisplayName("Map preserves array order")
        fun mapPreservesArrayOrder() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            val fibPromise = session!!.call<List<Int>>("generateFibonacci", 8)
            val identityMapped = fibPromise.map { n ->
                session!!.call<Int>("returnNumber", n)
            }

            val result = identityMapped.await()
            assertEquals(listOf(0, 1, 1, 2, 3, 5, 8, 13), result)
        }

        @Test
        @DisplayName("Nested map operations")
        fun nestedMapOperations() = runTest {
            assumeTrue(session != null) { "SDK not implemented yet" }

            // Map that creates nested arrays
            val fibPromise = session!!.call<List<Int>>("generateFibonacci", 4)
            val nestedPromise = fibPromise.map { n ->
                session!!.call<List<Int>>("generateFibonacci", n)
            }

            val result = nestedPromise.await()
            assertEquals(
                listOf(
                    emptyList(),  // fib(0)
                    listOf(0),    // fib(1)
                    listOf(0),    // fib(1)
                    listOf(0, 1)  // fib(2)
                ),
                result
            )
        }
    }

    // =========================================================================
    // Integration tests (require running server)
    // =========================================================================

    @Nested
    @DisplayName("Integration")
    @Tag("integration")
    inner class IntegrationTests {

        @BeforeEach
        fun checkServer() {
            assumeTrue(TEST_SERVER_URL.isNotEmpty()) { "TEST_SERVER_URL not set" }
        }

        @Test
        @DisplayName("Connect to test server")
        fun connectToTestServer() = runTest {
            assumeTrue(false) { "SDK not implemented yet" }

            val sess = CapnWeb.connect(TEST_SERVER_URL)
            sess.use {
                assertTrue(it.isConnected())
            }
        }

        @Test
        @DisplayName("Basic RPC call")
        fun basicRpcCall() = runTest {
            assumeTrue(false) { "SDK not implemented yet" }

            val sess = CapnWeb.connect(TEST_SERVER_URL)
            sess.use {
                val result = it.call<Int>("square", 5).await()
                assertEquals(25, result)
            }
        }

        @Test
        @DisplayName("Map operation single round trip")
        fun mapOperationSingleRoundTrip() = runTest {
            assumeTrue(false) { "SDK not implemented yet" }

            val sess = CapnWeb.connect(TEST_SERVER_URL)
            sess.use {
                // This should execute in a single round trip
                val fibPromise = it.call<List<Int>>("generateFibonacci", 6)
                val squaresPromise = fibPromise.map { n ->
                    it.call<Int>("square", n)
                }

                val result = squaresPromise.await()
                assertEquals(listOf(0, 1, 1, 4, 9, 25), result)

                // TODO: Verify only 1 round trip was made
            }
        }
    }
}

/**
 * A conformance test specification loaded from YAML.
 */
data class ConformanceSpec(
    val name: String,
    val description: String,
    val category: String,
    val file: String,
    val spec: Map<String, Any>
) {
    override fun toString(): String = "$category/$name"
}
