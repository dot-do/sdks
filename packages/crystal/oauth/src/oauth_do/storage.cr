module OAuthDo
  # File-based token storage.
  class Storage
    TOKEN_DIR  = Path.home / ".oauth.do"
    TOKEN_FILE = TOKEN_DIR / "token"

    # Saves tokens to file storage.
    def save_tokens(tokens : TokenResponse)
      Dir.mkdir_p(TOKEN_DIR.to_s)

      File.write(TOKEN_FILE.to_s, tokens.to_json)
      File.chmod(TOKEN_FILE.to_s, 0o600)
    end

    # Loads tokens from file storage.
    def load_tokens : TokenResponse?
      return nil unless File.exists?(TOKEN_FILE.to_s)

      content = File.read(TOKEN_FILE.to_s)
      TokenResponse.from_json(content)
    rescue
      nil
    end

    # Gets the access token from storage.
    def get_access_token : String?
      load_tokens.try(&.access_token)
    end

    # Gets the refresh token from storage.
    def get_refresh_token : String?
      load_tokens.try(&.refresh_token)
    end

    # Deletes stored tokens.
    def delete_tokens
      File.delete(TOKEN_FILE.to_s) if File.exists?(TOKEN_FILE.to_s)
    end

    # Checks if tokens exist.
    def has_tokens? : Bool
      File.exists?(TOKEN_FILE.to_s)
    end
  end
end
