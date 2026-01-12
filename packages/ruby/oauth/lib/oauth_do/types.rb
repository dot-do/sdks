# frozen_string_literal: true

module OAuthDo
  # Device authorization response from the OAuth server
  DeviceAuthorization = Struct.new(
    :device_code,
    :user_code,
    :verification_uri,
    :verification_uri_complete,
    :expires_in,
    :interval,
    keyword_init: true
  )

  # Token response from the OAuth server
  TokenResponse = Struct.new(
    :access_token,
    :refresh_token,
    :expires_in,
    :token_type,
    :scope,
    keyword_init: true
  )

  # Stored authentication data
  AuthData = Struct.new(
    :access_token,
    :refresh_token,
    :expires_at,
    :token_type,
    :scope,
    keyword_init: true
  ) do
    def expired?
      return false unless expires_at
      Time.now.to_i >= expires_at
    end

    def to_h
      {
        access_token: access_token,
        refresh_token: refresh_token,
        expires_at: expires_at,
        token_type: token_type,
        scope: scope
      }
    end
  end

  # User information from the API
  UserInfo = Struct.new(
    :id,
    :email,
    :name,
    :email_verified,
    :profile_picture_url,
    :first_name,
    :last_name,
    :created_at,
    :updated_at,
    keyword_init: true
  )

  # OAuth configuration
  OAuthConfig = Struct.new(
    :client_id,
    :authkit_domain,
    :auth_endpoint,
    :token_endpoint,
    :user_info_endpoint,
    :scopes,
    keyword_init: true
  )

  # Device authorization error
  class DeviceAuthError < StandardError
    attr_reader :error_code

    def initialize(message, error_code = nil)
      super(message)
      @error_code = error_code
    end
  end

  # Token polling error
  class TokenPollError < StandardError
    attr_reader :error_code

    def initialize(message, error_code = nil)
      super(message)
      @error_code = error_code
    end
  end

  # Authentication error
  class AuthenticationError < StandardError; end

  # Storage error
  class StorageError < StandardError; end
end
