defmodule DotDo.CapnWeb.ConformanceTest do
  @moduledoc """
  Conformance tests for the DotDo.CapnWeb Elixir SDK.

  These tests are dynamically generated from YAML spec files and verify
  that the SDK correctly implements the Cap'n Web RPC protocol.

  ## Running Tests

      # Run all tests
      mix test

      # Run only conformance tests
      mix test --only conformance

      # Run with custom server URL
      TEST_SERVER_URL=ws://my-server:8080 mix test

      # Run with custom spec directory
      TEST_SPEC_DIR=/path/to/specs mix test

  """

  use ExUnit.Case, async: false

  alias DotDo.CapnWeb.Test.ConformanceConfig

  require Logger

  @moduletag :conformance

  # =============================================================================
  # Test Generation
  # =============================================================================

  # Generate tests dynamically from YAML specs at compile time
  for spec <- ConformanceConfig.load_specs() do
    spec_name = Map.get(spec, "name", "Unknown Spec")
    spec_description = Map.get(spec, "description", "")
    tests = Map.get(spec, "tests", [])

    describe "#{spec_name}" do
      @tag spec_description: spec_description

      for test <- tests do
        test_name = Map.get(test, "name", "unnamed_test")
        test_description = Map.get(test, "description", "")

        @tag test_name: test_name
        @tag test_description: test_description

        # Store test config in module attribute for runtime access
        @test_config test

        test "#{test_name}: #{test_description}" do
          run_conformance_test(@test_config)
        end
      end
    end
  end

  # =============================================================================
  # Test Runner
  # =============================================================================

  defp run_conformance_test(test_config) do
    server_url = ConformanceConfig.server_url()

    # Connect to server
    case DotDo.CapnWeb.connect(server_url) do
      {:ok, api} ->
        try do
          context = %{self: api}

          # Run setup if present
          context =
            if setup = Map.get(test_config, "setup") do
              run_setup(api, setup, context)
            else
              context
            end

          # Determine test type and run
          result =
            cond do
              Map.has_key?(test_config, "sequence") ->
                run_sequence_test(api, test_config, context)

              Map.has_key?(test_config, "pipeline") ->
                run_pipeline_test(api, test_config, context)

              Map.has_key?(test_config, "call") ->
                run_simple_test(api, test_config, context)

              true ->
                flunk("Unknown test type in #{test_config["name"]}")
            end

          # Check expectations
          check_expectations(result, test_config)
        rescue
          e in DotDo.CapnWeb.Error ->
            if test_config["expect_error"] do
              check_error_expectation(e, test_config["expect_error"])
            else
              reraise e, __STACKTRACE__
            end
        after
          DotDo.CapnWeb.disconnect(api)
        end

      {:error, %DotDo.CapnWeb.Error{type: :not_implemented}} ->
        skip_not_implemented("connect")

      {:error, error} ->
        flunk("Failed to connect to #{server_url}: #{inspect(error)}")
    end
  end

  # =============================================================================
  # Simple Call Tests
  # =============================================================================

  defp run_simple_test(api, test_config, context) do
    call = Map.fetch!(test_config, "call")
    args = resolve_args(Map.get(test_config, "args", []), context)

    # Build and execute the call
    promise = execute_call(api, call, args, context)

    # Apply map operation if present
    promise =
      if map_config = Map.get(test_config, "map") do
        apply_map(promise, map_config, context)
      else
        promise
      end

    # Await the result
    DotDo.CapnWeb.await!(promise)
  end

  # =============================================================================
  # Sequence Tests
  # =============================================================================

  defp run_sequence_test(api, test_config, context) do
    test_config["sequence"]
    |> Enum.reduce({context, nil}, fn step, {ctx, _last_result} ->
      args = resolve_args(Map.get(step, "args", []), ctx)
      promise = execute_call(api, step["call"], args, ctx)
      result = DotDo.CapnWeb.await!(promise)

      # Update context if 'as' is specified
      ctx =
        if as = Map.get(step, "as") do
          Map.put(ctx, String.to_atom(as), result)
        else
          ctx
        end

      # Check intermediate expectations
      if expect = Map.get(step, "expect") do
        assert_value_matches(result, expect)
      end

      {ctx, result}
    end)
    |> elem(1)
  end

  # =============================================================================
  # Pipeline Tests
  # =============================================================================

  defp run_pipeline_test(api, test_config, context) do
    {promises, context} =
      test_config["pipeline"]
      |> Enum.reduce({%{}, context}, fn step, {promises, ctx} ->
        args = resolve_args(Map.get(step, "args", []), ctx)

        # Determine the target of the call
        {target, method} = resolve_call_target(step["call"], promises, ctx, api)

        # Build the promise
        promise =
          if args == [] do
            DotDo.CapnWeb.prop(target, String.to_atom(method))
          else
            DotDo.CapnWeb.call(target, String.to_atom(method), args)
          end

        # Store promise if named
        promises =
          if as = Map.get(step, "as") do
            Map.put(promises, as, promise)
          else
            Map.put(promises, "_last", promise)
          end

        ctx =
          if as = Map.get(step, "as") do
            Map.put(ctx, String.to_atom(as), promise)
          else
            ctx
          end

        {promises, ctx}
      end)

    # Await all named promises
    results =
      promises
      |> Enum.reject(fn {name, _} -> name == "_last" end)
      |> Enum.map(fn {name, promise} -> {name, DotDo.CapnWeb.await!(promise)} end)
      |> Map.new()

    # If there's a single expectation and one result, return just the value
    case {Map.keys(results), test_config["expect"]} do
      {[_single_key], expect} when not is_map(expect) ->
        results |> Map.values() |> hd()

      {[], _} ->
        if last = Map.get(promises, "_last") do
          DotDo.CapnWeb.await!(last)
        else
          nil
        end

      _ ->
        results
    end
  end

  # =============================================================================
  # Map Operation Support
  # =============================================================================

  defp apply_map(promise, map_config, context) do
    expression = Map.get(map_config, "expression", "")
    _captures = Map.get(map_config, "captures", [])

    # Parse and build the mapper function
    mapper_fn = build_mapper_function(expression, context)

    DotDo.CapnWeb.map(promise, mapper_fn)
  end

  @doc """
  Builds an Elixir function from a JavaScript-like expression.

  Supported patterns:
  - `x => self.square(x)` - Single method call
  - `x => self.returnNumber(x * 2)` - Method call with expression arg
  - `counter => counter.value` - Property access on element
  - `c => c.increment(10)` - Method call on element

  """
  def build_mapper_function(expression, context) do
    # Parse the expression to determine what kind of mapper to build
    cond do
      # Pattern: x => self.method(x)
      String.match?(expression, ~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/) ->
        [_, method, _arg_name] =
          Regex.run(~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/, expression)

        api = context[:self]
        fn x -> DotDo.CapnWeb.call(api, String.to_atom(method), [x]) end

      # Pattern: x => self.method(x * N) - expression in args
      String.match?(expression, ~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\s*\*\s*(\d+)\)$/) ->
        [_, method, _arg_name, multiplier] =
          Regex.run(~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\s*\*\s*(\d+)\)$/, expression)

        api = context[:self]
        mult = String.to_integer(multiplier)
        fn x -> DotDo.CapnWeb.call(api, String.to_atom(method), [x * mult]) end

      # Pattern: x => self.makeCounter(x) - creates capability
      String.match?(expression, ~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/) ->
        [_, method, _arg_name] =
          Regex.run(~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/, expression)

        api = context[:self]
        fn x -> DotDo.CapnWeb.call(api, String.to_atom(method), [x]) end

      # Pattern: counter => counter.value - property access
      String.match?(expression, ~r/^(\w+)\s*=>\s*\1\.(\w+)$/) ->
        [_, _var, prop] = Regex.run(~r/^(\w+)\s*=>\s*\1\.(\w+)$/, expression)
        fn elem -> DotDo.CapnWeb.prop(elem, String.to_atom(prop)) end

      # Pattern: c => c.method(arg) - method call on element
      String.match?(expression, ~r/^(\w+)\s*=>\s*\1\.(\w+)\((.+)\)$/) ->
        [_, _var, method, args_str] =
          Regex.run(~r/^(\w+)\s*=>\s*\1\.(\w+)\((.+)\)$/, expression)

        args = parse_args(args_str)
        fn elem -> DotDo.CapnWeb.call(elem, String.to_atom(method), args) end

      # Pattern: n => self.generateFibonacci(n) - nested call
      String.match?(expression, ~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/) ->
        [_, method, _arg_name] =
          Regex.run(~r/^\w+\s*=>\s*self\.(\w+)\((\w+)\)$/, expression)

        api = context[:self]
        fn x -> DotDo.CapnWeb.call(api, String.to_atom(method), [x]) end

      true ->
        # Default: identity function (shouldn't happen in valid tests)
        Logger.warning("Unknown map expression pattern: #{expression}")
        fn x -> x end
    end
  end

  defp parse_args(args_str) do
    # Simple arg parsing - handles numbers and string literals
    args_str
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.map(fn arg ->
      cond do
        String.match?(arg, ~r/^\d+$/) -> String.to_integer(arg)
        String.match?(arg, ~r/^\d+\.\d+$/) -> String.to_float(arg)
        String.starts_with?(arg, "\"") -> String.trim(arg, "\"")
        String.starts_with?(arg, "'") -> String.trim(arg, "'")
        true -> arg
      end
    end)
  end

  # =============================================================================
  # Setup Execution
  # =============================================================================

  defp run_setup(api, setup_steps, context) do
    Enum.reduce(setup_steps, context, fn step, ctx ->
      cond do
        # Pipeline setup
        Map.has_key?(step, "pipeline") ->
          run_pipeline_setup(api, step, ctx)

        # Regular call setup
        Map.has_key?(step, "call") ->
          args = resolve_args(Map.get(step, "args", []), ctx)
          promise = execute_call(api, step["call"], args, ctx)

          # Apply map if present
          promise =
            if map_config = Map.get(step, "map") do
              apply_map(promise, map_config, ctx)
            else
              promise
            end

          # Await if specified
          result =
            if Map.get(step, "await", false) do
              DotDo.CapnWeb.await!(promise)
            else
              promise
            end

          # Store result
          if as = Map.get(step, "as") do
            Map.put(ctx, String.to_atom(as), result)
          else
            ctx
          end

        true ->
          ctx
      end
    end)
  end

  defp run_pipeline_setup(api, step, context) do
    {promises, context} =
      step["pipeline"]
      |> Enum.reduce({%{}, context}, fn pipeline_step, {promises, ctx} ->
        args = resolve_args(Map.get(pipeline_step, "args", []), ctx)
        {target, method} = resolve_call_target(pipeline_step["call"], promises, ctx, api)

        promise =
          if args == [] do
            DotDo.CapnWeb.prop(target, String.to_atom(method))
          else
            DotDo.CapnWeb.call(target, String.to_atom(method), args)
          end

        # Apply map if present
        promise =
          if map_config = Map.get(pipeline_step, "map") do
            apply_map(promise, map_config, ctx)
          else
            promise
          end

        promises = Map.put(promises, pipeline_step["as"] || "_last", promise)
        {promises, ctx}
      end)

    # Await if needed and store result
    if as = Map.get(step, "as") do
      result =
        if Map.get(step, "await", false) do
          promises["_last"] |> DotDo.CapnWeb.await!()
        else
          promises["_last"]
        end

      Map.put(context, String.to_atom(as), result)
    else
      context
    end
  end

  # =============================================================================
  # Helper Functions
  # =============================================================================

  defp execute_call(api, call, args, context) do
    # Handle $variable references in call string
    if String.starts_with?(call, "$") do
      var_name = String.trim_leading(call, "$") |> String.to_atom()
      target = Map.fetch!(context, var_name)

      if is_struct(target, DotDo.CapnWeb.Promise) or is_struct(target, DotDo.CapnWeb.Stub) do
        if args == [] do
          target
        else
          DotDo.CapnWeb.call(target, :__identity__, args)
        end
      else
        # It's a resolved value - wrap it
        target
      end
    else
      # Parse method chain (e.g., "counter.increment")
      case String.split(call, ".") do
        [method] ->
          DotDo.CapnWeb.call(api, String.to_atom(method), args)

        [ref_name | method_chain] ->
          # Get the base reference from context
          base =
            case Map.get(context, String.to_atom(ref_name)) do
              nil -> Map.get(context, ref_name)
              val -> val
            end

          if base == nil do
            raise "Unknown reference: #{ref_name}"
          end

          # Chain through the methods
          Enum.reduce(method_chain, base, fn method, acc ->
            if args == [] do
              DotDo.CapnWeb.prop(acc, String.to_atom(method))
            else
              DotDo.CapnWeb.call(acc, String.to_atom(method), args)
            end
          end)
      end
    end
  end

  defp resolve_call_target(call, promises, context, api) do
    case String.split(call, ".") do
      [method] ->
        {api, method}

      [ref_name | rest] ->
        # Look for reference in promises first, then context
        target =
          Map.get(promises, ref_name) ||
            Map.get(context, String.to_atom(ref_name)) ||
            Map.get(context, ref_name)

        if target == nil do
          # Maybe it's a direct property on api
          {api, call}
        else
          {target, List.last(rest)}
        end
    end
  end

  defp resolve_args(args, context) do
    Enum.map(args, fn
      "$" <> var_name ->
        # Variable reference
        key = String.to_atom(var_name)
        Map.get(context, key) || Map.get(context, var_name)

      other ->
        other
    end)
  end

  # =============================================================================
  # Expectation Checking
  # =============================================================================

  defp check_expectations(result, test_config) do
    cond do
      Map.has_key?(test_config, "expect_error") ->
        flunk("Expected an error but got success: #{inspect(result)}")

      Map.has_key?(test_config, "expect") ->
        assert_value_matches(result, test_config["expect"])

      Map.has_key?(test_config, "expect_type") ->
        assert_type_matches(result, test_config["expect_type"])
        check_length_expectation(result, test_config)

      Map.has_key?(test_config, "verify") ->
        run_verifications(result, test_config["verify"])

      true ->
        :ok
    end

    # Check max_round_trips constraint (informational)
    if max_trips = Map.get(test_config, "max_round_trips") do
      Logger.debug("Note: max_round_trips=#{max_trips} constraint not yet verified")
    end
  end

  defp assert_value_matches(actual, expected) do
    assert values_equal?(actual, expected),
           "Expected #{inspect(expected)}, got #{inspect(actual)}"
  end

  defp values_equal?(actual, expected) when is_nil(expected), do: is_nil(actual)
  defp values_equal?(actual, expected) when is_nil(actual), do: is_nil(expected)

  defp values_equal?(actual, expected) when is_list(expected) and is_list(actual) do
    length(actual) == length(expected) and
      Enum.zip(actual, expected)
      |> Enum.all?(fn {a, e} -> values_equal?(a, e) end)
  end

  defp values_equal?(actual, expected) when is_map(expected) and is_map(actual) do
    Map.keys(expected)
    |> Enum.all?(fn key ->
      values_equal?(Map.get(actual, key), Map.get(expected, key))
    end)
  end

  defp values_equal?(actual, expected) when is_number(expected) and is_number(actual) do
    # Handle float comparison
    abs(actual - expected) < 0.0001
  end

  defp values_equal?(actual, expected), do: actual == expected

  defp assert_type_matches(result, "capability") do
    assert is_struct(result, DotDo.CapnWeb.Promise) or is_struct(result, DotDo.CapnWeb.Stub),
           "Expected a capability, got #{inspect(result)}"
  end

  defp assert_type_matches(result, "array_of_capabilities") do
    assert is_list(result), "Expected array, got #{inspect(result)}"

    Enum.each(result, fn item ->
      assert is_struct(item, DotDo.CapnWeb.Promise) or is_struct(item, DotDo.CapnWeb.Stub),
             "Expected capability in array, got #{inspect(item)}"
    end)
  end

  defp assert_type_matches(_result, _type), do: :ok

  defp check_length_expectation(result, test_config) do
    if expected_length = Map.get(test_config, "expect_length") do
      assert length(result) == expected_length,
             "Expected length #{expected_length}, got #{length(result)}"
    end
  end

  defp run_verifications(result, verifications) do
    Enum.each(verifications, fn verification ->
      # Execute the verification call on the result
      call = verification["call"]
      [_, method] = String.split(call, ".")

      verification_promise = DotDo.CapnWeb.call(result, String.to_atom(method), [])
      verification_result = DotDo.CapnWeb.await!(verification_promise)

      if expect = Map.get(verification, "expect") do
        assert_value_matches(verification_result, expect)
      end
    end)
  end

  defp check_error_expectation(error, expected) do
    if code = Map.get(expected, "code") do
      assert error.code == code,
             "Expected error code #{code}, got #{error.code}"
    end

    if message = Map.get(expected, "message") do
      assert String.contains?(error.message, message),
             "Expected error message containing '#{message}', got '#{error.message}'"
    end

    if type = Map.get(expected, "type") do
      assert to_string(error.type) == type,
             "Expected error type #{type}, got #{error.type}"
    end
  end

  defp skip_not_implemented(feature) do
    raise ExUnit.AssertionError, message: "SDK not implemented: #{feature}"
  end
