require "./spec_helper"

describe {{Name}}Do::Client do
  describe "#initialize" do
    it "creates with default options" do
      client = {{Name}}Do::Client.new
      client.connected?.should be_false
      client.options.base_url.should eq "https://{{name}}.do"
      client.options.api_key.should be_nil
    end

    it "creates with custom options" do
      client = {{Name}}Do::Client.new(
        api_key: "test-key",
        base_url: "https://test.{{name}}.do"
      )
      client.options.api_key.should eq "test-key"
      client.options.base_url.should eq "https://test.{{name}}.do"
    end
  end

  describe "#rpc" do
    it "raises when not connected" do
      client = {{Name}}Do::Client.new
      expect_raises({{Name}}Do::Error, /not connected/) do
        client.rpc
      end
    end
  end
end

describe {{Name}}Do::Error do
  it "formats without code" do
    error = {{Name}}Do::Error.new("Test error")
    error.to_s.should eq "{{Name}}Do::Error: Test error"
  end

  it "formats with code" do
    error = {{Name}}Do::Error.new("Test error", code: "ERR001")
    error.to_s.should eq "{{Name}}Do::Error [ERR001]: Test error"
  end
end
