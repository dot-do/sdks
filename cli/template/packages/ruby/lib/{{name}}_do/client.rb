# frozen_string_literal: true

require 'rpc.do'

module {{Name}}Do
  # Client for interacting with the {{name}}.do service
  #
  # @example
  #   client = {{Name}}Do::Client.new(api_key: 'your-api-key')
  #   rpc = client.connect
  #   result = rpc.example
  class Client
    # Default base URL for the service
    DEFAULT_BASE_URL = 'https://{{name}}.do'

    # @return [String, nil] the API key for authentication
    attr_reader :api_key

    # @return [String] the base URL for the service
    attr_reader :base_url

    # Initialize a new client
    #
    # @param api_key [String, nil] API key for authentication
    # @param base_url [String] Base URL for the service
    def initialize(api_key: nil, base_url: DEFAULT_BASE_URL)
      @api_key = api_key
      @base_url = base_url
      @rpc = nil
    end

    # Connect to the {{name}}.do service
    #
    # @return [RpcDo::Client] the connected RPC client
    def connect
      return @rpc if @rpc

      headers = {}
      headers['Authorization'] = "Bearer #{@api_key}" if @api_key

      @rpc = RpcDo.connect(@base_url, headers: headers)
      @rpc
    end

    # Disconnect from the service
    def disconnect
      @rpc&.close
      @rpc = nil
    end
  end
end
