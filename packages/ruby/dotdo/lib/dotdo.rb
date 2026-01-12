# frozen_string_literal: true

require 'json'
require 'uri'
require 'net/http'

# DotDo - Ruby client for the DotDo platform
#
# Official Ruby SDK for the DotDo platform. Includes authentication,
# connection pooling, retry logic, and a high-level client API.
module DotDo
  VERSION = '0.1.0'

  class Error < StandardError; end
  class AuthenticationError < Error; end
  class ConnectionError < Error; end
  class TimeoutError < Error; end
  class RateLimitError < Error; end
  class RetryExhaustedError < Error; end

  # Configuration for the DotDo client
  class Configuration
    attr_accessor :api_key, :api_secret, :base_url, :timeout
    attr_accessor :pool_size, :pool_timeout
    attr_accessor :max_retries, :retry_delay, :retry_backoff
    attr_accessor :logger

    def initialize
      @api_key = ENV['DOTDO_API_KEY']
      @api_secret = ENV['DOTDO_API_SECRET']
      @base_url = ENV['DOTDO_BASE_URL'] || 'https://api.dotdo.dev'
      @timeout = 30
      @pool_size = 5
      @pool_timeout = 5
      @max_retries = 3
      @retry_delay = 0.5
      @retry_backoff = 2.0
      @logger = nil
    end

    def validate!
      raise AuthenticationError, 'API key is required' if @api_key.nil? || @api_key.empty?
    end
  end

  # Authentication handler for DotDo API
  class Auth
    attr_reader :config

    def initialize(config)
      @config = config
      @token = nil
      @token_expires_at = nil
    end

    # Get a valid access token, refreshing if necessary
    def token
      refresh_token if token_expired?
      @token
    end

    # Check if the current token is expired
    def token_expired?
      return true if @token.nil?
      return true if @token_expires_at.nil?

      Time.now >= @token_expires_at
    end

    # Refresh the access token
    def refresh_token
      # Stub implementation - actual implementation would call auth endpoint
      @token = generate_jwt_stub
      @token_expires_at = Time.now + 3600 # 1 hour
      @token
    end

    # Generate authorization headers
    def headers
      {
        'Authorization' => "Bearer #{token}",
        'X-API-Key' => @config.api_key,
        'Content-Type' => 'application/json'
      }
    end

    private

    def generate_jwt_stub
      # Stub - real implementation would exchange credentials for JWT
      "dotdo_stub_token_#{Time.now.to_i}"
    end
  end

  # Connection pool for managing HTTP connections
  class ConnectionPool
    def initialize(config)
      @config = config
      @connections = []
      @mutex = Mutex.new
      @available = ConditionVariable.new
      @size = config.pool_size
      @timeout = config.pool_timeout
    end

    # Checkout a connection from the pool
    def checkout
      @mutex.synchronize do
        loop do
          # Try to get an existing connection
          if (conn = @connections.find { |c| c[:available] })
            conn[:available] = false
            return conn[:connection]
          end

          # Create a new connection if pool not full
          if @connections.size < @size
            conn = create_connection
            @connections << { connection: conn, available: false }
            return conn
          end

          # Wait for a connection to become available
          @available.wait(@mutex, @timeout)
          raise ConnectionError, 'Connection pool timeout' if @connections.all? { |c| !c[:available] }
        end
      end
    end

    # Return a connection to the pool
    def checkin(connection)
      @mutex.synchronize do
        conn = @connections.find { |c| c[:connection] == connection }
        conn[:available] = true if conn
        @available.signal
      end
    end

    # Execute a block with a pooled connection
    def with_connection
      conn = checkout
      yield conn
    ensure
      checkin(conn) if conn
    end

    # Close all connections in the pool
    def shutdown
      @mutex.synchronize do
        @connections.each { |c| c[:connection].finish if c[:connection].started? }
        @connections.clear
      end
    end

    private

    def create_connection
      uri = URI.parse(@config.base_url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == 'https'
      http.open_timeout = @config.timeout
      http.read_timeout = @config.timeout
      http.start
      http
    end
  end

  # Retry handler with exponential backoff
  class RetryHandler
    def initialize(config)
      @config = config
      @max_retries = config.max_retries
      @delay = config.retry_delay
      @backoff = config.retry_backoff
    end

    # Execute a block with retry logic
    def with_retry
      attempts = 0
      current_delay = @delay

      loop do
        begin
          return yield
        rescue ConnectionError, TimeoutError, RateLimitError => e
          attempts += 1
          raise RetryExhaustedError, "Max retries (#{@max_retries}) exceeded: #{e.message}" if attempts >= @max_retries

          log_retry(attempts, e, current_delay)
          sleep(current_delay)
          current_delay *= @backoff
        end
      end
    end

    private

    def log_retry(attempt, error, delay)
      return unless @config.logger

      @config.logger.warn("DotDo retry #{attempt}/#{@max_retries}: #{error.message}, waiting #{delay}s")
    end
  end

  # Main client for interacting with the DotDo platform
  class Client
    attr_reader :config, :auth

    def initialize(config = nil, &block)
      @config = config || Configuration.new
      yield @config if block_given?
      @config.validate!

      @auth = Auth.new(@config)
      @pool = ConnectionPool.new(@config)
      @retry_handler = RetryHandler.new(@config)
    end

    # Make an authenticated GET request
    def get(path, params = {})
      request(:get, path, params: params)
    end

    # Make an authenticated POST request
    def post(path, body = {})
      request(:post, path, body: body)
    end

    # Make an authenticated PUT request
    def put(path, body = {})
      request(:put, path, body: body)
    end

    # Make an authenticated DELETE request
    def delete(path, params = {})
      request(:delete, path, params: params)
    end

    # Make an authenticated PATCH request
    def patch(path, body = {})
      request(:patch, path, body: body)
    end

    # Execute an RPC call
    def call(method, *args, **kwargs)
      post('/rpc', { method: method, args: args, kwargs: kwargs })
    end

    # Close all connections and cleanup
    def close
      @pool.shutdown
    end

    private

    def request(method, path, params: {}, body: nil)
      @retry_handler.with_retry do
        @pool.with_connection do |conn|
          execute_request(conn, method, path, params, body)
        end
      end
    end

    def execute_request(conn, method, path, params, body)
      uri = build_uri(path, params)
      req = build_request(method, uri, body)

      response = conn.request(req)
      handle_response(response)
    end

    def build_uri(path, params)
      uri = URI.parse("#{@config.base_url}#{path}")
      uri.query = URI.encode_www_form(params) unless params.empty?
      uri
    end

    def build_request(method, uri, body)
      klass = case method
              when :get    then Net::HTTP::Get
              when :post   then Net::HTTP::Post
              when :put    then Net::HTTP::Put
              when :delete then Net::HTTP::Delete
              when :patch  then Net::HTTP::Patch
              else raise ArgumentError, "Unknown HTTP method: #{method}"
              end

      req = klass.new(uri)
      @auth.headers.each { |k, v| req[k] = v }
      req.body = JSON.generate(body) if body
      req
    end

    def handle_response(response)
      case response.code.to_i
      when 200..299
        JSON.parse(response.body, symbolize_names: true)
      when 401
        raise AuthenticationError, 'Authentication failed'
      when 429
        raise RateLimitError, 'Rate limit exceeded'
      when 500..599
        raise ConnectionError, "Server error: #{response.code}"
      else
        raise Error, "Request failed: #{response.code} - #{response.body}"
      end
    end
  end

  class << self
    # Global configuration
    def configuration
      @configuration ||= Configuration.new
    end

    def configure
      yield configuration
    end

    # Create a new client with optional config block
    def client(&block)
      Client.new(configuration.dup, &block)
    end

    # Shortcut to create a client with an API key
    def connect(api_key: nil, base_url: nil, **options)
      Client.new do |config|
        config.api_key = api_key if api_key
        config.base_url = base_url if base_url
        options.each { |k, v| config.send("#{k}=", v) if config.respond_to?("#{k}=") }
      end
    end
  end
end