end

# =============================================================================
# Additional SDK Unit Tests (run without server)
# =============================================================================

defmodule DotDo.CapnWeb.SDKTest do
  @moduledoc """
  Unit tests for SDK components that don't require a server connection.
  """

  use ExUnit.Case, async: true

  describe "DotDo.CapnWeb.Stub" do
    test "new/1 creates a stub with empty path" do
      stub = DotDo.CapnWeb.Stub.new(self())
      assert stub.session == self()
      assert stub.path == []
    end

    test "property/2 extends the path" do
      stub = DotDo.CapnWeb.Stub.new(self())
      |> DotDo.CapnWeb.Stub.property(:users)
      |> DotDo.CapnWeb.Stub.property(:get)

      assert stub.path == [:users, :get]
    end

    test "call/3 returns a Promise" do
      stub = DotDo.CapnWeb.Stub.new(self())
      promise = DotDo.CapnWeb.Stub.call(stub, :get, [123])

      assert %DotDo.CapnWeb.Promise{} = promise
      assert promise.path == [:get]
      assert promise.args == [123]
    end
  end

  describe "DotDo.CapnWeb.Promise" do
    test "new/3 creates a promise" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:users, :get], [123])

      assert promise.session == self()
      assert promise.path == [:users, :get]
      assert promise.args == [123]
    end

    test "property/2 chains operations" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:users, :get], [123])
      |> DotDo.CapnWeb.Promise.property(:profile)
      |> DotDo.CapnWeb.Promise.property(:name)

      assert promise.operations == [
               {:property, :profile},
               {:property, :name}
             ]
    end

    test "call/3 chains method calls" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:counter], [])
      |> DotDo.CapnWeb.Promise.call(:increment, [5])

      assert promise.operations == [{:call, :increment, [5]}]
    end

    test "map/2 stores the mapper function" do
      mapper = fn x -> x * 2 end
      promise = DotDo.CapnWeb.Promise.new(self(), [:fib], [10])
      |> DotDo.CapnWeb.Promise.map(mapper)

      assert promise.map_fn == mapper
    end

    test "rescue/2 stores the error handler" do
      handler = fn _e -> :default end
      promise = DotDo.CapnWeb.Promise.new(self(), [:users, :get], [999])
      |> DotDo.CapnWeb.Promise.rescue(handler)

      assert promise.rescue_fn == handler
    end
  end

  describe "DotDo.CapnWeb.Error" do
    test "connection_error/1 creates a connection error" do
      error = DotDo.CapnWeb.Error.connection_error(:timeout)

      assert error.type == :connection_error
      assert error.message =~ "timeout"
    end

    test "not_implemented/1 creates a not implemented error" do
      error = DotDo.CapnWeb.Error.not_implemented("websocket")

      assert error.type == :not_implemented
      assert error.message =~ "websocket"
    end

    test "from_rpc_error/1 parses RPC error maps" do
      error = DotDo.CapnWeb.Error.from_rpc_error(%{
        "type" => "not_found",
        "message" => "User not found",
        "code" => "ERR_NOT_FOUND"
      })

      assert error.type == :not_found
      assert error.message == "User not found"
      assert error.code == "ERR_NOT_FOUND"
    end

    test "implements Exception protocol" do
      error = DotDo.CapnWeb.Error.connection_error(:refused)
      message = Exception.message(error)

      assert message =~ "connection_error"
      assert message =~ "refused"
    end
  end

  describe "DotDo.CapnWeb pipe operations" do
    test "prop/2 works with stub" do
      stub = DotDo.CapnWeb.Stub.new(self())
      result = DotDo.CapnWeb.prop(stub, :users)

      assert result.path == [:users]
    end

    test "prop/2 works with promise" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:users, :get], [123])
      result = DotDo.CapnWeb.prop(promise, :profile)

      assert {:property, :profile} in result.operations
    end

    test "call/3 works with stub" do
      stub = DotDo.CapnWeb.Stub.new(self())
      result = DotDo.CapnWeb.call(stub, :get, [123])

      assert %DotDo.CapnWeb.Promise{} = result
      assert result.path == [:get]
    end

    test "call/3 works with promise" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:counter], [])
      result = DotDo.CapnWeb.call(promise, :increment, [5])

      assert {:call, :increment, [5]} in result.operations
    end

    test "map/2 works with promise" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:fib], [10])
      mapper = fn x -> x * 2 end
      result = DotDo.CapnWeb.map(promise, mapper)

      assert result.map_fn == mapper
    end

    test "rescue/2 works with promise" do
      promise = DotDo.CapnWeb.Promise.new(self(), [:users, :get], [999])
      handler = fn _e -> :default end
      result = DotDo.CapnWeb.rescue(promise, handler)

      assert result.rescue_fn == handler
    end
  end
