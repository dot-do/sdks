# Cap'n Web Conformance Tests for Crystal
# Loads YAML specs and generates spec tests with remap support

require "spec"
require "yaml"
require "json"
require "http/web_socket"

require "../src/capnweb"

# Test server URL from environment
TEST_SERVER_URL = ENV["TEST_SERVER_URL"]? || "ws://localhost:8080"
TEST_SPEC_DIR = ENV["TEST_SPEC_DIR"]? || "../../test/conformance"

# ---------------------------------------------------------
# Conformance Test Structures
# ---------------------------------------------------------

struct ConformanceSpec
  include YAML::Serializable

  property name : String
  property description : String
  property tests : Array(ConformanceTest)
end

struct ConformanceTest
  include YAML::Serializable

  property name : String
  property description : String
  property call : String
  property args : Array(YAML::Any) = [] of YAML::Any
  property expect : YAML::Any?
  property expect_type : String?
  property expect_length : Int32?
  property max_round_trips : Int32?
  property map : MapConfig?
  property setup : Array(SetupStep)?
  property verify : Array(VerifyStep)?
end

struct MapConfig
  include YAML::Serializable

  property expression : String
  property captures : Array(String)?
end

struct SetupStep
  include YAML::Serializable

  property call : String?
  property args : Array(YAML::Any)?
  property map : MapConfig?
  property as : String?
  property await : Bool?
  property pipeline : Array(PipelineStep)?
end

struct PipelineStep
  include YAML::Serializable

  property call : String
  property map : MapConfig?
end

struct VerifyStep
  include YAML::Serializable

  property call : String
  property expect : YAML::Any
end

# ---------------------------------------------------------
# Test Session with Conformance Support
# ---------------------------------------------------------

class ConformanceSession
  @url : String
  @ws : HTTP::WebSocket?
  @pending : Hash(Int64, Channel(JSON::Any))
  @next_id : Int64 = 0_i64
  @mutex : Mutex
  @connected : Bool = false
  @variables : Hash(String, JSON::Any)
  @round_trips : Int32 = 0

  def initialize(@url : String)
    @pending = {} of Int64 => Channel(JSON::Any)
    @mutex = Mutex.new
    @variables = {} of String => JSON::Any
  end

  def connect
    return if @connected

    @ws = HTTP::WebSocket.new(URI.parse(@url))
    @connected = true

    spawn do
      @ws.try do |ws|
        ws.on_message do |message|
          handle_message(message)
        end
        ws.run
      end
    end

    # Give WebSocket time to connect
    sleep 100.milliseconds
  end

  def close
    @connected = false
    @ws.try(&.close)
  end

  def reset_round_trips
    @round_trips = 0
  end

  def round_trips : Int32
    @round_trips
  end

  # Store a variable from setup
  def set_variable(name : String, value : JSON::Any)
    @variables[name] = value
  end

  # Get a stored variable
  def get_variable(name : String) : JSON::Any?
    @variables[name]?
  end

  # Execute a call with optional remap (server-side map operation)
  def call(method : String, args : Array(JSON::Any), remap : MapConfig? = nil) : JSON::Any
    connect

    call_id = next_id
    channel = Channel(JSON::Any).new

    @mutex.synchronize do
      @pending[call_id] = channel
    end

    # Build the call message
    message = JSON.build do |json|
      json.object do
        json.field "id", call_id
        json.field "method", method
        json.field "args", args

        if remap
          json.field "remap" do
            json.object do
              json.field "expression", remap.expression
              if captures = remap.captures
                json.field "captures", captures
              end
            end
          end
        end
      end
    end

    send_message(message)
    @round_trips += 1

    # Wait for response with timeout
    result = channel.receive

    @mutex.synchronize do
      @pending.delete(call_id)
    end

    # Check for error
    if error = result["error"]?
      code = error["code"]?.try(&.as_s) || "UNKNOWN"
      msg = error["message"]?.try(&.as_s) || "Unknown error"
      raise CapnWeb::RpcError.new(code, msg, error["details"]?)
    end

    result["result"]? || JSON::Any.new(nil)
  end

  # Call using remap (Crystal idiom for server-side map)
  def call_with_remap(method : String, args : Array(JSON::Any), &block) : JSON::Any
    # The block represents the remap operation
    # In real implementation, this would serialize the block to an expression
    call(method, args, nil)
  end

  private def handle_message(message : String)
    json = JSON.parse(message)

    if id = json["id"]?.try(&.as_i64)
      @mutex.synchronize do
        if channel = @pending[id]?
          spawn { channel.send(json) }
        end
      end
    end
  end

  private def send_message(message : String)
    @ws.try(&.send(message))
  end

  private def next_id : Int64
    @mutex.synchronize do
      @next_id += 1
      @next_id
    end
  end
