# frozen_string_literal: true

require 'spec_helper'

RSpec.describe 'CapnWeb Conformance Tests' do
  let(:server_url) { ConformanceConfig.server_url }
  let(:api) { nil } # Will be set in each test when SDK is implemented

  # Dynamically load and generate tests from YAML specs
  ConformanceConfig.load_specs.each do |spec|
    describe spec['name'], conformance: true do
      spec['tests'].each do |test|
        context test['name'] do
          it test['description'], :requires_sdk do
            CapnWeb.connect(server_url) do |api|
              context = { self: api }

              # Run setup if present
              if test['setup']
                run_setup(api, test['setup'], context)
              end

              # Handle different test types
              result = case
                       when test['sequence']
                         run_sequence_test(api, test, context)
                       when test['pipeline']
                         run_pipeline_test(api, test, context)
                       when test['call']
                         run_simple_test(api, test, context)
                       else
                         raise "Unknown test type in #{test['name']}"
                       end

              # Check expectations
              if test['expect_error']
                # Should have raised - if we get here, fail
                fail 'Expected an error but none was raised'
              elsif test['expect']
                expect(result).to satisfy { |r| matches_expectation?(r, test['expect']) }
              end
            end
          rescue CapnWeb::Error, StandardError => e
            if test['expect_error']
              expect(e).to satisfy { |err| matches_error?(err, test['expect_error']) }
            else
              raise
            end
          end
        end
      end
    end
  end

  # Test type implementations
  def run_simple_test(api, test, context)
    args = resolve_args(test['args'] || [], context)
    promise = execute_call(api, test['call'], args, context)
    promise.await!
  end

  def run_sequence_test(api, test, context)
    results = {}

    test['sequence'].each do |step|
      args = resolve_args(step['args'] || [], context)
      promise = execute_call(api, step['call'], args, context)
      result = promise.await!

      if step['as']
        context[step['as'].to_sym] = result
        results[step['as']] = result
      end

      if step['expect']
        expect(result).to satisfy { |r| matches_expectation?(r, step['expect']) }
      end
    end

    results
  end

  def run_pipeline_test(api, test, context)
    promises = {}

    test['pipeline'].each do |step|
      args = resolve_args(step['args'] || [], context)

      # Determine target
      target = if step['call'].include?('.')
                 # Method on a previous promise (e.g., "counter.value")
                 parts = step['call'].split('.')
                 base_name = parts.first
                 method_chain = parts[1..]

                 base = promises[base_name] || context[base_name.to_sym]
                 raise "Unknown reference: #{base_name}" unless base

                 current = base
                 method_chain[0..-2].each { |m| current = current.send(m.to_sym) }
                 [current, method_chain.last]
               else
                 [api, step['call']]
               end

      promise = if args.empty?
                  target[0].send(target[1].to_sym)
                else
                  target[0].send(target[1].to_sym, *args)
                end

      if step['as']
        promises[step['as']] = promise
        context[step['as'].to_sym] = promise
      else
        promises['_last'] = promise
      end
    end

    # Await all named promises
    results = {}
    promises.each do |name, promise|
      next if name == '_last'

      results[name] = promise.await!
    end

    # If there's only one result and no named outputs, return just that
    if results.size == 1 && test['expect'] && !test['expect'].is_a?(Hash)
      results.values.first
    elsif results.empty? && promises['_last']
      promises['_last'].await!
    else
      results
    end
  end
end

