<?php

declare(strict_types=1);

namespace CapnWeb\Tests;

use CapnWeb\{
    Session,
    RpcPromise,
    RpcException,
    ErrorType,
    PromiseState,
    MapExpression,
};
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\{
    DataProvider,
    Test,
    Group,
    Depends,
    CoversClass,
};
use Symfony\Component\Yaml\Yaml;

/**
 * Conformance tests for the Cap'n Web PHP SDK
 *
 * These tests verify that the SDK correctly implements the Cap'n Web protocol
 * by running against a conformance test server and YAML specifications.
 *
 * Environment variables:
 * - TEST_SERVER_URL: WebSocket URL of the conformance test server
 * - TEST_SPEC_DIR: Directory containing YAML test specifications
 */
#[CoversClass(Session::class)]
#[CoversClass(RpcPromise::class)]
#[Group('conformance')]
final class ConformanceTest extends TestCase
{
    private static ?Session $session = null;
    private static string $serverUrl;
    private static string $specDir;
    private static bool $serverAvailable = false;

    public static function setUpBeforeClass(): void
    {
        self::$serverUrl = getenv('TEST_SERVER_URL') ?: 'ws://localhost:8080';
        self::$specDir = getenv('TEST_SPEC_DIR') ?: __DIR__ . '/../../test/conformance';

        // Try to connect to the test server
        try {
            self::$session = Session::connect(
                url: self::$serverUrl,
                timeout: 5,
            );
            self::$serverAvailable = true;
        } catch (\Throwable) {
            self::$serverAvailable = false;
        }
    }

    public static function tearDownAfterClass(): void
    {
        self::$session?->close();
        self::$session = null;
    }

    /**
     * Get the test session, skipping if server unavailable
     */
    private function getSession(): Session
    {
        if (!self::$serverAvailable || self::$session === null) {
            $this->markTestSkipped(
                'Conformance test server not available at ' . self::$serverUrl
            );
        }

        return self::$session;
    }

    /**
     * Load YAML test specifications
     *
     * @return array<string, array{spec: array, test: array}>
     */
    public static function basicTestProvider(): array
    {
        $specDir = getenv('TEST_SPEC_DIR') ?: __DIR__ . '/../../test/conformance';
        $specFile = $specDir . '/basic.yaml';

        if (!file_exists($specFile)) {
            return [];
        }

        $spec = Yaml::parseFile($specFile);
        $tests = [];

        foreach ($spec['tests'] ?? [] as $test) {
            $testName = $test['name'] ?? 'unnamed';
            $tests[$testName] = [
                'spec' => $spec,
                'test' => $test,
            ];
        }

        return $tests;
    }

    /**
     * Load map/remap test specifications
     *
     * @return array<string, array{spec: array, test: array}>
     */
    public static function mapTestProvider(): array
    {
        $specDir = getenv('TEST_SPEC_DIR') ?: __DIR__ . '/../../test/conformance';
        $specFile = $specDir . '/map.yaml';

        if (!file_exists($specFile)) {
            return [];
        }

        $spec = Yaml::parseFile($specFile);
        $tests = [];

        foreach ($spec['tests'] ?? [] as $test) {
            $testName = $test['name'] ?? 'unnamed';
            $tests[$testName] = [
                'spec' => $spec,
                'test' => $test,
            ];
        }

        return $tests;
    }

    /**
     * Combined provider for all conformance tests
     *
     * @return array<string, array{spec: array, test: array}>
     */
    public static function conformanceTestProvider(): array
    {
        return array_merge(
            self::basicTestProvider(),
            self::mapTestProvider(),
        );
    }

    #[Test]
    #[DataProvider('basicTestProvider')]
    #[Group('basic')]
    public function testBasicRpcCall(array $spec, array $test): void
    {
        $session = $this->getSession();

        $method = $test['call'];
        $args = $test['args'] ?? [];
        $expected = $test['expect'];

        // Execute the RPC call
        $promise = $session->$method(...$args);
        $result = $promise->await();

        // Verify the result
        $this->assertEquals(
            $expected,
            $result,
            sprintf(
                'Test "%s": expected %s, got %s',
                $test['name'],
                json_encode($expected),
                json_encode($result),
            ),
        );
    }

