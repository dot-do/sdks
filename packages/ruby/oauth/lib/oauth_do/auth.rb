# frozen_string_literal: true

require "net/http"
require "uri"
require "json"
require_relative "types"
require_relative "config"
require_relative "storage"
require_relative "device"

module OAuthDo
  module Auth
    class << self
      # Perform device authorization flow and store tokens
      #
      # @param storage [FileStorage, nil] Storage instance (creates default if nil)
      # @param client_id [String, nil] OAuth client ID
      # @param scopes [Array<String>, nil] OAuth scopes
      # @param on_user_code [Proc, nil] Callback when user code is available
      # @param on_pending [Proc, nil] Callback during polling
      # @return [AuthData] Stored authentication data
      # @raise [AuthenticationError] if authentication fails
      def auth(storage: nil, client_id: nil, scopes: nil, on_user_code: nil, on_pending: nil)
        storage ||= OAuthDo.create_secure_storage

        # Start device authorization
        device_auth = Device.authorize_device(client_id: client_id, scopes: scopes)

        # Notify caller of user code
        on_user_code&.call(device_auth)

        # Poll for tokens
        token_response = Device.poll_for_tokens(
          device_code: device_auth.device_code,
          client_id: client_id,
          interval: device_auth.interval,
          on_pending: on_pending
        )

        # Calculate expiration time
        expires_at = token_response.expires_in ? Time.now.to_i + token_response.expires_in : nil

        # Create auth data
        auth_data = AuthData.new(
          access_token: token_response.access_token,
          refresh_token: token_response.refresh_token,
          expires_at: expires_at,
          token_type: token_response.token_type,
          scope: token_response.scope
        )

        # Store tokens
        storage.store(auth_data)

        auth_data
      rescue DeviceAuthError, TokenPollError => e
        raise AuthenticationError, e.message
      end

      # Log out by removing stored tokens
      #
      # @param storage [FileStorage, nil] Storage instance (creates default if nil)
      # @return [Boolean] true if tokens were removed
      def logout(storage: nil)
        storage ||= OAuthDo.create_secure_storage
        storage.delete
      end

      # Get current user information
      #
      # @param storage [FileStorage, nil] Storage instance (creates default if nil)
      # @return [UserInfo, nil] User information, or nil if not authenticated
      # @raise [AuthenticationError] if request fails
      def get_user(storage: nil)
        storage ||= OAuthDo.create_secure_storage

        auth_data = storage.load
        return nil unless auth_data&.access_token

        config = OAuthDo.get_config
        uri = URI(config.user_info_endpoint)

        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = uri.scheme == "https"
        http.open_timeout = 10
        http.read_timeout = 30

        request = Net::HTTP::Get.new(uri)
        request["Authorization"] = "#{auth_data.token_type || 'Bearer'} #{auth_data.access_token}"
        request["Accept"] = "application/json"

        response = http.request(request)

        unless response.is_a?(Net::HTTPSuccess)
          if response.code.to_i == 401
            return nil
          end
          raise AuthenticationError, "Failed to get user info: #{response.code}"
        end

        data = JSON.parse(response.body)

        # Handle nested user object if present
        user_data = data["user"] || data

        UserInfo.new(
          id: user_data["id"],
          email: user_data["email"],
          name: user_data["name"],
          email_verified: user_data["email_verified"] || user_data["emailVerified"],
          profile_picture_url: user_data["profile_picture_url"] || user_data["profilePictureUrl"],
          first_name: user_data["first_name"] || user_data["firstName"],
          last_name: user_data["last_name"] || user_data["lastName"],
          created_at: user_data["created_at"] || user_data["createdAt"],
          updated_at: user_data["updated_at"] || user_data["updatedAt"]
        )
      rescue JSON::ParserError => e
        raise AuthenticationError, "Invalid response from server: #{e.message}"
      rescue StandardError => e
        raise AuthenticationError, e.message unless e.is_a?(AuthenticationError)
        raise
      end

      # Get the current access token if authenticated
      #
      # @param storage [FileStorage, nil] Storage instance (creates default if nil)
      # @return [String, nil] Access token, or nil if not authenticated
      def get_token(storage: nil)
        storage ||= OAuthDo.create_secure_storage
        auth_data = storage.load
        auth_data&.access_token
      end

      # Get the current authentication status
      #
      # @param storage [FileStorage, nil] Storage instance (creates default if nil)
      # @return [Hash] Status information
      def get_status(storage: nil)
        storage ||= OAuthDo.create_secure_storage
        auth_data = storage.load

        if auth_data.nil?
          return {
            authenticated: false,
            message: "Not authenticated"
          }
        end

        {
          authenticated: true,
          expired: auth_data.expired?,
          expires_at: auth_data.expires_at ? Time.at(auth_data.expires_at).iso8601 : nil,
          token_type: auth_data.token_type,
          scope: auth_data.scope,
          has_refresh_token: !auth_data.refresh_token.nil?
        }
      end
    end
  end
end