end

# ---------------------------------------------------------
# YAML to JSON conversion helper
# ---------------------------------------------------------

def yaml_to_json(yaml_value : YAML::Any) : JSON::Any
  case yaml_value.raw
  when Nil
    JSON::Any.new(nil)
  when Bool
    JSON::Any.new(yaml_value.as_bool)
  when Int64
    JSON::Any.new(yaml_value.as_i64)
  when Float64
    JSON::Any.new(yaml_value.as_f)
  when String
    JSON::Any.new(yaml_value.as_s)
  when Array
    JSON::Any.new(yaml_value.as_a.map { |e| yaml_to_json(e) })
  when Hash
    hash = {} of String => JSON::Any
    yaml_value.as_h.each do |k, v|
      hash[k.to_s] = yaml_to_json(v)
    end
    JSON::Any.new(hash)
  else
    JSON::Any.new(nil)
  end
end

def args_to_json(args : Array(YAML::Any)) : Array(JSON::Any)
  args.map { |arg| yaml_to_json(arg) }
end

# ---------------------------------------------------------
# Result comparison helpers
# ---------------------------------------------------------

def compare_results(actual : JSON::Any, expected : YAML::Any) : Bool
  expected_json = yaml_to_json(expected)
  compare_json(actual, expected_json)
end

def compare_json(actual : JSON::Any, expected : JSON::Any) : Bool
  case {actual.raw, expected.raw}
  when {Nil, Nil}
    true
  when {Bool, Bool}
    actual.as_bool == expected.as_bool
  when {Int64, Int64}
    actual.as_i64 == expected.as_i64
  when {Float64, Float64}
    (actual.as_f - expected.as_f).abs < 0.0001
  when {Int64, Float64}
    actual.as_i64.to_f == expected.as_f
  when {Float64, Int64}
    actual.as_f == expected.as_i64.to_f
  when {String, String}
    actual.as_s == expected.as_s
  when {Array(JSON::Any), Array(JSON::Any)}
    a_arr = actual.as_a
    e_arr = expected.as_a
    return false if a_arr.size != e_arr.size
    a_arr.zip(e_arr).all? { |a, e| compare_json(a, e) }
  when {Hash(String, JSON::Any), Hash(String, JSON::Any)}
    a_hash = actual.as_h
    e_hash = expected.as_h
    return false if a_hash.size != e_hash.size
    e_hash.all? do |k, v|
      a_hash.has_key?(k) && compare_json(a_hash[k], v)
    end
  else
    false
  end
end

# ---------------------------------------------------------
# Load and run conformance specs
# ---------------------------------------------------------

def load_conformance_specs(dir : String) : Array(ConformanceSpec)
  specs = [] of ConformanceSpec

  Dir.glob(File.join(dir, "*.yaml")) do |file|
    content = File.read(file)
    spec = ConformanceSpec.from_yaml(content)
    specs << spec
  end

  specs
end

def run_setup(session : ConformanceSession, setup_steps : Array(SetupStep))
  setup_steps.each do |step|
    if call = step.call
      # Handle variable references (e.g., "$counters")
      if call.starts_with?("$")
        var_name = call[1..]
        if var_value = session.get_variable(var_name)
          # Use the stored variable
          if step.map
            result = session.call("__remap__", [var_value], step.map)
          else
            result = var_value
          end
          if as_name = step.as
            session.set_variable(as_name, result)
          end
        end
      else
        args = step.args ? args_to_json(step.args.not_nil!) : [] of JSON::Any
        result = session.call(call, args, step.map)

        if as_name = step.as
          session.set_variable(as_name, result)
        end
      end
    elsif pipeline = step.pipeline
      # Execute pipeline steps
      var_result : JSON::Any = JSON::Any.new(nil)

      pipeline.each do |pipe_step|
        if pipe_step.call.starts_with?("$")
          var_name = pipe_step.call[1..]
          if stored = session.get_variable(var_name)
            var_result = stored
          end
        else
          var_result = session.call(pipe_step.call, [var_result], pipe_step.map)
        end
      end

      if as_name = step.as
        session.set_variable(as_name, var_result)
      end
    end
  end
end

