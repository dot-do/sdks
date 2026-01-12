# frozen_string_literal: true

require "optparse"
require "json"
require_relative "auth"
require_relative "version"

module OAuthDo
  class CLI
    COMMANDS = %w[login logout whoami token status help version].freeze

    def initialize(args)
      @args = args
      @options = {}
    end

    def run
      command = @args.shift || "help"

      case command
      when "login"
        login
      when "logout"
        logout
      when "whoami"
        whoami
      when "token"
        token
      when "status"
        status
      when "help", "-h", "--help"
        help
      when "version", "-v", "--version"
        version
      else
        puts "Unknown command: #{command}"
        puts "Run 'oauth-do help' for usage information."
        exit 1
      end
    end

    private

    def login
      parse_options do |opts|
        opts.banner = "Usage: oauth-do login [options]"
        opts.on("--client-id ID", "OAuth client ID") { |v| @options[:client_id] = v }
        opts.on("--scopes SCOPES", "OAuth scopes (comma-separated)") { |v| @options[:scopes] = v.split(",") }
        opts.on("--json", "Output as JSON") { @options[:json] = true }
      end

      puts "Starting device authorization flow..." unless @options[:json]

      begin
        auth_data = Auth.auth(
          client_id: @options[:client_id],
          scopes: @options[:scopes],
          on_user_code: lambda { |device_auth|
            if @options[:json]
              puts JSON.generate({
                event: "user_code",
                user_code: device_auth.user_code,
                verification_uri: device_auth.verification_uri,
                verification_uri_complete: device_auth.verification_uri_complete
              })
            else
              puts ""
              puts "Please visit: #{device_auth.verification_uri_complete || device_auth.verification_uri}"
              puts "And enter code: #{device_auth.user_code}" if device_auth.verification_uri_complete.nil?
              puts ""
              puts "Waiting for authorization..."
            end
          },
          on_pending: lambda {
            print "." unless @options[:json]
          }
        )

        puts "" unless @options[:json]

        if @options[:json]
          puts JSON.generate({
            success: true,
            expires_at: auth_data.expires_at ? Time.at(auth_data.expires_at).iso8601 : nil
          })
        else
          puts "Successfully authenticated!"
          if auth_data.expires_at
            puts "Token expires at: #{Time.at(auth_data.expires_at)}"
          end
        end
      rescue AuthenticationError => e
        if @options[:json]
          puts JSON.generate({ success: false, error: e.message })
        else
          puts "Authentication failed: #{e.message}"
        end
        exit 1
      end
    end

    def logout
      parse_options do |opts|
        opts.banner = "Usage: oauth-do logout [options]"
        opts.on("--json", "Output as JSON") { @options[:json] = true }
      end

      deleted = Auth.logout

      if @options[:json]
        puts JSON.generate({ success: true, was_logged_in: deleted })
      else
        if deleted
          puts "Successfully logged out."
        else
          puts "No active session found."
        end
      end
    end

    def whoami
      parse_options do |opts|
        opts.banner = "Usage: oauth-do whoami [options]"
        opts.on("--json", "Output as JSON") { @options[:json] = true }
      end

      begin
        user = Auth.get_user

        if user.nil?
          if @options[:json]
            puts JSON.generate({ authenticated: false })
          else
            puts "Not authenticated. Run 'oauth-do login' to authenticate."
          end
          exit 1
        end

        if @options[:json]
          puts JSON.generate({
            authenticated: true,
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              first_name: user.first_name,
              last_name: user.last_name,
              email_verified: user.email_verified,
              profile_picture_url: user.profile_picture_url
            }
          })
        else
          puts "Logged in as: #{user.email}"
          puts "  Name: #{user.name}" if user.name
          puts "  ID: #{user.id}" if user.id
          puts "  Email verified: #{user.email_verified ? 'Yes' : 'No'}" unless user.email_verified.nil?
        end
      rescue AuthenticationError => e
        if @options[:json]
          puts JSON.generate({ authenticated: false, error: e.message })
        else
          puts "Error: #{e.message}"
        end
        exit 1
      end
    end

    def token
      parse_options do |opts|
        opts.banner = "Usage: oauth-do token [options]"
        opts.on("--json", "Output as JSON") { @options[:json] = true }
      end

      access_token = Auth.get_token

      if access_token.nil?
        if @options[:json]
          puts JSON.generate({ authenticated: false })
        else
          puts "Not authenticated. Run 'oauth-do login' to authenticate."
        end
        exit 1
      end

      if @options[:json]
        puts JSON.generate({ token: access_token })
      else
        puts access_token
      end
    end

    def status
      parse_options do |opts|
        opts.banner = "Usage: oauth-do status [options]"
        opts.on("--json", "Output as JSON") { @options[:json] = true }
      end

      status_info = Auth.get_status

      if @options[:json]
        puts JSON.generate(status_info)
      else
        if status_info[:authenticated]
          puts "Status: Authenticated"
          puts "  Expired: #{status_info[:expired] ? 'Yes' : 'No'}"
          puts "  Expires at: #{status_info[:expires_at]}" if status_info[:expires_at]
          puts "  Token type: #{status_info[:token_type]}" if status_info[:token_type]
          puts "  Scopes: #{status_info[:scope]}" if status_info[:scope]
          puts "  Has refresh token: #{status_info[:has_refresh_token] ? 'Yes' : 'No'}"
        else
          puts "Status: Not authenticated"
          puts "Run 'oauth-do login' to authenticate."
        end
      end
    end

    def help
      puts <<~HELP
        oauth-do - OAuth.do CLI for device authorization flow

        Usage: oauth-do <command> [options]

        Commands:
          login     Start device authorization flow and authenticate
          logout    Remove stored authentication tokens
          whoami    Display current user information
          token     Output the current access token
          status    Show authentication status
          help      Show this help message
          version   Show version information

        Global Options:
          --json    Output in JSON format (available for all commands)

        Examples:
          oauth-do login                    # Start authentication
          oauth-do login --client-id ID     # Use custom client ID
          oauth-do whoami                   # Show current user
          oauth-do token                    # Get access token for scripts
          oauth-do status --json            # Check status in JSON format
          oauth-do logout                   # Log out

        For more information, visit: https://oauth.do
      HELP
    end

    def version
      puts "oauth-do #{OAuthDo::VERSION}"
    end

    def parse_options
      parser = OptionParser.new do |opts|
        yield opts if block_given?
        opts.on("-h", "--help", "Show this help") do
          puts opts
          exit
        end
      end
      parser.parse!(@args)
    rescue OptionParser::InvalidOption => e
      puts "Error: #{e.message}"
      puts "Run 'oauth-do help' for usage information."
      exit 1
    end
  end
end