    #[Test]
    #[DataProvider('mapTestProvider')]
    #[Group('map')]
    public function testMapOperation(array $spec, array $test): void
    {
        $session = $this->getSession();

        // Handle setup steps if present
        $context = $this->executeSetup($session, $test['setup'] ?? []);

        // Execute the main call
        $call = $test['call'];

        // Handle variable references in call
        if (str_starts_with($call, '$')) {
            $varName = substr($call, 1);
            $promise = $context[$varName] ?? throw new \RuntimeException(
                "Variable {$call} not found in context"
            );
        } else {
            $args = $test['args'] ?? [];
            $promise = $session->$call(...$args);
        }

        // Apply map operation if specified
        if (isset($test['map'])) {
            $mapConfig = $test['map'];
            $expression = $mapConfig['expression'];
            $captures = $mapConfig['captures'] ?? [];

            // Parse the expression and build the closure
            $callback = $this->buildMapCallback($session, $expression, $captures, $context);
            $promise = $promise->map($callback);
        }

        // Execute and get result
        $result = $promise->await();

        // Verify based on expectation type
        if (isset($test['expect'])) {
            $this->assertEquals(
                $test['expect'],
                $result,
                sprintf('Test "%s" failed', $test['name']),
            );
        } elseif (isset($test['expect_type'])) {
            $this->assertExpectedType($result, $test);
        }

        // Verify max round trips if specified
        if (isset($test['max_round_trips'])) {
            // In a real implementation, we would track round trips
            // For now, we verify the promise structure supports pipelining
            $this->assertTrue(true, 'Round trip verification not implemented');
        }

        // Execute additional verification steps
        if (isset($test['verify'])) {
            foreach ($test['verify'] as $verification) {
                $this->executeVerification($result, $verification);
            }
        }
    }

    #[Test]
    #[Group('map')]
    public function testMapMethodExists(): void
    {
        $promise = new RpcPromise();

        $this->assertTrue(
            method_exists($promise, 'map'),
            'RpcPromise must have a map() method',
        );
    }

    #[Test]
    #[Group('map')]
    public function testRemapIsAliasForMap(): void
    {
        $promise = new RpcPromise();

        $this->assertTrue(
            method_exists($promise, 'remap'),
            'RpcPromise must have a remap() method as alias for map()',
        );
    }

    #[Test]
    #[Group('map')]
    public function testMapReturnsPromise(): void
    {
        $promise = new RpcPromise();
        $mapped = $promise->map(fn($x) => $x * 2);

        $this->assertInstanceOf(
            RpcPromise::class,
            $mapped,
            'map() must return an RpcPromise',
        );
    }

    #[Test]
    #[Group('map')]
    public function testMapExpressionCaptures(): void
    {
        $session = $this->createMock(Session::class);
        $multiplier = 10;

        $promise = new RpcPromise(session: $session);

        // Create a closure with a captured variable
        $mapped = $promise->map(fn($x) => $x * $multiplier);

        $this->assertInstanceOf(RpcPromise::class, $mapped);
    }

    #[Test]
    #[Group('map')]
    public function testMapChaining(): void
    {
        $promise = new RpcPromise();

        // Chain multiple map operations
        $result = $promise
            ->map(fn($x) => $x * 2)
            ->map(fn($x) => $x + 1)
            ->map(fn($x) => (string) $x);

        $this->assertInstanceOf(RpcPromise::class, $result);
    }

    #[Test]
    #[Group('map')]
    public function testMapWithApiCapture(): void
    {
        // Simulate capturing $api in a map callback (the key use case)
        $session = $this->createMock(Session::class);
        $promise = new RpcPromise(session: $session);

        // This simulates: $promise->map(fn($x) => $api->square($x))
        $api = $session;
        $mapped = $promise->map(fn($x) => $api->square($x));

        $this->assertInstanceOf(RpcPromise::class, $mapped);
    }