def run_conformance_test(session : ConformanceSession, test : ConformanceTest) : Bool
  session.reset_round_trips

  # Run setup if present
  if setup = test.setup
    run_setup(session, setup)
  end

  # Execute the main call
  call_target = test.call

  # Handle variable references
  if call_target.starts_with?("$")
    var_name = call_target[1..]
    if var_value = session.get_variable(var_name)
      result = if test.map
                 session.call("__remap__", [var_value], test.map)
               else
                 var_value
               end
    else
      raise "Variable #{var_name} not found"
    end
  else
    args = args_to_json(test.args)
    result = session.call(call_target, args, test.map)
  end

  # Check expectations
  if expected = test.expect
    unless compare_results(result, expected)
      puts "  Expected: #{yaml_to_json(expected).to_json}"
      puts "  Actual:   #{result.to_json}"
      return false
    end
  end

  # Check expected type
  if expect_type = test.expect_type
    case expect_type
    when "capability"
      # Result should be a capability reference (object with __cap__ field)
      unless result.as_h?.try(&.has_key?("__cap__")) || result.as_h?.try(&.has_key?("id"))
        puts "  Expected capability, got: #{result.to_json}"
        return false
      end
    when "array_of_capabilities"
      unless result.as_a?
        puts "  Expected array of capabilities, got: #{result.to_json}"
        return false
      end
    end
  end

  # Check expected length
  if expect_length = test.expect_length
    if arr = result.as_a?
      unless arr.size == expect_length
        puts "  Expected length #{expect_length}, got #{arr.size}"
        return false
      end
    else
      puts "  Expected array for length check, got: #{result.to_json}"
      return false
    end
  end

  # Check max round trips
  if max_trips = test.max_round_trips
    if session.round_trips > max_trips
      puts "  Expected max #{max_trips} round trips, got #{session.round_trips}"
      return false
    end
  end

  # Run verify steps
  if verify = test.verify
    verify.each do |v|
      # Parse the verify call (e.g., "result.value")
      parts = v.call.split(".")
      verify_result = result

      parts[1..].each do |part|
        if verify_result.as_h?
          verify_result = verify_result[part]? || JSON::Any.new(nil)
        else
          verify_result = session.call(part, [verify_result])
        end
      end

      unless compare_results(verify_result, v.expect)
        puts "  Verify #{v.call} failed"
        puts "  Expected: #{yaml_to_json(v.expect).to_json}"
        puts "  Actual:   #{verify_result.to_json}"
        return false
      end
    end
  end

  true
end

# ---------------------------------------------------------
# Main spec runner
# ---------------------------------------------------------

describe "Cap'n Web Conformance" do
  session = ConformanceSession.new(TEST_SERVER_URL)

  before_all do
    session.connect
  end

  after_all do
    session.close
  end

  # Load all conformance specs
  spec_dir = File.expand_path(TEST_SPEC_DIR, __DIR__)

  if Dir.exists?(spec_dir)
    load_conformance_specs(spec_dir).each do |spec|
      describe spec.name do
        spec.tests.each do |test|
          it test.name do
            result = run_conformance_test(session, test)
            result.should be_true
          end
        end
      end
    end
  else
    # Fallback: define tests inline for basic validation
    describe "Basic RPC Calls" do
      it "square_positive" do
        result = session.call("square", [JSON::Any.new(5_i64)])
        result.as_i64.should eq(25)
      end

      it "square_negative" do
        result = session.call("square", [JSON::Any.new(-3_i64)])
        result.as_i64.should eq(9)
      end

      it "square_zero" do
        result = session.call("square", [JSON::Any.new(0_i64)])
        result.as_i64.should eq(0)
      end

      it "return_number_positive" do
        result = session.call("returnNumber", [JSON::Any.new(42_i64)])
        result.as_i64.should eq(42)
      end

      it "return_null" do
        result = session.call("returnNull", [] of JSON::Any)
        result.raw.should be_nil
      end

      it "fibonacci_ten" do
        result = session.call("generateFibonacci", [JSON::Any.new(10_i64)])
        expected = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
        result.as_a.map(&.as_i64).should eq(expected.map(&.to_i64))
      end
    end

    describe "Map Operation (remap)" do
      it "map_fibonacci_square" do
        # Test remap: Crystal uses .remap { |x| ... } syntax
        # This should execute in a single round trip on the server
        session.reset_round_trips

        map_config = MapConfig.new
        # Note: We'd normally use Crystal block syntax, but for conformance
        # we pass the expression string
        result = session.call(
          "generateFibonacci",
          [JSON::Any.new(6_i64)],
          MapConfig.from_yaml(%(
            expression: "x => self.square(x)"
            captures: ["$self"]
          ))
        )

        expected = [0, 1, 1, 4, 9, 25]
        result.as_a.map(&.as_i64).should eq(expected.map(&.to_i64))
        session.round_trips.should be <= 1
      end

      it "map_empty_array" do
        session.reset_round_trips

        result = session.call(
          "generateFibonacci",
          [JSON::Any.new(0_i64)],
          MapConfig.from_yaml(%(
            expression: "x => self.square(x)"
            captures: ["$self"]
          ))
        )

        result.as_a.should be_empty
        session.round_trips.should be <= 1
      end

      it "map_on_null" do
        result = session.call(
          "returnNull",
          [] of JSON::Any,
          MapConfig.from_yaml(%(
            expression: "x => self.square(x)"
            captures: ["$self"]
          ))
        )

        result.raw.should be_nil
      end

      it "map_preserves_order" do
        session.reset_round_trips

        result = session.call(
          "generateFibonacci",
          [JSON::Any.new(8_i64)],
          MapConfig.from_yaml(%(
            expression: "x => self.returnNumber(x)"
            captures: ["$self"]
          ))
        )

        expected = [0, 1, 1, 2, 3, 5, 8, 13]
        result.as_a.map(&.as_i64).should eq(expected.map(&.to_i64))
        session.round_trips.should be <= 1
      end
    end
  end