# Additional SDK unit tests (run without server)
RSpec.describe CapnWeb do
  describe '.connect' do
    it 'yields a stub to the block' do
      skip 'SDK not yet implemented' unless ConformanceConfig.sdk_implemented?

      CapnWeb.connect('ws://localhost:8080') do |api|
        expect(api).to be_a(CapnWeb::Stub)
      end
    end

    it 'returns a session without a block' do
      skip 'SDK not yet implemented' unless ConformanceConfig.sdk_implemented?

      session = CapnWeb.connect('ws://localhost:8080')
      expect(session).to be_a(CapnWeb::Session)
      session.close
    end
  end

  describe CapnWeb::Stub do
    let(:session) { CapnWeb::Session.new('ws://localhost:8080') }
    let(:stub) { CapnWeb::Stub.new(session) }

    it 'supports method chaining for property access' do
      result = stub.users.get
      expect(result.class).to eq(CapnWeb::Stub)
    end

    it 'returns a promise when called with arguments' do
      result = stub.users.get(123)
      expect(result).to be_a(CapnWeb::RpcPromise)
    end
  end

  describe CapnWeb::RpcPromise do
    let(:session) { CapnWeb::Session.new('ws://localhost:8080') }
    let(:promise) { CapnWeb::RpcPromise.new(session, [:users, :get], [123], {}) }

    it 'supports pipelining through method_missing' do
      chained = promise.profile.name
      expect(chained).to be_a(CapnWeb::RpcPromise)
    end

    it 'returns a chained promise with then' do
      chained = promise.then { |user| user.name }
      expect(chained).to be_a(CapnWeb::ChainedPromise)
    end

    it 'returns a rescue promise with rescue' do
      recovered = promise.rescue { |_e| 'default' }
      expect(recovered).to be_a(CapnWeb::RescuePromise)
    end

    it 'returns a remap promise with remap' do
      mapped = promise.remap { |item| item.name }
      expect(mapped).to be_a(CapnWeb::RemapPromise)
    end
  end

  describe CapnWeb::Result do
    describe CapnWeb::Success do
      let(:success) { CapnWeb::Success.new(42) }

      it 'is a success' do
        expect(success).to be_success
        expect(success).not_to be_failure
      end

      it 'returns value with fmap' do
        result = success.fmap { |v| v * 2 }
        expect(result.value).to eq(84)
      end

      it 'returns value with or' do
        result = success.or { 0 }
        expect(result).to eq(42)
      end

      it 'supports pattern matching', :ruby3 do
        skip 'Pattern matching requires Ruby 3.0+' if RUBY_VERSION < '3.0'

        # Pattern matching syntax (Ruby 3.0+)
        matched_value = nil
        eval <<-RUBY
          case success
          in CapnWeb::Success(v)
            matched_value = v
          end
        RUBY
        expect(matched_value).to eq(42)
      end
    end

    describe CapnWeb::Failure do
      let(:error) { CapnWeb::RpcError.new('something went wrong') }
      let(:failure) { CapnWeb::Failure.new(error) }

      it 'is a failure' do
        expect(failure).to be_failure
        expect(failure).not_to be_success
      end

      it 'skips fmap' do
        result = failure.fmap { |v| v * 2 }
        expect(result).to be_failure
        expect(result.error).to eq(error)
      end

      it 'returns fallback with or' do
        result = failure.or { |e| "error: #{e.message}" }
        expect(result).to eq('error: something went wrong')
      end

      it 'supports pattern matching', :ruby3 do
        skip 'Pattern matching requires Ruby 3.0+' if RUBY_VERSION < '3.0'

        # Pattern matching syntax (Ruby 3.0+)
        matched_error = nil
        eval <<-RUBY
          case failure
          in CapnWeb::Failure(e)
            matched_error = e
          end
        RUBY
        expect(matched_error.message).to eq('something went wrong')
      end
    end
  end

  describe CapnWeb::Deferred do
    it 'creates a resolvable promise' do
      deferred = CapnWeb::Deferred.new
      expect(deferred.promise).to be_a(CapnWeb::RpcPromise)
    end

    it 'cannot be resolved twice' do
      deferred = CapnWeb::Deferred.new
      deferred.resolve(42)
      expect { deferred.resolve(43) }.to raise_error(CapnWeb::Error, /Already resolved/)
    end

    it 'cannot be rejected after resolve' do
      deferred = CapnWeb::Deferred.new
      deferred.resolve(42)
      expect { deferred.reject(StandardError.new) }.to raise_error(CapnWeb::Error, /Already resolved/)
    end
  end

  describe CapnWeb::Target do
    let(:target_class) do
      Class.new do
        include CapnWeb::Target

        exposes :public_method

        def public_method
          'result'
        end

        private

        def private_method
          'secret'
        end
      end
    end

    it 'tracks exposed methods' do
      expect(target_class.exposed_methods).to eq([:public_method])
    end
  end

  describe CapnWeb::Configuration do
    it 'has sensible defaults' do
      config = CapnWeb::Configuration.new
      expect(config.timeout).to eq(30)
      expect(config.pool_size).to eq(5)
      expect(config.retry_count).to eq(3)
    end

    it 'can be configured via block' do
      CapnWeb.configure do |c|
        c.timeout = 60
        c.pool_size = 10
      end

      expect(CapnWeb.configuration.timeout).to eq(60)
      expect(CapnWeb.configuration.pool_size).to eq(10)
    end
  end

  describe '.gather' do
    it 'awaits multiple promises' do
      skip 'SDK not yet implemented' unless ConformanceConfig.sdk_implemented?

      # Would test parallel resolution when SDK is implemented
    end
  end
end
