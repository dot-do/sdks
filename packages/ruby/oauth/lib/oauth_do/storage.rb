# frozen_string_literal: true

require "json"
require "fileutils"
require_relative "types"

module OAuthDo
  # File-based token storage with secure permissions
  class FileStorage
    DEFAULT_PATH = File.expand_path("~/.oauth.do/token")
    SECURE_PERMISSIONS = 0o600
    DIR_PERMISSIONS = 0o700

    attr_reader :path

    # Create a new FileStorage instance
    #
    # @param path [String] Path to the token file (default: ~/.oauth.do/token)
    def initialize(path: DEFAULT_PATH)
      @path = path
    end

    # Store authentication data securely
    #
    # @param auth_data [AuthData] The authentication data to store
    # @return [Boolean] true if successful
    # @raise [StorageError] if storage fails
    def store(auth_data)
      ensure_directory_exists

      data = auth_data.to_h.transform_keys(&:to_s)

      File.write(@path, JSON.pretty_generate(data))
      File.chmod(SECURE_PERMISSIONS, @path)

      true
    rescue StandardError => e
      raise StorageError, "Failed to store token: #{e.message}"
    end

    # Load authentication data from storage
    #
    # @return [AuthData, nil] The stored authentication data, or nil if not found
    # @raise [StorageError] if loading fails (other than file not found)
    def load
      return nil unless File.exist?(@path)

      data = JSON.parse(File.read(@path))

      AuthData.new(
        access_token: data["access_token"],
        refresh_token: data["refresh_token"],
        expires_at: data["expires_at"],
        token_type: data["token_type"],
        scope: data["scope"]
      )
    rescue JSON::ParserError => e
      raise StorageError, "Invalid token file format: #{e.message}"
    rescue StandardError => e
      raise StorageError, "Failed to load token: #{e.message}"
    end

    # Delete stored authentication data
    #
    # @return [Boolean] true if deleted, false if file didn't exist
    def delete
      return false unless File.exist?(@path)

      File.delete(@path)
      true
    rescue StandardError => e
      raise StorageError, "Failed to delete token: #{e.message}"
    end

    # Check if authentication data exists
    #
    # @return [Boolean] true if token file exists
    def exists?
      File.exist?(@path)
    end

    private

    def ensure_directory_exists
      dir = File.dirname(@path)
      return if Dir.exist?(dir)

      FileUtils.mkdir_p(dir)
      File.chmod(DIR_PERMISSIONS, dir)
    end
  end

  # Create a secure storage instance
  #
  # @param path [String, nil] Optional custom path for token storage
  # @return [FileStorage] A configured storage instance
  def self.create_secure_storage(path: nil)
    FileStorage.new(path: path || FileStorage::DEFAULT_PATH)
  end
end