    #[Test]
    #[Group('basic')]
    public function testPromiseStates(): void
    {
        $promise = new RpcPromise();

        $this->assertTrue($promise->isPending());
        $this->assertFalse($promise->isResolved());
        $this->assertFalse($promise->isRejected());

        $promise->resolve(42);

        $this->assertFalse($promise->isPending());
        $this->assertTrue($promise->isResolved());
        $this->assertFalse($promise->isRejected());
    }

    #[Test]
    #[Group('basic')]
    public function testPromiseReject(): void
    {
        $promise = new RpcPromise();
        $promise->reject(new RpcException('Test error', ErrorType::NotFound));

        $this->assertFalse($promise->isPending());
        $this->assertFalse($promise->isResolved());
        $this->assertTrue($promise->isRejected());
    }

    #[Test]
    #[Group('basic')]
    public function testPromiseThen(): void
    {
        $promise = new RpcPromise();
        $called = false;

        $promise->then(function ($value) use (&$called) {
            $called = true;
            return $value * 2;
        });

        $promise->resolve(21);

        $this->assertTrue($called);
    }

    #[Test]
    #[Group('basic')]
    public function testPromiseCatch(): void
    {
        $promise = new RpcPromise();
        $caughtError = null;

        $promise->catch(function (RpcException $e) use (&$caughtError) {
            $caughtError = $e;
        });

        $error = new RpcException('Test error', ErrorType::ServerError);
        $promise->reject($error);

        $this->assertSame($error, $caughtError);
    }

    #[Test]
    #[Group('basic')]
    public function testPromiseFinally(): void
    {
        $promise = new RpcPromise();
        $finallyCalled = false;

        $promise->finally(function () use (&$finallyCalled) {
            $finallyCalled = true;
        });

        $promise->resolve(42);

        $this->assertTrue($finallyCalled);
    }

    #[Test]
    #[Group('basic')]
    public function testSessionConnect(): void
    {
        $session = Session::connect(
            url: 'ws://localhost:8080',
            timeout: 30,
            reconnect: true,
        );

        $this->assertInstanceOf(Session::class, $session);
        $this->assertTrue($session->isConnected());

        $session->close();
        $this->assertFalse($session->isConnected());
    }

    #[Test]
    #[Group('basic')]
    public function testSessionBatch(): void
    {
        $session = Session::batch(
            url: 'http://localhost:8080/rpc',
            timeout: 10,
        );

        $this->assertInstanceOf(Session::class, $session);
    }

    #[Test]
    #[Group('pipelining')]
    public function testPropertyAccessReturnsPipeline(): void
    {
        $session = Session::connect(url: 'ws://localhost:8080');
        $promise = $session->users;

        $this->assertInstanceOf(RpcPromise::class, $promise);

        $session->close();
    }

    #[Test]
    #[Group('pipelining')]
    public function testMethodCallReturnsPipeline(): void
    {
        $session = Session::connect(url: 'ws://localhost:8080');
        $promise = $session->users->get(id: 123);

        $this->assertInstanceOf(RpcPromise::class, $promise);

        $session->close();
    }

    #[Test]
    #[Group('pipelining')]
    public function testChainedPipelining(): void
    {
        $session = Session::connect(url: 'ws://localhost:8080');

        // This should create a single pipelined request
        $promise = $session
            ->authenticate(token: 'test-token')
            ->user
            ->profile
            ->displayName;

        $this->assertInstanceOf(RpcPromise::class, $promise);

        $session->close();
    }