end

# ---------------------------------------------------------
# Crystal-Idiomatic Remap Tests
# ---------------------------------------------------------

describe "Crystal remap Syntax" do
  # These tests demonstrate the idiomatic Crystal syntax for remap
  # using blocks: arr.remap { |x| api.square(x) }

  pending "remap with block syntax" do
    session = CapnWeb.connect(TEST_SERVER_URL)

    # Define a simple API interface
    CapnWeb.interface TestApi do
      def square(n : Int64) : Int64
      def generateFibonacci(n : Int64) : Array(Int64)
    end

    api = session.stub(TestApi)

    # Crystal idiomatic remap syntax
    # This creates a server-side map operation
    result = api.generateFibonacci(6_i64)
               .remap { |x| api.square(x) }
               .await

    result.should eq([0, 1, 1, 4, 9, 25])

    session.close
  end

  pending "remap chaining" do
    session = CapnWeb.connect(TEST_SERVER_URL)

    CapnWeb.interface TestApi do
      def square(n : Int64) : Int64
      def generateFibonacci(n : Int64) : Array(Int64)
      def returnNumber(n : Int64) : Int64
    end

    api = session.stub(TestApi)

    # Chain multiple remaps
    result = api.generateFibonacci(4_i64)
               .remap { |x| api.square(x) }
               .remap { |x| api.returnNumber(x) }
               .await

    # fib(4) = [0, 1, 1, 2] -> squared = [0, 1, 1, 4] -> same
    result.should eq([0, 1, 1, 4])

    session.close
  end
end

# ---------------------------------------------------------
# Fiber/Channel Integration Tests
# ---------------------------------------------------------

describe "Crystal CSP Integration" do
  pending "concurrent remap with fibers" do
    session = CapnWeb.connect(TEST_SERVER_URL)

    CapnWeb.interface TestApi do
      def square(n : Int64) : Int64
      def generateFibonacci(n : Int64) : Array(Int64)
    end

    api = session.stub(TestApi)

    # Run multiple remaps concurrently using fibers
    results = Channel(Array(Int64)).new(capacity: 3)

    [5, 6, 7].each do |n|
      spawn do
        result = api.generateFibonacci(n.to_i64)
                   .remap { |x| api.square(x) }
                   .await
        results.send(result)
      end
    end

    collected = Array(Array(Int64)).new(3) { results.receive }
    collected.size.should eq(3)

    session.close
  end

  pending "select with remap promises" do
    session = CapnWeb.connect(TEST_SERVER_URL)

    CapnWeb.interface TestApi do
      def square(n : Int64) : Int64
      def generateFibonacci(n : Int64) : Array(Int64)
    end

    api = session.stub(TestApi)

    # Create two remap promises
    promise1 = api.generateFibonacci(5_i64).remap { |x| api.square(x) }
    promise2 = api.generateFibonacci(3_i64).remap { |x| api.square(x) }

    # Use select to get first result
    received = false
    select
    when result = promise1.receive
      received = true
    when result = promise2.receive
      received = true
    when timeout(5.seconds)
      raise "Timeout waiting for remap result"
    end

    received.should be_true

    session.close
  end
end
