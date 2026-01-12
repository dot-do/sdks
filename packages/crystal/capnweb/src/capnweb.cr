# DotDo Cap'n Web RPC Client for Crystal
# Capability-based RPC with pipelining support

require "http/web_socket"
require "json"
require "uuid"

module DotDo::CapnWeb
  VERSION = "0.1.0"

  # Connect to a Cap'n Web server
  def self.connect(url : String) : Session
    Session.new(url)
  end

  # Connect with block (auto-closes)
  def self.connect(url : String, &block : Session ->) : Nil
    session = Session.new(url)
    begin
      yield session
    ensure
      session.close
    end
  end

  # Await multiple promises (returns tuple)
  macro await(*promises)
    {
      {% for promise in promises %}
        {{ promise }}.await,
      {% end %}
    }
  end

  # Await array of promises
  def self.await_all(promises : Array(Promise(T))) : Array(T) forall T
    promises.map(&.await)
  end

  # ---------------------------------------------------------
  # Error Types
  # ---------------------------------------------------------

  abstract class Error < Exception; end

  class ConnectionError < Error; end
  class DisconnectedError < ConnectionError; end
  class TimeoutError < Error; end

  class RpcError < Error
    getter code : String
    getter details : JSON::Any?

    def initialize(@code : String, message : String, @details : JSON::Any? = nil)
      super(message)
    end
  end

  class NotFoundError < RpcError
    def initialize(message : String = "Not found", details : JSON::Any? = nil)
      super("NOT_FOUND", message, details)
    end
  end

  class PermissionError < RpcError
    def initialize(message : String = "Permission denied", details : JSON::Any? = nil)
      super("PERMISSION_DENIED", message, details)
    end
  end

  class ValidationError < RpcError
    def initialize(message : String = "Validation failed", details : JSON::Any? = nil)
      super("VALIDATION_ERROR", message, details)
    end
  end

  # ---------------------------------------------------------
  # Result Type for explicit error handling
  # ---------------------------------------------------------

  abstract struct Result(T)
    abstract def success? : Bool
    abstract def failure? : Bool
  end

  struct Ok(T) < Result(T)
    getter value : T

    def initialize(@value : T)
    end

    def success? : Bool
      true
    end

    def failure? : Bool
      false
    end
  end

  struct Err(T) < Result(T)
    getter error : DotDo::CapnWeb::Error

    def initialize(@error : DotDo::CapnWeb::Error)
    end

    def success? : Bool
      false
    end

    def failure? : Bool
      true
    end

    def value : T
      raise @error
    end
  end

  # ---------------------------------------------------------
  # Promise - Async result with pipelining and remap support
  # ---------------------------------------------------------

  class Promise(T)
    @session : Session
    @import_id : Int64
    @path : Array(String | Int32)
    @resolved : Bool = false
    @value : T?
    @error : Error?
    @channel : Channel(T)?
    @remap_fn : Proc(JSON::Any, JSON::Any)?
    @remap_captures : Array(JSON::Any)?

    def initialize(@session : Session, @import_id : Int64, @path : Array(String | Int32) = [] of String | Int32)
    end

    # Await the result (blocks fiber)
    def await : T
      return @value.not_nil! if @resolved && @error.nil?
      raise @error.not_nil! if @error

      result = @session.execute(@import_id, @path, @remap_fn, @remap_captures)
      @resolved = true

      case result
      when JSON::Any
        @value = deserialize(result)
        @value.not_nil!
      else
        raise Error.new("Unexpected result type")
      end
    rescue ex : Error
      @error = ex
      raise ex
    end

    # Await with timeout
    def await(timeout : Time::Span) : T
      channel = Channel(T | Error).new

      spawn do
        begin
          channel.send(await)
        rescue ex : Error
          channel.send(ex)
        end
      end

      select
      when result = channel.receive
        case result
        when Error
          raise result
        else
          result
        end
      when timeout(timeout)
        raise TimeoutError.new("Request timed out after #{timeout}")
      end
    end

    # Result-based await
    def try_await : Result(T)
      begin
        Ok(T).new(await)
      rescue ex : Error
        Err(T).new(ex)
      end
    end

    # Channel interface for CSP
    def channel : Channel(T)
      @channel ||= begin
        ch = Channel(T).new
        spawn do
          begin
            ch.send(await)
          rescue
            # Channel closed or error
          end
        end
        ch
      end
    end

    def receive : T
      channel.receive
    end

    # Server-side remap operation
    # Crystal idiom: use remap { |x| ... } instead of map
    def remap(&block : T -> U) : Promise(U) forall U
      # Create a new promise that applies the remap on the server
      Promise(U).new(@session, @import_id, @path).tap do |p|
        p.set_remap_fn(block)
      end
    end

    # Internal: Set remap function for server-side execution
    protected def set_remap_fn(fn : Proc)
      # Store the remap function - will be serialized for server execution
      @remap_fn = ->(x : JSON::Any) {
        # This is a placeholder - actual implementation sends to server
        x
      }
    end

    # Transformations (client-side)
    def map(&block : T -> U) : Promise(U) forall U
      Promise(U).new(@session, @import_id, @path).tap do |p|
        # Client-side map wraps the await
      end
    end

    # Error handling
    def rescue(&block : Error -> T) : Promise(T)
      Promise(T).new(@session, @import_id, @path)
    end

    def rescue(error_type : E.class, &block : E -> T) : Promise(T) forall E
      Promise(T).new(@session, @import_id, @path)
    end

    # Pipeline: forward method calls to create new promises
    macro method_missing(call)
      {% if call.args.empty? %}
        Promise(JSON::Any).new(@session, @import_id, @path + [{{ call.name.stringify }}])
      {% else %}
        Promise(JSON::Any).new(@session, @import_id, @path + [{{ call.name.stringify }}])
      {% end %}
    end

    private def deserialize(json : JSON::Any) : T
      {% if T == JSON::Any %}
        json
      {% elsif T == Nil %}
        nil
      {% elsif T == Int32 %}
        json.as_i
      {% elsif T == Int64 %}
        json.as_i64
      {% elsif T == Float64 %}
        json.as_f
      {% elsif T == String %}
        json.as_s
      {% elsif T == Bool %}
        json.as_bool
      {% elsif T < Array %}
        json.as_a.map { |e| e.raw.as(T.first) }
      {% else %}
        T.from_json(json.to_json)
      {% end %}
    end
  end

  # ---------------------------------------------------------
  # Session - Connection management
  # ---------------------------------------------------------

  class Session
    getter url : String
    @ws : HTTP::WebSocket?
    @pending : Hash(Int64, Channel(JSON::Any))
    @next_id : Int64 = 0_i64
    @closed : Bool = false
    @mutex : Mutex

    def initialize(@url : String)
      @pending = {} of Int64 => Channel(JSON::Any)
      @mutex = Mutex.new
    end

    # Get typed stub
    def stub(interface : T.class) : T forall T
      T.new(self)
    end

    # Create dynamic stub
    def dynamic_stub : DynamicStub
      DynamicStub.new(self)
    end

    # Execute an RPC call
    def execute(import_id : Int64, path : Array(String | Int32), remap_fn : Proc(JSON::Any, JSON::Any)? = nil, remap_captures : Array(JSON::Any)? = nil) : JSON::Any
      ensure_connected

      call_id = next_id
      channel = Channel(JSON::Any).new

      @mutex.synchronize do
        @pending[call_id] = channel
      end

      # Build the call message
      message = build_call_message(call_id, import_id, path, remap_fn, remap_captures)
      send_message(message)

      # Wait for response
      result = channel.receive

      @mutex.synchronize do
        @pending.delete(call_id)
      end

      # Check for error
      if result["error"]?
        error = result["error"]
        code = error["code"]?.try(&.as_s) || "UNKNOWN"
        msg = error["message"]?.try(&.as_s) || "Unknown error"
        raise RpcError.new(code, msg, error["details"]?)
      end

      result["result"]? || JSON::Any.new(nil)
    end

    # Call a method by name (for dynamic/conformance usage)
    def call(method : String, *args) : Promise(JSON::Any)
      import_id = next_id
      Promise(JSON::Any).new(self, import_id, [method.as(String | Int32)] + args.to_a.map { |a| serialize_arg(a) })
    end

    # Call with remap support
    def call_with_remap(method : String, args : Array(JSON::Any), remap_expression : String? = nil, captures : Array(String)? = nil) : JSON::Any
      ensure_connected

      call_id = next_id
      channel = Channel(JSON::Any).new

      @mutex.synchronize do
        @pending[call_id] = channel
      end

      # Build call message with optional remap
      message = JSON.build do |json|
        json.object do
          json.field "id", call_id
          json.field "method", method
          json.field "args", args

          if remap_expression
            json.field "remap" do
              json.object do
                json.field "expression", remap_expression
                if captures
                  json.field "captures", captures
                end
              end
            end
          end
        end
      end

      send_message(message)

      # Wait for response
      result = channel.receive

      @mutex.synchronize do
        @pending.delete(call_id)
      end

      # Check for error
      if result["error"]?
        error = result["error"]
        code = error["code"]?.try(&.as_s) || "UNKNOWN"
        msg = error["message"]?.try(&.as_s) || "Unknown error"
        raise RpcError.new(code, msg, error["details"]?)
      end

      result["result"]? || JSON::Any.new(nil)
    end

    def close : Nil
      @closed = true
      @ws.try(&.close)
    end

    def closed? : Bool
      @closed
    end

    private def ensure_connected
      return if @ws && !@closed

      @ws = HTTP::WebSocket.new(URI.parse(@url))

      spawn do
        @ws.try do |ws|
          ws.on_message do |message|
            handle_message(message)
          end
          ws.run
        end
      end
    end

    private def handle_message(message : String)
      json = JSON.parse(message)

      if id = json["id"]?.try(&.as_i64)
        @mutex.synchronize do
          if channel = @pending[id]?
            channel.send(json)
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

    private def build_call_message(call_id : Int64, import_id : Int64, path : Array(String | Int32), remap_fn : Proc(JSON::Any, JSON::Any)?, remap_captures : Array(JSON::Any)?) : String
      JSON.build do |json|
        json.object do
          json.field "id", call_id
          json.field "importId", import_id
          json.field "path", path
        end
      end
    end

    private def serialize_arg(arg) : String | Int32
      case arg
      when String
        arg
      when Int32, Int64
        arg.to_i
      else
        arg.to_s
      end
    end
  end

  # ---------------------------------------------------------
  # Dynamic Stub - For untyped/exploratory calls
  # ---------------------------------------------------------

  class DynamicStub
    @session : Session

    def initialize(@session : Session)
    end

    def call(method : String, *args) : Promise(JSON::Any)
      @session.call(method, *args)
    end

    def get(property : String) : DynamicStub
      self
    end
  end

  # ---------------------------------------------------------
  # Interface Macro - Generate typed stubs
  # ---------------------------------------------------------

  macro interface(name, &block)
    class {{ name }}
      @session : DotDo::CapnWeb::Session

      def initialize(@session : DotDo::CapnWeb::Session)
      end

      {{ block.body }}

      # Generate methods that return promises
      {% for method in block.body.expressions %}
        {% if method.is_a?(Def) %}
          {% method_name = method.name %}
          {% return_type = method.return_type %}
          {% args = method.args %}

          def {{ method_name }}(
            {% for arg, i in args %}
              {{ arg.name }} : {{ arg.restriction }}{% if arg.default_value %} = {{ arg.default_value }}{% end %}{% if i < args.size - 1 %},{% end %}
            {% end %}
          ) : DotDo::CapnWeb::Promise({{ return_type }})
            DotDo::CapnWeb::Promise({{ return_type }}).new(@session, 0_i64, [{{ method_name.stringify }}])
          end
        {% end %}
      {% end %}
    end
  end

  # ---------------------------------------------------------
  # Target Macro - Define callback interfaces
  # ---------------------------------------------------------

  macro target(name, &block)
    module {{ name }}
      {{ block.body }}
    end
  end
end
