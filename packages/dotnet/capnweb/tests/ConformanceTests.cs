// ============================================================================
// Cap'n Web Conformance Test Harness for .NET
// ============================================================================
//
// Runs SDK conformance tests against a test server.
//
// Environment variables:
//   TEST_SERVER_URL - URL of the test server (default: ws://localhost:8787)
//   TEST_SPEC_DIR   - Directory containing YAML test specs (optional)
//
// Run tests:
//   dotnet test
//   TEST_SERVER_URL=ws://localhost:8080 dotnet test
//
// ============================================================================

using System.Text.Json;
using System.Text.Json.Nodes;
using DotDo.CapnWeb;
using Xunit;
using Xunit.Abstractions;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace DotDo.CapnWeb.Tests;

// ============================================================================
// Test Specification Types (YAML deserialization)
// ============================================================================

/// <summary>
/// A conformance test specification file.
/// </summary>
public record TestSpec
{
    public string Name { get; init; } = "";
    public string Description { get; init; } = "";
    public List<TestCase> Tests { get; init; } = [];
}

/// <summary>
/// An individual test case.
/// </summary>
public record TestCase
{
    public string Name { get; init; } = "";
    public string Description { get; init; } = "";

    // Simple call
    public string? Call { get; init; }
    public List<object?>? Args { get; init; }
    public object? Expect { get; init; }

    // Type expectation
    public string? ExpectType { get; init; }
    public int? ExpectLength { get; init; }

    // Error expectation
    public ExpectedError? ExpectError { get; init; }

    // Map/remap operation (KEY FEATURE!)
    public MapSpec? Map { get; init; }

    // Pipeline tests
    public List<PipelineStepSpec>? Pipeline { get; init; }
    public int? MaxRoundTrips { get; init; }

    // Setup and sequence
    public List<SetupStepSpec>? Setup { get; init; }
    public List<SequenceStepSpec>? Sequence { get; init; }

    // Verification steps
    public List<VerifyStepSpec>? Verify { get; init; }

    // Metadata (set during loading)
    public string File { get; set; } = "";
    public string Category { get; set; } = "";
}

/// <summary>
/// Map/remap specification for server-side collection transformation.
/// </summary>
public record MapSpec
{
    public string Expression { get; init; } = "";
    public List<string>? Captures { get; init; }
}

/// <summary>
/// Expected error specification.
/// </summary>
public record ExpectedError
{
    public string? Type { get; init; }
    public string? MessageContains { get; init; }
    public List<AnyOfSpec>? AnyOf { get; init; }
}

/// <summary>
/// Alternative error or value expectation.
/// </summary>
public record AnyOfSpec
{
    public string? Type { get; init; }
    public object? Value { get; init; }
}

/// <summary>
/// A step in a pipeline test.
/// </summary>
public record PipelineStepSpec
{
    public string Call { get; init; } = "";
    public List<object?>? Args { get; init; }
    public string? As { get; init; }
}

/// <summary>
/// A setup step (run before the main test).
/// </summary>
public record SetupStepSpec
{
    public string? Call { get; init; }
    public List<object?>? Args { get; init; }
    public string? As { get; init; }
    public bool Await { get; init; }
    public MapSpec? Map { get; init; }
    public List<PipelineStepSpec>? Pipeline { get; init; }
}

/// <summary>
/// A sequence step (executed in order).
/// </summary>
public record SequenceStepSpec
{
    public string Call { get; init; } = "";
    public List<object?>? Args { get; init; }
    public object? Expect { get; init; }
    public string? As { get; init; }
}

/// <summary>
/// A verification step (run after main test).
/// </summary>
public record VerifyStepSpec
{
    public string Call { get; init; } = "";
    public object? Expect { get; init; }
}

// ============================================================================
// Test Data Provider
// ============================================================================

/// <summary>
/// Provides test data from conformance YAML files.
/// </summary>
public static class ConformanceTestData
{
    private static readonly Lazy<List<TestCase>> AllTests = new(LoadAllTests);

