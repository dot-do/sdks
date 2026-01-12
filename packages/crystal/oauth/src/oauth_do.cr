# OAuth device flow SDK for .do APIs.

require "http/client"
require "json"
require "./oauth_do/device"
require "./oauth_do/storage"

module OAuthDo
  VERSION = "0.1.0"

  DEFAULT_CLIENT_ID = "client_01JQYTRXK9ZPD8JPJTKDCRB656"

  # OAuth client for device flow authentication.
  class Client
    @client_id : String
    @device_flow : DeviceFlow
    @storage : Storage

    def initialize(@client_id : String = DEFAULT_CLIENT_ID)
      @device_flow = DeviceFlow.new(@client_id)
      @storage = Storage.new
    end

    # Initiates device authorization flow.
    def authorize_device(scope : String = "openid profile email") : DeviceAuthResponse
      @device_flow.authorize(scope)
    end

    # Polls for tokens after user authorizes the device.
    def poll_for_tokens(device_code : String, interval : Int32, expires_in : Int32) : TokenResponse
      tokens = @device_flow.poll_for_tokens(device_code, interval, expires_in)
      @storage.save_tokens(tokens)
      tokens
    end

    # Gets current user info using stored or provided access token.
    def get_user(access_token : String? = nil) : JSON::Any
      token = access_token || @storage.get_access_token
      raise "No access token available" if token.nil?
      @device_flow.get_user_info(token)
    end

    # Interactive login flow.
    def login(scope : String = "openid profile email") : TokenResponse
      device_info = authorize_device(scope)

      puts "\nTo sign in, visit: #{device_info.verification_uri}"
      puts "And enter code: #{device_info.user_code}\n"

      poll_for_tokens(
        device_info.device_code,
        device_info.interval || 5,
        device_info.expires_in || 900
      )
    end

    # Logs out by removing stored tokens.
    def logout
      @storage.delete_tokens
    end

    # Checks if tokens exist.
    def has_tokens? : Bool
      @storage.has_tokens?
    end
  end
end
