# frozen_string_literal: true

require_relative "oauth_do/version"
require_relative "oauth_do/types"
require_relative "oauth_do/config"
require_relative "oauth_do/storage"
require_relative "oauth_do/device"
require_relative "oauth_do/auth"
require_relative "oauth_do/cli"

module OAuthDo
  class << self
    # Convenience method to start authentication
    #
    # @param options [Hash] Options to pass to Auth.auth
    # @return [AuthData] Stored authentication data
    def login(**options)
      Auth.auth(**options)
    end

    # Convenience method to log out
    #
    # @param options [Hash] Options to pass to Auth.logout
    # @return [Boolean] true if tokens were removed
    def logout(**options)
      Auth.logout(**options)
    end

    # Convenience method to get current user
    #
    # @param options [Hash] Options to pass to Auth.get_user
    # @return [UserInfo, nil] User information
    def whoami(**options)
      Auth.get_user(**options)
    end

    # Convenience method to get access token
    #
    # @param options [Hash] Options to pass to Auth.get_token
    # @return [String, nil] Access token
    def token(**options)
      Auth.get_token(**options)
    end

    # Convenience method to get authentication status
    #
    # @param options [Hash] Options to pass to Auth.get_status
    # @return [Hash] Status information
    def status(**options)
      Auth.get_status(**options)
    end
  end
end
