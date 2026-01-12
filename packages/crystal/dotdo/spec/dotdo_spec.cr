# DotDo Platform SDK Spec Tests
require "spec"
require "../src/dotdo"

describe DotDo do
  describe "Config" do
    it "creates with defaults" do
      config = DotDo::Config.new
      config.endpoint.should eq("wss://api.dotdo.io")
      config.pool_size.should eq(10)
      config.max_retries.should eq(3)
    end

    it "creates with custom values" do
      config = DotDo::Config.new(
        endpoint: "wss://custom.api.io",
        api_key: "test_key",
        api_secret: "test_secret",
        pool_size: 5
      )
      config.endpoint.should eq("wss://custom.api.io")
      config.api_key.should eq("test_key")
      config.pool_size.should eq(5)
    end
  end

  describe "Auth::Token" do
    it "detects expired tokens" do
      token = DotDo::Auth::Token.new(
        access_token: "test",
        expires_at: Time.utc - 1.hour
      )
      token.expired?.should be_true
    end

    it "detects valid tokens" do
      token = DotDo::Auth::Token.new(
        access_token: "test",
        expires_at: Time.utc + 1.hour
      )
      token.expired?.should be_false
    end

    it "detects tokens expiring soon" do
      token = DotDo::Auth::Token.new(
        access_token: "test",
        expires_at: Time.utc + 2.minutes
      )
      token.expires_soon?(5.minutes).should be_true
    end

    it "generates authorization header" do
      token = DotDo::Auth::Token.new(
        access_token: "abc123",
        token_type: "Bearer"
      )
      token.authorization_header.should eq("Bearer abc123")
    end
  end

  describe "Auth::ApiKeyCredentials" do
    it "authenticates with API key" do
      creds = DotDo::Auth::ApiKeyCredentials.new("key", "secret")
      token = creds.authenticate("wss://api.dotdo.io")
      token.token_type.should eq("ApiKey")
      token.expired?.should be_false
    end
  end

  describe "Retry::Strategy" do
    it "calculates delay with exponential backoff" do
      strategy = DotDo::Retry::Strategy.new(
        initial_delay: 1.second,
        backoff_multiplier: 2.0
      )

      strategy.delay_for_attempt(0).should eq(1.second)
      strategy.delay_for_attempt(1).should eq(2.seconds)
      strategy.delay_for_attempt(2).should eq(4.seconds)
    end

    it "clamps delay to max" do
      strategy = DotDo::Retry::Strategy.new(
        initial_delay: 10.seconds,
        backoff_multiplier: 2.0,
        max_delay: 30.seconds
      )

      strategy.delay_for_attempt(5).should eq(30.seconds)
    end

    it "determines retryable errors" do
      strategy = DotDo::Retry::Strategy.new(max_retries: 3)

      # Retryable error
      error = DotDo::RpcError.new("UNAVAILABLE", "Service unavailable")
      strategy.should_retry?(error, 0).should be_true

      # Not retryable
      error2 = DotDo::RpcError.new("INVALID_ARGUMENT", "Bad request")
      strategy.should_retry?(error2, 0).should be_false

      # Max retries exceeded
      strategy.should_retry?(error, 3).should be_false
    end
  end

  describe "Retry.with_retry" do
    it "retries on failure" do
      attempts = 0
      result = DotDo::Retry.with_retry(DotDo::Retry::Strategy.new(max_retries: 3, initial_delay: 10.milliseconds)) do
        attempts += 1
        if attempts < 3
          raise DotDo::ConnectionError.new("Connection failed")
        end
        "success"
      end

      result.should eq("success")
      attempts.should eq(3)
    end

    it "gives up after max retries" do
      strategy = DotDo::Retry::Strategy.new(max_retries: 2, initial_delay: 10.milliseconds)

      expect_raises(DotDo::ConnectionError) do
        DotDo::Retry.with_retry(strategy) do
          raise DotDo::ConnectionError.new("Connection failed")
        end
      end
    end
  end

  describe "Client" do
    it "creates with endpoint" do
      client = DotDo::Client.new(endpoint: "wss://test.api.io")
      client.close
    end

    it "creates with full options" do
      client = DotDo::Client.new(
        endpoint: "wss://test.api.io",
        api_key: "key",
        api_secret: "secret",
        pool_size: 5,
        max_retries: 5
      )
      client.close
    end
  end

  describe "module helpers" do
    it "connects with block" do
      called = false
      DotDo.connect("wss://test.api.io") do |client|
        called = true
        client.should be_a(DotDo::Client)
      end
      called.should be_true
    end
  end
end
