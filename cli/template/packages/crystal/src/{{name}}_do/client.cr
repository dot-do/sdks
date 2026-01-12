require "rpc_do"

module {{Name}}Do
  # Options for the {{Name}} client
  struct ClientOptions
    property api_key : String?
    property base_url : String

    def initialize(@api_key = nil, @base_url = "https://{{name}}.do")
    end
  end

  # {{Name}}.do SDK Client
  #
  # {{description}}
  #
  # Example:
  # ```crystal
  # client = {{Name}}Do::Client.new(api_key: "your-key")
  # client.connect
  # ```
  class Client
    @rpc : RpcDo::Client?
    @options : ClientOptions

    def initialize(api_key : String? = nil, base_url : String = "https://{{name}}.do")
      @options = ClientOptions.new(api_key: api_key, base_url: base_url)
      @rpc = nil
    end

    def initialize(@options : ClientOptions)
      @rpc = nil
    end

    # Connect to the {{name}}.do service
    def connect : RpcDo::Client
      @rpc ||= begin
        headers = HTTP::Headers.new
        if api_key = @options.api_key
          headers["Authorization"] = "Bearer #{api_key}"
        end
        RpcDo::Client.connect(@options.base_url, headers: headers)
      end
      @rpc.not_nil!
    end

    # Disconnect from the service
    def disconnect
      if rpc = @rpc
        rpc.close
        @rpc = nil
      end
    end

    # Get the base URL
    def base_url : String
      @options.base_url
    end

    # Check if connected
    def connected? : Bool
      !@rpc.nil?
    end
  end
end
