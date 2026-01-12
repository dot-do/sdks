require "./spec_helper"

describe {{Name}}Do::Client do
  describe "#initialize" do
    it "creates with default options" do
      client = {{Name}}Do::Client.new
      client.base_url.should eq "https://{{name}}.do"
    end

    it "creates with custom base URL" do
      client = {{Name}}Do::Client.new(base_url: "https://custom.{{name}}.do")
      client.base_url.should eq "https://custom.{{name}}.do"
    end

    it "accepts API key" do
      client = {{Name}}Do::Client.new(api_key: "test-key")
      client.should be_a({{Name}}Do::Client)
    end

    it "creates with options struct" do
      options = {{Name}}Do::ClientOptions.new(
        api_key: "test-key",
        base_url: "https://test.{{name}}.do"
      )
      client = {{Name}}Do::Client.new(options)
      client.base_url.should eq "https://test.{{name}}.do"
    end
  end

  describe "#connected?" do
    it "returns false when not connected" do
      client = {{Name}}Do::Client.new
      client.connected?.should be_false
    end
  end
end

describe {{Name}}Do::{{Name}}Error do
  it "creates with message" do
    error = {{Name}}Do::{{Name}}Error.new("Something went wrong")
    error.message.should eq "Something went wrong"
  end

  it "creates with code and details" do
    error = {{Name}}Do::{{Name}}Error.new(
      "Auth failed",
      code: "AUTH_ERROR"
    )
    error.code.should eq "AUTH_ERROR"
  end
end
