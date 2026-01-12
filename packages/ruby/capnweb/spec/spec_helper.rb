# frozen_string_literal: true

require 'yaml'
require 'json'
require 'pathname'

# Add lib to load path
$LOAD_PATH.unshift File.expand_path('../lib', __dir__)

require 'capnweb'

# Conformance test configuration
module ConformanceConfig
  class << self
    # Test server URL from environment
    def server_url
      ENV.fetch('TEST_SERVER_URL', 'ws://localhost:8080')
    end

    # Directory containing conformance spec YAML files
    def spec_dir
      if ENV['TEST_SPEC_DIR']
        Pathname.new(ENV['TEST_SPEC_DIR'])
      else
        # From packages/ruby/spec -> packages/ruby -> packages -> root -> test/conformance
        Pathname.new(__dir__).join('../../../test/conformance')
      end
    end

    # Load all conformance specs
    def load_specs
      Dir.glob(spec_dir.join('*.yaml')).map do |file|
        spec = YAML.safe_load(File.read(file), permitted_classes: [Symbol])
        spec['_file'] = File.basename(file, '.yaml')
        spec
      end
    end

    # Check if SDK is implemented
    def sdk_implemented?
      !defined?(CapnWeb::NOT_IMPLEMENTED)
    end
  end
end

# Test helpers for conformance tests
module ConformanceHelpers
  # Resolve variable references like "$counter" from context
  def resolve_args(args, context)
    return args unless args.is_a?(Array)

    args.map do |arg|
      if arg.is_a?(String) && arg.start_with?('$')
        var_name = arg[1..]
        if var_name == 'self'
          context[:self]
        else
          context[var_name.to_sym] || context[var_name]
        end
      else
        arg
      end
    end
  end

  # Execute a method call on a stub or resolved value
  def execute_call(target, method_path, args, context)
    parts = method_path.to_s.split('.')

    # Navigate to the target
    current = parts.first.start_with?('$') ? context[parts.first[1..].to_sym] : target

    parts.each_with_index do |part, index|
      next if index.zero? && parts.first.start_with?('$')

      if index == parts.length - 1
        # Final call with args
        resolved_args = resolve_args(args, context)
        if resolved_args.empty?
          current = current.send(part.to_sym)
        else
          current = current.send(part.to_sym, *resolved_args)
        end
      else
        # Navigate property
        current = current.send(part.to_sym)
      end
    end

    current
  end

  # Run setup steps and populate context
  def run_setup(api, setup_steps, context)
    setup_steps.each do |step|
      result = execute_call(api, step['call'], step['args'] || [], context)

      if step['await']
        result = result.await!
      end

      if step['as']
        context[step['as'].to_sym] = result
      end
    end
  end

  # Compare expected vs actual results
  def matches_expectation?(actual, expected)
    case expected
    when Hash
      return false unless actual.is_a?(Hash)

      expected.all? do |key, value|
        matches_expectation?(actual[key.to_s] || actual[key.to_sym], value)
      end
    when Array
      return false unless actual.is_a?(Array)
      return false unless actual.length == expected.length

      expected.each_with_index.all? do |value, index|
        matches_expectation?(actual[index], value)
      end
    else
      actual == expected
    end
  end

  # Check if error matches expectation
  def matches_error?(error, expectation)
    return true if expectation == true # Any error expected

    if expectation['any_of']
      return expectation['any_of'].any? { |exp| matches_single_error?(error, exp) }
    end

    matches_single_error?(error, expectation)
  end

  def matches_single_error?(error, expectation)
    if expectation['type']
      return false unless error.class.name.include?(expectation['type'])
    end

    if expectation['message_contains']
      return false unless error.message.include?(expectation['message_contains'])
    end

    true
  end
end

RSpec.configure do |config|
  # Include helpers
  config.include ConformanceHelpers

  # Enable flags for future syntax
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups

  # Run specs in random order
  config.order = :random
  Kernel.srand config.seed

  # Metadata for conformance tests
  config.define_derived_metadata(file_path: %r{/conformance_spec\.rb$}) do |metadata|
    metadata[:conformance] = true
  end

  # Skip conformance tests if server not available
  config.before(:each, :conformance) do
    skip 'TEST_SERVER_URL not set' unless ENV['TEST_SERVER_URL']
  end

  # Filter examples if SDK not implemented
  config.around(:each, :requires_sdk) do |example|
    if ConformanceConfig.sdk_implemented?
      example.run
    else
      skip 'SDK not yet implemented'
    end
  end
end
