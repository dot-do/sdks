# DotDo Platform SDK for Crystal
# Authentication, connection pooling, and retry logic using Crystal fibers

require "http/web_socket"
require "json"
require "uri"

module DotDo
  VERSION = "0.1.0"

  # Default configuration
  DEFAULT_POOL_SIZE     =   10
  DEFAULT_TIMEOUT       = 30.seconds
  DEFAULT_MAX_RETRIES   =    3
  DEFAULT_RETRY_DELAY   =  1.seconds
  DEFAULT_RETRY_BACKOFF =  2.0

  # ---------------------------------------------------------
  # Configuration
  # ---------------------------------------------------------

  class Config
    property api_key : String?
    property api_secret : String?
    property endpoint : String
    property pool_size : Int32
    property timeout : Time::Span
    property max_retries : Int32
    property retry_delay : Time::Span
    property retry_backoff : Float64

    def initialize(
      @endpoint : String = "wss://api.dotdo.io",
      @api_key : String? = nil,
      @api_secret : String? = nil,
      @pool_size : Int32 = DEFAULT_POOL_SIZE,
      @timeout : Time::Span = DEFAULT_TIMEOUT,
      @max_retries : Int32 = DEFAULT_MAX_RETRIES,
      @retry_delay : Time::Span = DEFAULT_RETRY_DELAY,
      @retry_backoff : Float64 = DEFAULT_RETRY_BACKOFF
    )
    end

    # Load configuration from environment
    def self.from_env : Config
      Config.new(
        endpoint: ENV["DOTDO_ENDPOINT"]? || "wss://api.dotdo.io",
        api_key: ENV["DOTDO_API_KEY"]?,
        api_secret: ENV["DOTDO_API_SECRET"]?,
        pool_size: (ENV["DOTDO_POOL_SIZE"]? || DEFAULT_POOL_SIZE.to_s).to_i,
        timeout: (ENV["DOTDO_TIMEOUT"]? || DEFAULT_TIMEOUT.total_seconds.to_s).to_f.seconds,
        max_retries: (ENV["DOTDO_MAX_RETRIES"]? || DEFAULT_MAX_RETRIES.to_s).to_i,
        retry_delay: (ENV["DOTDO_RETRY_DELAY"]? || DEFAULT_RETRY_DELAY.total_seconds.to_s).to_f.seconds,
        retry_backoff: (ENV["DOTDO_RETRY_BACKOFF"]? || DEFAULT_RETRY_BACKOFF.to_s).to_f
      )
    end
  end

  # ---------------------------------------------------------
  # Authentication
  # ---------------------------------------------------------

  module Auth
    # Authentication token with expiration
    struct Token
      getter access_token : String
      getter token_type : String
      getter expires_at : Time
      getter refresh_token : String?

      def initialize(
        @access_token : String,
        @token_type : String = "Bearer",
        @expires_at : Time = Time.utc + 1.hour,
        @refresh_token : String? = nil
      )
      end

      def expired? : Bool
        Time.utc >= @expires_at
      end

      def expires_soon?(within : Time::Span = 5.minutes) : Bool
        Time.utc >= (@expires_at - within)
      end

      def authorization_header : String
        "#{@token_type} #{@access_token}"
      end
    end

    # Credentials for authentication
    abstract struct Credentials
      abstract def authenticate(endpoint : String) : Token
    end

    # API Key authentication
    struct ApiKeyCredentials < Credentials
      getter api_key : String
      getter api_secret : String

      def initialize(@api_key : String, @api_secret : String)
      end

      def authenticate(endpoint : String) : Token
        # In production, this would make an HTTP request to exchange credentials
        Token.new(
          access_token: "#{@api_key}:#{@api_secret}",
          token_type: "ApiKey",
          expires_at: Time.utc + 24.hours
        )
      end
    end

    # OAuth2 credentials
    struct OAuth2Credentials < Credentials
      getter client_id : String
      getter client_secret : String
      getter scope : String

      def initialize(@client_id : String, @client_secret : String, @scope : String = "")
      end

      def authenticate(endpoint : String) : Token
        # In production, this would make an OAuth2 token request
        Token.new(
          access_token: "oauth2_token_placeholder",
          token_type: "Bearer",
          expires_at: Time.utc + 1.hour,
          refresh_token: "refresh_token_placeholder"
        )
      end
    end

    # Token manager with automatic refresh using fibers
    class TokenManager
      @token : Token?
      @credentials : Credentials
      @endpoint : String
      @mutex : Mutex
      @refresh_fiber : Fiber?

      def initialize(@credentials : Credentials, @endpoint : String)
        @mutex = Mutex.new
      end

      def token : Token
        @mutex.synchronize do
          current = @token
          if current.nil? || current.expired?
            @token = @credentials.authenticate(@endpoint)
          elsif current.expires_soon?
            # Start background refresh
            start_refresh_fiber unless @refresh_fiber
          end
          @token.not_nil!
        end
      end

      def invalidate
        @mutex.synchronize do
          @token = nil
        end
      end

      private def start_refresh_fiber
        @refresh_fiber = spawn do
          begin
            new_token = @credentials.authenticate(@endpoint)
            @mutex.synchronize do
              @token = new_token
            end
          rescue ex
            # Log error but don't crash
          ensure
            @refresh_fiber = nil
          end
        end
      end
    end
  end

  # ---------------------------------------------------------
  # Connection Pool
  # ---------------------------------------------------------

  class ConnectionPool
    @connections : Array(Connection)
    @available : Channel(Connection)
    @mutex : Mutex
    @config : Config
    @token_manager : Auth::TokenManager?

    def initialize(@config : Config)
      @connections = [] of Connection
      @available = Channel(Connection).new(capacity: @config.pool_size)
      @mutex = Mutex.new

      if api_key = @config.api_key
        if api_secret = @config.api_secret
          credentials = Auth::ApiKeyCredentials.new(api_key, api_secret)
          @token_manager = Auth::TokenManager.new(credentials, @config.endpoint)
        end
      end

      # Pre-create connections using fibers
      @config.pool_size.times do
        spawn do
          conn = create_connection
          @mutex.synchronize { @connections << conn }
          @available.send(conn)
        end
      end
    end

    # Acquire a connection from the pool
    def acquire : Connection
      select
      when conn = @available.receive
        if conn.healthy?
          conn
        else
          # Replace unhealthy connection
          @mutex.synchronize { @connections.delete(conn) }
          new_conn = create_connection
          @mutex.synchronize { @connections << new_conn }
          new_conn
        end
      when timeout(@config.timeout)
        raise ConnectionError.new("Timeout acquiring connection from pool")
      end
    end

    # Release a connection back to the pool
    def release(conn : Connection)
      if conn.healthy?
        spawn { @available.send(conn) }
      else
        # Replace unhealthy connection
        @mutex.synchronize { @connections.delete(conn) }
        spawn do
          new_conn = create_connection
          @mutex.synchronize { @connections << new_conn }
          @available.send(new_conn)
        end
      end
    end

    # Execute with automatic connection management
    def with_connection(&block : Connection -> T) : T forall T
      conn = acquire
      begin
        yield conn
      ensure
        release(conn)
      end
    end

    # Close all connections
    def close
      @mutex.synchronize do
        @connections.each(&.close)
        @connections.clear
      end
    end

    def size : Int32
      @mutex.synchronize { @connections.size }
    end

    private def create_connection : Connection
      Connection.new(@config.endpoint, @token_manager)
    end
  end

  # ---------------------------------------------------------
  # Connection
  # ---------------------------------------------------------

  class Connection
    @ws : HTTP::WebSocket?
    @endpoint : String
    @token_manager : Auth::TokenManager?
    @pending : Hash(Int64, Channel(JSON::Any))
    @next_id : Int64 = 0_i64
    @mutex : Mutex
    @connected : Bool = false
    @healthy : Bool = true
    @last_ping : Time = Time.utc

    def initialize(@endpoint : String, @token_manager : Auth::TokenManager? = nil)
      @pending = {} of Int64 => Channel(JSON::Any)
      @mutex = Mutex.new
    end

    def connect
      return if @connected

      headers = HTTP::Headers.new
      if tm = @token_manager
        headers["Authorization"] = tm.token.authorization_header
      end

      uri = URI.parse(@endpoint)
      @ws = HTTP::WebSocket.new(uri, headers)
      @connected = true
      @healthy = true
      @last_ping = Time.utc

      spawn do
        @ws.try do |ws|
          ws.on_message do |message|
            handle_message(message)
          end
          ws.on_close do |_code|
            @connected = false
            @healthy = false
          end
          ws.on_ping do
            @last_ping = Time.utc
          end
          ws.run
        end
      end

      # Start keepalive fiber
      spawn do
        while @connected
          sleep 30.seconds
          if @connected && (Time.utc - @last_ping) > 60.seconds
            @healthy = false
          end
        end
      end

      # Wait for connection to establish
      sleep 100.milliseconds
    end

    def call(method : String, args : Array(JSON::Any)) : JSON::Any
      connect unless @connected

      call_id = next_id
      channel = Channel(JSON::Any).new

      @mutex.synchronize do
        @pending[call_id] = channel
      end

      message = JSON.build do |json|
        json.object do
          json.field "id", call_id
          json.field "method", method
          json.field "args", args
        end
      end

      send_message(message)
      result = channel.receive

      @mutex.synchronize do
        @pending.delete(call_id)
      end

      if error = result["error"]?
        code = error["code"]?.try(&.as_s) || "UNKNOWN"
        msg = error["message"]?.try(&.as_s) || "Unknown error"
        raise RpcError.new(code, msg)
      end

      result["result"]? || JSON::Any.new(nil)
    end

    def healthy? : Bool
      @healthy && @connected
    end

    def close
      @connected = false
      @ws.try(&.close)
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
  # Retry Logic
  # ---------------------------------------------------------

  module Retry
    # Retry strategy configuration
    struct Strategy
      getter max_retries : Int32
      getter initial_delay : Time::Span
      getter backoff_multiplier : Float64
      getter max_delay : Time::Span
      getter retryable_errors : Array(String)

      def initialize(
        @max_retries : Int32 = DEFAULT_MAX_RETRIES,
        @initial_delay : Time::Span = DEFAULT_RETRY_DELAY,
        @backoff_multiplier : Float64 = DEFAULT_RETRY_BACKOFF,
        @max_delay : Time::Span = 30.seconds,
        @retryable_errors : Array(String) = ["UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED"]
      )
      end

      def delay_for_attempt(attempt : Int32) : Time::Span
        delay = @initial_delay * (@backoff_multiplier ** attempt)
        delay.clamp(Time::Span.zero, @max_delay)
      end

      def should_retry?(error : Exception, attempt : Int32) : Bool
        return false if attempt >= @max_retries

        case error
        when RpcError
          @retryable_errors.includes?(error.code)
        when ConnectionError
          true
        else
          false
        end
      end
    end

    # Execute with retry logic using fibers
    def self.with_retry(strategy : Strategy = Strategy.new, &block : -> T) : T forall T
      attempt = 0
      last_error : Exception? = nil

      loop do
        begin
          return yield
        rescue ex
          last_error = ex

          unless strategy.should_retry?(ex, attempt)
            raise ex
          end

          delay = strategy.delay_for_attempt(attempt)
          attempt += 1

          # Use fiber-friendly sleep
          sleep delay
        end
      end

      raise last_error.not_nil!
    end

    # Execute with retry and progress callback
    def self.with_retry(
      strategy : Strategy = Strategy.new,
      on_retry : Proc(Int32, Exception, Time::Span, Nil)? = nil,
      &block : -> T
    ) : T forall T
      attempt = 0
      last_error : Exception? = nil

      loop do
        begin
          return yield
        rescue ex
          last_error = ex

          unless strategy.should_retry?(ex, attempt)
            raise ex
          end

          delay = strategy.delay_for_attempt(attempt)
          on_retry.try(&.call(attempt, ex, delay))
          attempt += 1

          sleep delay
        end
      end

      raise last_error.not_nil!
    end
  end

  # ---------------------------------------------------------
  # Client - Main entry point
  # ---------------------------------------------------------

  class Client
    @config : Config
    @pool : ConnectionPool
    @retry_strategy : Retry::Strategy

    def initialize(@config : Config = Config.from_env)
      @pool = ConnectionPool.new(@config)
      @retry_strategy = Retry::Strategy.new(
        max_retries: @config.max_retries,
        initial_delay: @config.retry_delay,
        backoff_multiplier: @config.retry_backoff
      )
    end

    def initialize(
      endpoint : String,
      api_key : String? = nil,
      api_secret : String? = nil,
      **options
    )
      @config = Config.new(
        endpoint: endpoint,
        api_key: api_key,
        api_secret: api_secret,
        pool_size: options[:pool_size]? || DEFAULT_POOL_SIZE,
        timeout: options[:timeout]? || DEFAULT_TIMEOUT,
        max_retries: options[:max_retries]? || DEFAULT_MAX_RETRIES
      )
      @pool = ConnectionPool.new(@config)
      @retry_strategy = Retry::Strategy.new(
        max_retries: @config.max_retries,
        initial_delay: @config.retry_delay,
        backoff_multiplier: @config.retry_backoff
      )
    end

    # Call a method with automatic retry and connection pooling
    def call(method : String, *args) : JSON::Any
      json_args = args.to_a.map { |a| to_json_any(a) }
      call_with_retry(method, json_args)
    end

    # Call with explicit JSON args
    def call(method : String, args : Array(JSON::Any)) : JSON::Any
      call_with_retry(method, args)
    end

    # Execute in a fiber for concurrent operations
    def async(&block : Client -> T) : Channel(T | Exception) forall T
      result_channel = Channel(T | Exception).new

      spawn do
        begin
          result_channel.send(yield self)
        rescue ex
          result_channel.send(ex)
        end
      end

      result_channel
    end

    # Execute multiple calls concurrently
    def parallel(*calls : {String, Array(JSON::Any)}) : Array(JSON::Any)
      channels = calls.map do |method, args|
        ch = Channel(JSON::Any | Exception).new
        spawn do
          begin
            ch.send(call(method, args))
          rescue ex
            ch.send(ex)
          end
        end
        ch
      end

      channels.map do |ch|
        result = ch.receive
        case result
        when Exception
          raise result
        else
          result
        end
      end
    end

    def close
      @pool.close
    end

    private def call_with_retry(method : String, args : Array(JSON::Any)) : JSON::Any
      Retry.with_retry(@retry_strategy) do
        @pool.with_connection do |conn|
          conn.call(method, args)
        end
      end
    end

    private def to_json_any(value) : JSON::Any
      case value
      when JSON::Any
        value
      when Nil
        JSON::Any.new(nil)
      when Bool
        JSON::Any.new(value)
      when Int32, Int64
        JSON::Any.new(value.to_i64)
      when Float32, Float64
        JSON::Any.new(value.to_f64)
      when String
        JSON::Any.new(value)
      when Array
        JSON::Any.new(value.map { |v| to_json_any(v) })
      when Hash
        hash = {} of String => JSON::Any
        value.each { |k, v| hash[k.to_s] = to_json_any(v) }
        JSON::Any.new(hash)
      else
        JSON.parse(value.to_json)
      end
    end
  end

  # ---------------------------------------------------------
  # Errors
  # ---------------------------------------------------------

  class Error < Exception; end

  class ConnectionError < Error; end

  class RpcError < Error
    getter code : String

    def initialize(@code : String, message : String)
      super(message)
    end
  end

  class AuthError < Error; end

  class TimeoutError < Error; end

  # ---------------------------------------------------------
  # Module-level helpers
  # ---------------------------------------------------------

  # Create a new client
  def self.connect(endpoint : String, **options) : Client
    Client.new(endpoint, **options)
  end

  # Create client from environment
  def self.connect : Client
    Client.new
  end

  # Create client with block (auto-close)
  def self.connect(endpoint : String, **options, &block : Client -> T) : T forall T
    client = Client.new(endpoint, **options)
    begin
      yield client
    ensure
      client.close
    end
  end
end
