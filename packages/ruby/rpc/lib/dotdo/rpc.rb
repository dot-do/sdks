# frozen_string_literal: true

require 'json'

# DotDo::Rpc - Remote Procedure Call primitives for Ruby
#
# Core RPC primitives for the DotDo platform, including promises,
# pipelining, server-side mapping (remap), and result types.
module DotDo
  module Rpc
    VERSION = '0.1.0'

    class Error < StandardError; end
    class ConnectionError < Error; end
    class TimeoutError < Error; end
    class RpcError < Error; end
    class NotFoundError < RpcError; end
    class PermissionError < RpcError; end
    class ValidationError < RpcError; end

    # Result monad for safe error handling
    # Provides a functional approach to error handling without exceptions
    class Result
      def self.success(value)
        Success.new(value)
      end

      def self.failure(error)
        Failure.new(error)
      end

      # Wrap a block, capturing any exception as a Failure
      def self.try
        Success.new(yield)
      rescue StandardError => e
        Failure.new(e)
      end
    end

    # Represents a successful result
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

      # Apply a function to the value, returning a new Success
      def fmap
        Success.new(yield(@value))
      rescue StandardError => e
        Failure.new(e)
      end

      # Apply a function that returns a Result
      def flat_map
        yield(@value)
      end

      # Return the value (ignore the fallback)
      def or
        @value
      end

      # Pattern matching support (Ruby 3.0+)
      def deconstruct
        [@value]
      end

      def deconstruct_keys(_keys)
        { value: @value }
      end
    end

    # Represents a failed result
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

      # Return self (don't transform failures)
      def fmap
        self
      end

      # Return self (don't chain failures)
      def flat_map
        self
      end

      # Execute fallback block with error
      def or
        yield(@error)
      end

      # Pattern matching support (Ruby 3.0+)
      def deconstruct
        [@error]
      end

      def deconstruct_keys(_keys)
        { error: @error }
      end
    end

    # Promise - represents a pending or resolved async operation
    class Promise
      attr_reader :path, :args, :kwargs

      def initialize(path = [], args = [], kwargs = {})
        @path = path
        @args = args
        @kwargs = kwargs
        @resolved = false
        @result = nil
        @callbacks = []
      end

      # Check if the promise is resolved
      def resolved?
        @resolved
      end

      # Resolve with a successful value
      def resolve(value)
        return if @resolved

        @resolved = true
        @result = Result.success(value)
        @callbacks.each { |cb| cb.call(@result) }
        @callbacks.clear
      end

      # Reject with an error
      def reject(error)
        return if @resolved

        @resolved = true
        @result = Result.failure(error)
        @callbacks.each { |cb| cb.call(@result) }
        @callbacks.clear
      end

      # Wait for the promise to resolve, raising on error
      def await!(timeout: nil)
        result = await(timeout: timeout)
        case result
        when Success then result.value
        when Failure then raise result.error
        end
      end

      # Wait for the promise to resolve, returning a Result
      def await(timeout: nil)
        return @result if @resolved

        raise NotImplementedError, 'Promise resolution requires a runtime'
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
      # This is the key method - remap runs on the server, not client
      def remap(&block)
        RemapPromise.new(self, block)
      end

      # Add a callback to be called when resolved
      def on_resolved(&block)
        if @resolved
          block.call(@result)
        else
          @callbacks << block
        end
        self
      end
    end

    # Promise with a transformation applied on success
    class ChainedPromise < Promise
      def initialize(parent, transform)
        super(parent.path, parent.args, parent.kwargs)
        @parent = parent
        @transform = transform
      end

      def await(timeout: nil)
        result = @parent.await(timeout: timeout)
        return result if result.failure?

        result.fmap { |value| @transform.call(value) }
      end
    end

    # Promise with error recovery
    class RescuePromise < Promise
      def initialize(parent, handler)
        super(parent.path, parent.args, parent.kwargs)
        @parent = parent
        @handler = handler
      end

      def await(timeout: nil)
        result = @parent.await(timeout: timeout)
        return result if result.success?

        Result.try { @handler.call(result.error) }
      end
    end

    # Promise for server-side mapping (remap)
    # The mapper block is serialized and sent to the server for execution
    class RemapPromise < Promise
      attr_reader :mapper

      def initialize(parent, mapper)
        super(parent.path, parent.args, parent.kwargs)
        @parent = parent
        @mapper = mapper
      end

      # Convert mapper to a serializable representation
      def mapper_source
        # In a real implementation, this would serialize the block
        # For now, we store a reference that the transport can handle
        @mapper
      end
    end

    # Deferred - manually controllable promise
    class Deferred
      attr_reader :promise

      def initialize
        @promise = Promise.new
      end

      def resolve(value)
        @promise.resolve(value)
      end

      def reject(error)
        @promise.reject(error)
      end
    end

    # Module methods for working with promises
    class << self
      # Create a resolved promise with a value
      def resolve(value)
        promise = Promise.new
        promise.resolve(value)
        promise
      end

      # Create a rejected promise with an error
      def reject(error)
        promise = Promise.new
        promise.reject(error)
        promise
      end

      # Wait for all promises to resolve
      def all(*promises)
        results = promises.map(&:await)
        errors = results.select(&:failure?)
        return errors.first unless errors.empty?

        Result.success(results.map(&:value))
      end

      # Wait for all promises, raising on any error
      def all!(*promises)
        promises.map(&:await!)
      end

      # Return the first promise to resolve
      def race(*promises)
        raise NotImplementedError, 'race requires async runtime support'
      end

      # Create a promise that resolves after a delay
      def delay(seconds)
        raise NotImplementedError, 'delay requires async runtime support'
      end
    end
  end
end
