import unittest
import std/[options]
import {{name}}_do

suite "{{Name}}Client":
  test "creates with default options":
    let client = new{{Name}}Client()
    check client.baseUrl == "https://{{name}}.do"

  test "creates with custom base URL":
    let client = new{{Name}}Client(baseUrl = "https://custom.{{name}}.do")
    check client.baseUrl == "https://custom.{{name}}.do"

  test "accepts API key":
    let client = new{{Name}}Client(apiKey = "test-key")
    check client != nil

  test "creates with options object":
    let opts = new{{Name}}ClientOptions(
      apiKey = some("test-key"),
      baseUrl = "https://test.{{name}}.do"
    )
    let client = new{{Name}}Client(opts)
    check client.baseUrl == "https://test.{{name}}.do"

  test "not connected initially":
    let client = new{{Name}}Client()
    check not client.connected

suite "{{Name}}Error":
  test "creates with message":
    let err = new{{Name}}Error("Something went wrong")
    check err.msg == "Something went wrong"

  test "creates with code":
    let err = new{{Name}}Error("Auth failed", code = some("AUTH_ERROR"))
    check err.code.get == "AUTH_ERROR"
