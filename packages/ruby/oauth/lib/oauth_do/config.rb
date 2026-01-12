# frozen_string_literal: true

require_relative "types"

module OAuthDo
  # Default configuration values
  DEFAULT_CLIENT_ID = "client_01JQYTRXK9ZPD8JPJTKDCRB656"
  DEFAULT_AUTHKIT_DOMAIN = "login.oauth.do"
  DEFAULT_AUTH_ENDPOINT = "https://auth.apis.do/user_management/authorize_device"
  DEFAULT_TOKEN_ENDPOINT = "https://auth.apis.do/user_management/authenticate"
  DEFAULT_USER_INFO_ENDPOINT = "https://apis.do/me"
  DEFAULT_SCOPES = ["openid", "profile", "email"].freeze

  class << self
    attr_accessor :configuration

    # Configure the OAuth client
    #
    # @yield [OAuthConfig] Configuration object
    # @return [OAuthConfig] The configuration
    #
    # @example
    #   OAuthDo.configure do |config|
    #     config.client_id = "my_client_id"
    #     config.authkit_domain = "my-domain.oauth.do"
    #   end
    def configure
      self.configuration ||= OAuthConfig.new(
        client_id: DEFAULT_CLIENT_ID,
        authkit_domain: DEFAULT_AUTHKIT_DOMAIN,
        auth_endpoint: DEFAULT_AUTH_ENDPOINT,
        token_endpoint: DEFAULT_TOKEN_ENDPOINT,
        user_info_endpoint: DEFAULT_USER_INFO_ENDPOINT,
        scopes: DEFAULT_SCOPES.dup
      )
      yield(configuration) if block_given?
      configuration
    end

    # Get the current configuration
    #
    # @return [OAuthConfig] The current configuration
    def get_config
      configuration || configure
    end

    # Reset configuration to defaults
    #
    # @return [OAuthConfig] The reset configuration
    def reset_config!
      self.configuration = nil
      configure
    end
  end
end
