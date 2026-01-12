module OAuthDo
  AUTH_URL   = "https://auth.apis.do/user_management/authorize_device"
  TOKEN_URL  = "https://auth.apis.do/user_management/authenticate"
  USER_URL   = "https://apis.do/me"

  struct DeviceAuthResponse
    include JSON::Serializable

    @[JSON::Field(key: "device_code")]
    property device_code : String

    @[JSON::Field(key: "user_code")]
    property user_code : String

    @[JSON::Field(key: "verification_uri")]
    property verification_uri : String

    @[JSON::Field(key: "expires_in")]
    property expires_in : Int32?

    @[JSON::Field(key: "interval")]
    property interval : Int32?
  end

  struct TokenResponse
    include JSON::Serializable

    @[JSON::Field(key: "access_token")]
    property access_token : String

    @[JSON::Field(key: "refresh_token")]
    property refresh_token : String?

    @[JSON::Field(key: "token_type")]
    property token_type : String?

    @[JSON::Field(key: "expires_in")]
    property expires_in : Int32?
  end

  # Device flow authentication.
  class DeviceFlow
    @client_id : String

    def initialize(@client_id : String)
    end

    # Initiates device authorization.
    def authorize(scope : String = "openid profile email") : DeviceAuthResponse
      body = {
        "client_id" => @client_id,
        "scope"     => scope,
      }

      response = HTTP::Client.post(
        AUTH_URL,
        headers: HTTP::Headers{"Content-Type" => "application/json"},
        body: body.to_json
      )

      unless response.status_code == 200
        raise "Authorization failed: #{response.body}"
      end

      DeviceAuthResponse.from_json(response.body)
    end

    # Polls for tokens until user authorizes or timeout.
    def poll_for_tokens(device_code : String, interval : Int32, expires_in : Int32) : TokenResponse
      deadline = Time.monotonic + expires_in.seconds
      current_interval = interval

      loop do
        if Time.monotonic >= deadline
          raise "Authorization expired"
        end

        body = {
          "client_id"   => @client_id,
          "device_code" => device_code,
          "grant_type"  => "urn:ietf:params:oauth:grant-type:device_code",
        }

        response = HTTP::Client.post(
          TOKEN_URL,
          headers: HTTP::Headers{"Content-Type" => "application/json"},
          body: body.to_json
        )

        if response.status_code == 200
          return TokenResponse.from_json(response.body)
        end

        if response.status_code == 400
          json = JSON.parse(response.body)
          error = json["error"]?.try(&.as_s)

          case error
          when "authorization_pending"
            sleep(current_interval.seconds)
            next
          when "slow_down"
            current_interval += 5
            sleep(current_interval.seconds)
            next
          else
            raise "Token request failed: #{error}"
          end
        end

        raise "Unexpected response: #{response.status_code}"
      end
    end

    # Gets user info with access token.
    def get_user_info(access_token : String) : JSON::Any
      response = HTTP::Client.get(
        USER_URL,
        headers: HTTP::Headers{"Authorization" => "Bearer #{access_token}"}
      )

      unless response.status_code == 200
        raise "Failed to get user info: #{response.status_code}"
      end

      JSON.parse(response.body)
    end
  end
end