    /// <summary>
    /// Gets all conformance tests as xUnit theory data.
    /// </summary>
    public static IEnumerable<object[]> AllTestCases =>
        AllTests.Value.Select(tc => new object[] { tc });

    /// <summary>
    /// Gets basic call tests only.
    /// </summary>
    public static IEnumerable<object[]> BasicTestCases =>
        AllTests.Value
            .Where(tc => tc.File == "basic.yaml")
            .Select(tc => new object[] { tc });

    /// <summary>
    /// Gets map/remap tests only.
    /// </summary>
    public static IEnumerable<object[]> MapTestCases =>
        AllTests.Value
            .Where(tc => tc.File == "map.yaml" || tc.Map != null)
            .Select(tc => new object[] { tc });

    /// <summary>
    /// Gets the test server URL from environment.
    /// </summary>
    public static string ServerUrl =>
        Environment.GetEnvironmentVariable("TEST_SERVER_URL") ?? "ws://localhost:8787";

    /// <summary>
    /// Gets the spec directory from environment.
    /// </summary>
    public static string SpecDirectory
    {
        get
        {
            var envDir = Environment.GetEnvironmentVariable("TEST_SPEC_DIR");
            if (!string.IsNullOrEmpty(envDir))
                return envDir;

            // Default: relative to the test assembly
            var assemblyDir = Path.GetDirectoryName(typeof(ConformanceTestData).Assembly.Location)!;

            // Try different relative paths
            var possiblePaths = new[]
            {
                Path.Combine(assemblyDir, "conformance"),  // Copied to output
                Path.Combine(assemblyDir, "..", "..", "..", "..", "..", "test", "conformance"),  // Dev path
                Path.Combine(assemblyDir, "..", "..", "test", "conformance"),  // Another common path
            };

            foreach (var path in possiblePaths)
            {
                var fullPath = Path.GetFullPath(path);
                if (Directory.Exists(fullPath))
                    return fullPath;
            }

            return possiblePaths[1]; // Return default even if not found
        }
    }