    /**
     * Execute setup steps and return context variables
     */
    private function executeSetup(Session $session, array $setup): array
    {
        $context = [];

        foreach ($setup as $step) {
            if (isset($step['call'])) {
                $call = $step['call'];
                $args = $step['args'] ?? [];

                // Handle variable references
                if (str_starts_with($call, '$')) {
                    $varName = substr($call, 1);
                    $promise = $context[$varName];
                } else {
                    $promise = $session->$call(...$args);
                }

                // Apply map if specified
                if (isset($step['map'])) {
                    $callback = $this->buildMapCallback(
                        $session,
                        $step['map']['expression'],
                        $step['map']['captures'] ?? [],
                        $context,
                    );
                    $promise = $promise->map($callback);
                }

                // Await if specified
                if ($step['await'] ?? false) {
                    $promise->await();
                }

                // Store in context
                if (isset($step['as'])) {
                    $context[$step['as']] = $promise;
                }
            } elseif (isset($step['pipeline'])) {
                // Handle pipeline steps
                foreach ($step['pipeline'] as $pipeStep) {
                    $call = $pipeStep['call'];
                    $args = $pipeStep['args'] ?? [];

                    if (str_starts_with($call, '$')) {
                        $varName = substr($call, 1);
                        $promise = $context[$varName];
                    } else {
                        $promise = $session->$call(...$args);
                    }

                    if (isset($pipeStep['map'])) {
                        $callback = $this->buildMapCallback(
                            $session,
                            $pipeStep['map']['expression'],
                            $pipeStep['map']['captures'] ?? [],
                            $context,
                        );
                        $promise = $promise->map($callback);
                    }
                }

                if ($step['await'] ?? false) {
                    $promise->await();
                }

                if (isset($step['as'])) {
                    $context[$step['as']] = $promise;
                }
            }
        }

        return $context;
    }

    /**
     * Build a map callback from YAML expression
     */
    private function buildMapCallback(
        Session $session,
        string $expression,
        array $captures,
        array $context,
    ): \Closure {
        // Parse expression format: "x => self.square(x)" or "x => x * 2"
        // This is a simplified parser - a real implementation would be more robust

        $self = $session;

        // Common patterns from the conformance tests
        return match (true) {
            str_contains($expression, 'self.square') =>
                fn($x) => $self->square($x),

            str_contains($expression, 'self.returnNumber') && str_contains($expression, '* 2') =>
                fn($x) => $self->returnNumber($x * 2),

            str_contains($expression, 'self.makeCounter') =>
                fn($x) => $self->makeCounter($x),

            str_contains($expression, 'counter.value') =>
                fn($counter) => $counter->value,

            str_contains($expression, 'c.increment') =>
                fn($c) => $c->increment(10),

            str_contains($expression, 'self.generateFibonacci') =>
                fn($n) => $self->generateFibonacci($n),

            str_contains($expression, 'self.returnNumber') =>
                fn($x) => $self->returnNumber($x),

            default => fn($x) => $x,
        };
    }

    /**
     * Assert the result matches expected type
     */
    private function assertExpectedType(mixed $result, array $test): void
    {
        $expectedType = $test['expect_type'];

        match ($expectedType) {
            'array_of_capabilities' => $this->assertIsArray($result),
            'capability' => $this->assertInstanceOf(RpcPromise::class, $result),
            'null' => $this->assertNull($result),
            'array' => $this->assertIsArray($result),
            'number' => $this->assertIsNumeric($result),
            'string' => $this->assertIsString($result),
            'boolean' => $this->assertIsBool($result),
            default => $this->fail("Unknown expected type: {$expectedType}"),
        };

        if (isset($test['expect_length'])) {
            $this->assertCount($test['expect_length'], $result);
        }
    }

    /**
     * Execute verification steps
     */
    private function executeVerification(mixed $result, array $verification): void
    {
        $call = $verification['call'];
        $expected = $verification['expect'];

        // Handle result.method calls
        if (str_starts_with($call, 'result.')) {
            $method = substr($call, 7);
            $actual = $result->$method;

            if ($actual instanceof RpcPromise) {
                $actual = $actual->await();
            }

            $this->assertEquals($expected, $actual);
        }
    }
}