end

# =============================================================================
# Map Expression Parser Tests
# =============================================================================

defmodule DotDo.CapnWeb.MapExpressionTest do
  @moduledoc """
  Tests for the map expression parser used in conformance tests.
  """

  use ExUnit.Case, async: true

  alias DotDo.CapnWeb.ConformanceTest

  describe "build_mapper_function/2" do
    test "parses x => self.method(x) pattern" do
      api = DotDo.CapnWeb.Stub.new(self())
      context = %{self: api}

      mapper = ConformanceTest.build_mapper_function("x => self.square(x)", context)
      assert is_function(mapper, 1)

      # The mapper should return a promise when called
      result = mapper.(5)
      assert %DotDo.CapnWeb.Promise{} = result
    end

    test "parses x => self.method(x * N) pattern" do
      api = DotDo.CapnWeb.Stub.new(self())
      context = %{self: api}

      mapper = ConformanceTest.build_mapper_function("x => self.returnNumber(x * 2)", context)
      assert is_function(mapper, 1)
    end

    test "parses counter => counter.value pattern" do
      context = %{self: nil}

      mapper = ConformanceTest.build_mapper_function("counter => counter.value", context)
      assert is_function(mapper, 1)
    end

    test "parses c => c.method(arg) pattern" do
      context = %{self: nil}

      mapper = ConformanceTest.build_mapper_function("c => c.increment(10)", context)
      assert is_function(mapper, 1)
    end
  end
end