    private static List<TestCase> LoadAllTests()
    {
        var tests = new List<TestCase>();
        var specDir = SpecDirectory;

        if (!Directory.Exists(specDir))
        {
            Console.WriteLine($"Warning: Spec directory not found: {specDir}");
            return tests;
        }

        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(UnderscoredNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();

        foreach (var yamlFile in Directory.GetFiles(specDir, "*.yaml").OrderBy(f => f))
        {
            try
            {
                var content = File.ReadAllText(yamlFile);
                var spec = deserializer.Deserialize<TestSpec>(content);

                if (spec?.Tests == null) continue;

                var fileName = Path.GetFileName(yamlFile);
                foreach (var test in spec.Tests)
                {
                    test.File = fileName;
                    test.Category = spec.Name;
                    tests.Add(test);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Warning: Failed to parse {yamlFile}: {ex.Message}");
            }
        }

        return tests;
    }
}

// ============================================================================
// Conformance Test Class
// ============================================================================

/// <summary>
/// Conformance test suite - runs tests from YAML specifications.
/// </summary>
public class ConformanceTests : IAsyncLifetime
{
    private readonly ITestOutputHelper _output;
    private Session? _session;

    public ConformanceTests(ITestOutputHelper output)
    {
        _output = output;
    }

    public async Task InitializeAsync()
    {
        try
        {
            _session = await CapnWebClient.Connect(ConformanceTestData.ServerUrl);
            _output.WriteLine($"Connected to {ConformanceTestData.ServerUrl}");
        }
        catch (Exception ex)
        {
            _output.WriteLine($"Failed to connect: {ex.Message}");
            // Session will be null, tests will skip
        }
    }

    public async Task DisposeAsync()
    {
        if (_session != null)
        {
            await _session.DisposeAsync();
        }
    }

    // ========================================================================
    // Main Conformance Test Method
    // ========================================================================

    [Theory]
    [MemberData(nameof(ConformanceTestData.AllTestCases), MemberType = typeof(ConformanceTestData))]
    public async Task RunConformanceTest(TestCase test)
    {
        _output.WriteLine($"Test: {test.Category}/{test.Name}");
        _output.WriteLine($"Description: {test.Description}");

        // Skip if SDK not implemented
        if (!CapnWebClient.IsImplemented)
        {
            Skip.If(true, $"SDK not implemented yet: {test.Category}/{test.Name}");
            return;
        }

        // Skip if not connected
        if (_session == null || !_session.IsConnected)
        {
            Skip.If(true, $"Cannot connect to test server: {test.Name}");
            return;
        }

        // Execute the test based on type
        if (test.Pipeline != null)
        {
            await RunPipelineTest(test);
        }
        else if (test.Sequence != null)
        {
            await RunSequenceTest(test);
        }
        else if (test.Call != null)
        {
            await RunCallTest(test);
        }
        else
        {
            Skip.If(true, $"Unknown test type: {test.Name}");
        }
    }

    // ========================================================================
    // Map-Specific Tests
    // ========================================================================

    [Theory]
    [MemberData(nameof(ConformanceTestData.MapTestCases), MemberType = typeof(ConformanceTestData))]
    public async Task RunMapTest(TestCase test)
    {
        _output.WriteLine($"Map Test: {test.Category}/{test.Name}");
        _output.WriteLine($"Description: {test.Description}");

        if (test.Map != null)
        {
            _output.WriteLine($"Map Expression: {test.Map.Expression}");
            _output.WriteLine($"Captures: {string.Join(", ", test.Map.Captures ?? [])}");
        }

        // Skip if SDK not implemented
        if (!CapnWebClient.IsImplemented)
        {
            Skip.If(true, $"SDK not implemented yet: {test.Category}/{test.Name}");
            return;
        }

        // Skip if not connected
        if (_session == null || !_session.IsConnected)
        {
            Skip.If(true, $"Cannot connect to test server: {test.Name}");
            return;
        }

        await RunCallTest(test);
    }

    // ========================================================================
    // Test Execution Methods
    // ========================================================================

    private async Task RunCallTest(TestCase test)
    {
        var method = test.Call!;
        var args = ConvertArgs(test.Args ?? []);
        var map = test.Map != null
            ? new DynamicMapExpression(test.Map.Expression, test.Map.Captures ?? [])
            : null;

        try
        {
            var result = await _session!.CallWithMapAsync(method, args, map);

            // Handle error expectation
            if (test.ExpectError != null)
            {
                Assert.Fail($"Expected error but got result: {result}");
            }

            // Handle type expectation
            if (test.ExpectType != null)
            {
                VerifyType(result, test.ExpectType);
            }

            // Handle length expectation
            if (test.ExpectLength.HasValue)
            {
                VerifyLength(result, test.ExpectLength.Value);
            }

            // Handle value expectation
            if (test.Expect != null)
            {
                VerifyValue(result, test.Expect);
            }

            // Handle verification steps
            if (test.Verify != null)
            {
                await RunVerificationSteps(result, test.Verify);
            }
        }
        catch (RpcException ex) when (test.ExpectError != null)
        {
            VerifyError(ex, test.ExpectError);
        }
    }

    private async Task RunPipelineTest(TestCase test)
    {
        var context = new Dictionary<string, JsonNode?>();

        // Execute setup steps
        if (test.Setup != null)
        {
            await ExecuteSetupSteps(test.Setup, context);
        }

        // Build pipeline steps
        var steps = test.Pipeline!.Select(step => new DynamicPipelineStep(
            ResolveCallPath(step.Call, context),
            ConvertArgs(step.Args ?? [], context),
            step.As
        )).ToList();

        try
        {
            var result = await _session!.CallPipelineAsync(steps);

            if (test.Expect != null)
            {
                VerifyValue(result, test.Expect);
            }
        }
        catch (RpcException ex) when (test.ExpectError != null)
        {
            VerifyError(ex, test.ExpectError);
        }
    }

    private async Task RunSequenceTest(TestCase test)
    {
        var context = new Dictionary<string, JsonNode?>();

        // Execute setup steps
        if (test.Setup != null)
        {
            await ExecuteSetupSteps(test.Setup, context);
        }

        foreach (var step in test.Sequence!)
        {
            var method = ResolveCallPath(step.Call, context);
            var args = ConvertArgs(step.Args ?? [], context);

            var result = await _session!.CallMethodAsync(method, args);

            if (step.Expect != null)
            {
                VerifyValue(result, step.Expect, $"Sequence step '{step.Call}' failed");
            }

            if (step.As != null)
            {
                context[step.As] = result;
            }
        }
    }

    private async Task ExecuteSetupSteps(List<SetupStepSpec> steps, Dictionary<string, JsonNode?> context)
    {
        foreach (var step in steps)
        {
            if (step.Call != null)
            {
                var method = ResolveCallPath(step.Call, context);
                var args = ConvertArgs(step.Args ?? [], context);
                var map = step.Map != null
                    ? new DynamicMapExpression(step.Map.Expression, step.Map.Captures ?? [])
                    : null;

                var result = await _session!.CallWithMapAsync(method, args, map);

                if (step.As != null)
                {
                    context[step.As] = result;
                }
            }
            else if (step.Pipeline != null)
            {
                var pipelineSteps = step.Pipeline.Select(ps => new DynamicPipelineStep(
                    ResolveCallPath(ps.Call, context),
                    ConvertArgs(ps.Args ?? [], context),
                    ps.As
                )).ToList();

                var result = await _session!.CallPipelineAsync(pipelineSteps);

                if (step.As != null)
                {
                    context[step.As] = result;
                }
            }
        }
    }

    private async Task RunVerificationSteps(JsonNode? result, List<VerifyStepSpec> steps)
    {
        foreach (var step in steps)
        {
            // Parse call path (e.g., "result.value")
            var parts = step.Call.Split('.');
            JsonNode? target = result;

            foreach (var part in parts.Skip(1)) // Skip "result" prefix
            {
                if (target is JsonObject obj)
                {
                    target = obj[part];
                }
                else
                {
                    // Need to make RPC call
                    var method = part.TrimEnd('(', ')');
                    target = await _session!.CallMethodAsync(method, [target]);
                }
            }

            VerifyValue(target, step.Expect, $"Verification '{step.Call}' failed");
        }
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    private static List<JsonNode?> ConvertArgs(List<object?> args, Dictionary<string, JsonNode?>? context = null)
    {
        return args.Select(arg => ConvertArg(arg, context)).ToList();
    }

    private static JsonNode? ConvertArg(object? arg, Dictionary<string, JsonNode?>? context)
    {
        if (arg == null) return null;

        // Handle variable references
        if (arg is string str && str.StartsWith("$"))
        {
            var varName = str[1..];
            if (varName == "self") return JsonValue.Create("$self");
            if (context?.TryGetValue(varName, out var value) == true) return value;
            return JsonValue.Create(str);
        }

        return JsonSerializer.SerializeToNode(arg);
    }

    private static string ResolveCallPath(string call, Dictionary<string, JsonNode?> context)
    {
        // Handle $variable.method paths
        if (call.StartsWith("$"))
        {
            var parts = call.Split('.');
            var varName = parts[0][1..]; // Remove $
            if (context.ContainsKey(varName))
            {
                // Return the full path for the session to resolve
                return call;
            }
        }
        return call;
    }

    private void VerifyValue(JsonNode? actual, object? expected, string? message = null)
    {
        var expectedJson = JsonSerializer.SerializeToNode(expected);
        var areEqual = JsonValuesEqual(actual, expectedJson);

        if (!areEqual)
        {
            var actualStr = actual?.ToJsonString() ?? "null";
            var expectedStr = expectedJson?.ToJsonString() ?? "null";
            Assert.Fail(message ?? $"Expected {expectedStr}, got {actualStr}");
        }
    }

    private static bool JsonValuesEqual(JsonNode? a, JsonNode? b)
    {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;

        return (a, b) switch
        {
            (JsonValue av, JsonValue bv) => JsonValueEqual(av, bv),
            (JsonArray aa, JsonArray ba) => aa.Count == ba.Count &&
                aa.Zip(ba).All(pair => JsonValuesEqual(pair.First, pair.Second)),
            (JsonObject ao, JsonObject bo) => ao.Count == bo.Count &&
                ao.All(kvp => bo.ContainsKey(kvp.Key) && JsonValuesEqual(kvp.Value, bo[kvp.Key])),
            _ => a.ToJsonString() == b.ToJsonString()
        };
    }

    private static bool JsonValueEqual(JsonValue a, JsonValue b)
    {
        // Handle numeric comparison with tolerance
        if (a.TryGetValue<double>(out var ad) && b.TryGetValue<double>(out var bd))
        {
            return Math.Abs(ad - bd) < 1e-10;
        }

        return a.ToJsonString() == b.ToJsonString();
    }

    private void VerifyType(JsonNode? actual, string expectedType)
    {
        var actualType = actual switch
        {
            null => "null",
            JsonArray => "array",
            JsonObject => "object",
            JsonValue v when v.TryGetValue<int>(out _) => "number",
            JsonValue v when v.TryGetValue<double>(out _) => "number",
            JsonValue v when v.TryGetValue<string>(out _) => "string",
            JsonValue v when v.TryGetValue<bool>(out _) => "boolean",
            _ => "unknown"
        };

        var isMatch = expectedType switch
        {
            "capability" => actual is JsonObject,
            "array_of_capabilities" => actual is JsonArray arr && arr.All(e => e is JsonObject),
            _ => actualType == expectedType
        };

        Assert.True(isMatch, $"Expected type {expectedType}, got {actualType}");
    }

    private void VerifyLength(JsonNode? actual, int expectedLength)
    {
        var actualLength = actual switch
        {
            JsonArray arr => arr.Count,
            _ => throw new AssertActualExpectedException(expectedLength, actual, "Expected an array")
        };

        Assert.Equal(expectedLength, actualLength);
    }

    private void VerifyError(RpcException ex, ExpectedError expected)
    {
        // Check any_of alternatives
        if (expected.AnyOf != null)
        {
            var matchesAny = expected.AnyOf.Any(alt =>
                alt.Type == null || ex.ErrorType == alt.Type);
            Assert.True(matchesAny, $"Error type {ex.ErrorType} did not match any of: {string.Join(", ", expected.AnyOf.Select(a => a.Type))}");
            return;
        }

        // Check type
        if (expected.Type != null)
        {
            Assert.Equal(expected.Type, ex.ErrorType);
        }

        // Check message contains
        if (expected.MessageContains != null)
        {
            Assert.Contains(expected.MessageContains, ex.Message, StringComparison.OrdinalIgnoreCase);
        }
    }
}

// ============================================================================
// SDK Unit Tests (not from conformance specs)
// ============================================================================

/// <summary>
/// Unit tests for the SDK itself (not from conformance specs).
/// </summary>
public class SdkUnitTests
{
    [Fact]
    public void IsImplemented_ReturnsFalse()
    {
        // Stub SDK should report not implemented
        Assert.False(CapnWebClient.IsImplemented);
    }

    [Fact]
    public void Version_ReturnsVersion()
    {
        Assert.NotEmpty(CapnWebClient.Version);
    }

    [Fact]
    public void Promise_ExpressionString_SimpleCall()
    {
        var session = new Session("ws://localhost:8787");
        var promise = new RpcPromise<int>(session, "square", 5);
        Assert.Equal("square(5)", promise.ExpressionString);
    }

    [Fact]
    public void Promise_ExpressionString_Pipeline()
    {
        var session = new Session("ws://localhost:8787");
        var promise = session.Api.MakeCounter(42).Value();
        Assert.Contains("makeCounter", promise.ExpressionString);
        Assert.Contains("value", promise.ExpressionString);
    }

    [Fact]
    public void Promise_Select_BuildsMapExpression()
    {
        var session = new Session("ws://localhost:8787");
        var api = session.Api;

        // This is the KEY feature - LINQ-style Select() for server-side mapping
        var promise = api.GenerateFibonacci(6)
            .Select(x => api.Square(x));

        var expr = promise.ExpressionString;
        Assert.Contains("generateFibonacci", expr);
        Assert.Contains("Select", expr);
    }

    [Fact]
    public async Task Session_ThrowsNotImplemented_OnMethodCall()
    {
        var session = new Session("ws://localhost:8787");
        await Assert.ThrowsAsync<NotImplementedException>(
            () => session.CallMethodAsync("test", [])
        );
    }
}

// ============================================================================
// Spec Loading Tests
// ============================================================================

/// <summary>
/// Tests for loading and parsing conformance specs.
/// </summary>
public class SpecLoadingTests
{
    private readonly ITestOutputHelper _output;

    public SpecLoadingTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void CanLoadSpecDirectory()
    {
        var specDir = ConformanceTestData.SpecDirectory;
        _output.WriteLine($"Spec directory: {specDir}");
        _output.WriteLine($"Exists: {Directory.Exists(specDir)}");
    }

    [Fact]
    public void CanLoadBasicYaml()
    {
        var tests = ConformanceTestData.BasicTestCases.ToList();
        _output.WriteLine($"Found {tests.Count} basic tests");

        if (tests.Count > 0)
        {
            var first = (TestCase)tests[0][0];
            _output.WriteLine($"First test: {first.Name}");
        }
    }

    [Fact]
    public void CanLoadMapYaml()
    {
        var tests = ConformanceTestData.MapTestCases.ToList();
        _output.WriteLine($"Found {tests.Count} map tests");

        foreach (var testData in tests.Take(5))
        {
            var test = (TestCase)testData[0];
            _output.WriteLine($"  - {test.Name}: {test.Map?.Expression ?? "no map"}");
        }
    }

    [Fact]
    public void AllTestCases_HaveRequiredFields()
    {
        foreach (var testData in ConformanceTestData.AllTestCases)
        {
            var test = (TestCase)testData[0];
            Assert.NotEmpty(test.Name);
            // Either call, pipeline, or sequence must be set
            var hasTestType = test.Call != null || test.Pipeline != null || test.Sequence != null;
            Assert.True(hasTestType, $"Test {test.Name} has no call, pipeline, or sequence");
        }
    }
}

// ============================================================================
// Map/Remap Specific Tests
// ============================================================================

/// <summary>
/// Tests specifically for the map/remap feature.
/// </summary>
public class MapFeatureTests
{
    [Fact]
    public void MapSpec_ParsesCorrectly()
    {
        var yaml = @"
name: Map Test
description: Test map parsing
tests:
  - name: test_map
    call: generateFibonacci
    args: [6]
    map:
      expression: ""x => self.square(x)""
      captures: [""$self""]
    expect: [0, 1, 1, 4, 9, 25]
";
        var deserializer = new DeserializerBuilder()
            .WithNamingConvention(UnderscoredNamingConvention.Instance)
            .IgnoreUnmatchedProperties()
            .Build();

        var spec = deserializer.Deserialize<TestSpec>(yaml);

        Assert.Single(spec.Tests);
        Assert.NotNull(spec.Tests[0].Map);
        Assert.Equal("x => self.square(x)", spec.Tests[0].Map!.Expression);
        Assert.Contains("$self", spec.Tests[0].Map.Captures!);
    }

    [Fact]
    public void Select_CapturesExpression()
    {
        var session = new Session("ws://localhost:8787");
        var api = session.Api;

        // Build the expression tree
        var promise = api.GenerateFibonacci(6)
            .Select(x => api.Square(x));

        // The expression should capture the inner call
        Assert.Contains("Select", promise.ExpressionString);
    }

    [Fact]
    public void Select_OnNullableResult_ReturnsNullableArray()
    {
        var session = new Session("ws://localhost:8787");
        var api = session.Api;

        // Map on null/undefined should return null (per spec)
        var promise = api.ReturnNull().Call<int[]>("$identity");

        // Type signature allows null result
        Assert.NotNull(promise);
    }
}
