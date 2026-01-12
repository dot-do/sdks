# frozen_string_literal: true

require 'json'

# DotDo::CapnWeb - Capability-based RPC for Ruby
#
# A Ruby SDK for CapnWeb capability-based RPC protocol,
# providing promise-based async calls, pipelining, and server-side mapping.
module DotDo
  module CapnWeb
    VERSION = '0.1.0'

    # SDK implementation status
    NOT_IMPLEMENTED = true

    class Error < StandardError; end
    class ConnectionError < Error; end
    class TimeoutError < Error; end
    class RpcError < Error; end
    class NotFoundError < RpcError; end
    class PermissionError < RpcError; end
    class ValidationError < RpcError; end

    # Result monad for safe error handling
    class Result
      def self.success(value)
        Success.new(value)
      end

      def self.failure(error)
        Failure.new(error)
      end
    end

    class Success < Result
      attr_reader :value

      def initialize(value)
        @value = value
      end

      def success?
        true
      end

      def failure?
        false
      end

      def fmap
        Success.new(yield(@value))
      rescue StandardError => e
        Failure.new(e)
      end

      def flat_map
        yield(@value)
      end

      def or
        @value
      end

      def deconstruct
        [@value]
      end

      def deconstruct_keys(_keys)
        { value: @value }
      end
    end

    class Failure < Result
      attr_reader :error

      def initialize(error)
        @error = error
      end

      def success?
        false
      end

      def failure?
        true
      end

      def fmap
        self
      end

      def flat_map
        self
      end

      def or
        yield(@error)
      end

      def deconstruct
        [@error]
      end

      def deconstruct_keys(_keys)
        { error: @error }
      end
    end

    # Deferred promise for manual resolution
    class Deferred
      attr_reader :promise

      def initialize
        @promise = RpcPromise.new(nil, [], [], {})
        @resolved = false
        @value = nil
        @error = nil
      end

      def resolve(value)
        raise Error, 'Already resolved' if @resolved

        @resolved = true
        @value = value
        @promise.instance_variable_set(:@resolved, true)
        @promise.instance_variable_set(:@result, Result.success(value))
      end

      def reject(error)
        raise Error, 'Already resolved' if @resolved

        @resolved = true
        @error = error
        @promise.instance_variable_set(:@resolved, true)
        @promise.instance_variable_set(:@result, Result.failure(error))
      end
    end

    # RPC Promise - represents a pending or resolved remote call
    class RpcPromise
      attr_reader :session, :path, :args, :kwargs

      def initialize(session, path, args, kwargs)
        @session = session
        @path = path
        @args = args
        @kwargs = kwargs
        @resolved = false
        @result = nil
      end

      # Resolve the promise, raising on error
      def await!(timeout: nil)
        result = await(timeout: timeout)
        case result
        when Success then result.value
        when Failure then raise result.error
        end
      end

      # Resolve the promise, returning a Result
      def await(timeout: nil)
        return @result if @resolved

        raise NotImplementedError, 'DotDo::CapnWeb SDK not yet implemented'
      end

      # Chain a transformation on success
      def then(&block)
        ChainedPromise.new(self, block)
      end

      # Provide a fallback on error
      def rescue(&block)
        RescuePromise.new(self, block)
      end

      # Server-side map operation (Ruby's name for map)
      def remap(&block)
        RemapPromise.new(self, block)
      end

      # Allow method chaining for pipelining
      def method_missing(name, *args, **kwargs, &block)
        if args.empty? && kwargs.empty? && block.nil?
          # Property access - extend the path
          RpcPromise.new(@session, @path + [name], [], {})
        else
          # Method call on promised value
          PipelinedPromise.new(self, name, args, kwargs)
        end
      end

      def respond_to_missing?(_name, _include_private = false)
        true
      end
    end

    # Promise that chains through another promise
    class PipelinedPromise < RpcPromise
      def initialize(parent, method_name, args, kwargs)
        @parent = parent
        @method_name = method_name
        super(parent.session, parent.path + [method_name], args, kwargs)
      end
    end

    # Promise with a transformation applied
    class ChainedPromise < RpcPromise
      def initialize(parent, transform)
        @parent = parent
        @transform = transform
        super(parent.session, parent.path, parent.args, parent.kwargs)
      end
    end

    # Promise with error recovery
    class RescuePromise < RpcPromise
      def initialize(parent, handler)
        @parent = parent
        @handler = handler
        super(parent.session, parent.path, parent.args, parent.kwargs)
      end
    end

    # Promise for server-side mapping
    class RemapPromise < RpcPromise
      def initialize(parent, mapper)
        @parent = parent
        @mapper = mapper
        super(parent.session, parent.path, parent.args, parent.kwargs)
      end
    end

    # Dynamic proxy stub for RPC calls
    class Stub < BasicObject
      def initialize(session, path = [])
        @session = session
        @path = path
      end

      def method_missing(name, *args, **kwargs, &block)
        if args.empty? && kwargs.empty? && block.nil?
          # Property access - extend the path
          Stub.new(@session, @path + [name])
        else
          # Method call - return a Promise
          ::DotDo::CapnWeb::RpcPromise.new(@session, @path + [name], args, kwargs)
        end
      end

      def respond_to_missing?(_name, _include_private = false)
        true
      end

      # Allow inspection for debugging
      def inspect
        "#<DotDo::CapnWeb::Stub path=#{@path.inspect}>"
      end

      def class
        ::DotDo::CapnWeb::Stub
      end
    end

    # Session manages a connection to a remote endpoint
    class Session
      attr_reader :url, :options

      def initialize(url, **options)
        @url = url
        @options = options
        @connected = false
        @stub = Stub.new(self)
      end

      def stub
        @stub
      end

      def connected?
        @connected
      end

      def connect
        raise NotImplementedError, 'DotDo::CapnWeb SDK not yet implemented'
      end

      def close
        @connected = false
      end

      def resolve(promise, timeout: nil)
        raise NotImplementedError, 'DotDo::CapnWeb SDK not yet implemented'
      end
    end

    # Module for exposing Ruby objects as RPC targets
    module Target
      def self.included(base)
        base.extend(ClassMethods)
      end

      module ClassMethods
        def exposes(*methods)
          @exposed_methods = methods
        end

        def exposed_methods
          @exposed_methods || public_instance_methods(false)
        end

        def validates(method, &block)
          @validators ||= {}
          @validators[method] = block
        end

        def before_rpc(method)
          @before_hooks ||= []
          @before_hooks << method
        end

        def after_rpc(method)
          @after_hooks ||= []
          @after_hooks << method
        end
      end
    end

    class << self
      # Connect to a WebSocket endpoint
      #
      # @param url [String] The WebSocket URL
      # @param options [Hash] Connection options
      # @yield [Stub] The root stub for making RPC calls
      # @return [Object] The block's return value, or the Session if no block
      def connect(url, **options, &block)
        session = Session.new(url, **options)

        if block_given?
          begin
            session.connect
            yield session.stub
          ensure
            session.close
          end
        else
          session.connect
          session
        end
      end

      # Batch HTTP mode
      def batch(url, **options, &block)
        connect(url, transport: :http, **options, &block)
      end

      # Fiber-based async mode (Ruby 3.2+)
      def async(url, **options, &block)
        connect(url, async: true, **options, &block)
      end

      # Resolve multiple promises in parallel
      def gather(*promises)
        promises.map(&:await!)
      end

      # Execute with a timeout
      def with_timeout(seconds, &block)
        Timeout.timeout(seconds, TimeoutError, &block)
      end

      # Global configuration
      def configure
        yield configuration
      end

      def configuration
        @configuration ||= Configuration.new
      end
    end

    class Configuration
      attr_accessor :timeout, :pool_size, :retry_count, :default_url

      def initialize
        @timeout = 30
        @pool_size = 5
        @retry_count = 3
        @error_handler = nil
      end

      def on_error(&block)
        @error_handler = block
      end

      def handle_error(error)
        @error_handler&.call(error)
      end
    end
  end
end

# Backward compatibility alias
CapnWeb = DotDo::CapnWeb
