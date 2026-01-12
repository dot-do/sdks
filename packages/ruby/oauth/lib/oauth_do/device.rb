# frozen_string_literal: true

require "net/http"
require "uri"
require "json"
require_relative "types"
require_relative "config"

module OAuthDo
  module Device
    class << self
      # Initiate device authorization flow
      #
      # @param client_id [String, nil] OAuth client ID (uses config default if nil)
      # @param scopes [Array<String>, nil] OAuth scopes (uses config default if nil)
      # @return [DeviceAuthorization] Device authorization details
      # @raise [DeviceAuthError] if authorization request fails
      def authorize_device(client_id: nil, scopes: nil)
        config = OAuthDo.get_config
        client_id ||= config.client_id
        scopes ||= config.scopes

        uri = URI(config.auth_endpoint)

        body = {
          client_id: client_id,
          scope: scopes.join(" ")
        }

        response = make_request(uri, body)

        unless response.is_a?(Net::HTTPSuccess)
          error_data = parse_error_response(response)
          raise DeviceAuthError.new(
            error_data[:message] || "Device authorization failed",
            error_data[:code]
          )
        end

        data = JSON.parse(response.body)

        DeviceAuthorization.new(
          device_code: data["device_code"],
          user_code: data["user_code"],
          verification_uri: data["verification_uri"],
          verification_uri_complete: data["verification_uri_complete"],
          expires_in: data["expires_in"],
          interval: data["interval"] || 5
        )
      rescue JSON::ParserError => e
        raise DeviceAuthError.new("Invalid response from server: #{e.message}")
      rescue StandardError => e
        raise DeviceAuthError.new(e.message) unless e.is_a?(DeviceAuthError)
        raise
      end

      # Poll for tokens after user completes authorization
      #
      # @param device_code [String] Device code from authorize_device
      # @param client_id [String, nil] OAuth client ID (uses config default if nil)
      # @param interval [Integer] Polling interval in seconds (default: 5)
      # @param timeout [Integer] Maximum time to wait in seconds (default: 300)
      # @param on_pending [Proc, nil] Callback for pending status
      # @return [TokenResponse] Access and refresh tokens
      # @raise [TokenPollError] if polling fails or times out
      def poll_for_tokens(device_code:, client_id: nil, interval: 5, timeout: 300, on_pending: nil)
        config = OAuthDo.get_config
        client_id ||= config.client_id

        uri = URI(config.token_endpoint)
        start_time = Time.now
        current_interval = interval

        loop do
          elapsed = Time.now - start_time
          if elapsed >= timeout
            raise TokenPollError.new("Authorization timed out", "timeout")
          end

          body = {
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: device_code,
            client_id: client_id
          }

          response = make_request(uri, body)

          if response.is_a?(Net::HTTPSuccess)
            data = JSON.parse(response.body)
            return TokenResponse.new(
              access_token: data["access_token"],
              refresh_token: data["refresh_token"],
              expires_in: data["expires_in"],
              token_type: data["token_type"] || "Bearer",
              scope: data["scope"]
            )
          end

          error_data = parse_error_response(response)
          error_code = error_data[:code]

          case error_code
          when "authorization_pending"
            on_pending&.call
            sleep(current_interval)
          when "slow_down"
            current_interval += 5
            sleep(current_interval)
          when "expired_token"
            raise TokenPollError.new("Device code has expired", error_code)
          when "access_denied"
            raise TokenPollError.new("Authorization was denied by the user", error_code)
          else
            raise TokenPollError.new(
              error_data[:message] || "Token polling failed",
              error_code
            )
          end
        end
      rescue JSON::ParserError => e
        raise TokenPollError.new("Invalid response from server: #{e.message}")
      rescue StandardError => e
        raise TokenPollError.new(e.message) unless e.is_a?(TokenPollError)
        raise
      end

      private

      def make_request(uri, body)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = uri.scheme == "https"
        http.open_timeout = 10
        http.read_timeout = 30

        request = Net::HTTP::Post.new(uri)
        request["Content-Type"] = "application/json"
        request["Accept"] = "application/json"
        request.body = JSON.generate(body)

        http.request(request)
      end

      def parse_error_response(response)
        data = JSON.parse(response.body)
        {
          code: data["error"],
          message: data["error_description"] || data["message"]
        }
      rescue JSON::ParserError
        {
          code: "unknown",
          message: "Request failed with status #{response.code}"
        }
      end
    end
  end
end
