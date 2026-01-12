# frozen_string_literal: true

require_relative '{{name}}_do/version'
require_relative '{{name}}_do/client'

# {{Name}}.do SDK
#
# {{description}}
#
# @example
#   require '{{name}}.do'
#
#   client = {{Name}}Do::Client.new(api_key: ENV['DOTDO_KEY'])
#   rpc = client.connect
#   result = rpc.example
module {{Name}}Do
  class Error < StandardError; end
  class ConnectionError < Error; end
  class ConfigurationError < Error; end
end
