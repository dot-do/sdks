defmodule {{Name}}DoTest do
  use ExUnit.Case, async: true
  doctest {{Name}}Do

  describe "{{Name}}Do.Client" do
    test "starts with default options" do
      {:ok, client} = {{Name}}Do.Client.start_link()
      assert is_pid(client)
      refute {{Name}}Do.Client.connected?(client)
      :ok = {{Name}}Do.Client.stop(client)
    end

    test "starts with custom options" do
      {:ok, client} =
        {{Name}}Do.Client.start_link(
          api_key: "test-key",
          base_url: "https://test.{{name}}.do"
        )

      assert is_pid(client)
      :ok = {{Name}}Do.Client.stop(client)
    end
  end

  describe "{{Name}}Do.Error" do
    test "formats without code" do
      error = {{Name}}Do.Error.exception(message: "Test error")
      assert Exception.message(error) == "{{Name}}Do.Error: Test error"
    end

    test "formats with code" do
      error = {{Name}}Do.Error.exception(message: "Test error", code: "ERR001")
      assert Exception.message(error) == "{{Name}}Do.Error [ERR001]: Test error"
    end
  end
end
