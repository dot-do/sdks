# Package

version       = "0.1.0"
author        = "DotDo Team"
description   = "DotDo Cap'n Web RPC client for Nim - capability-based RPC with pipelining"
license       = "MIT"
srcDir        = "src"
bin           = @[]

# Dependencies

requires "nim >= 2.0.0"
requires "yaml >= 2.0.0"
requires "ws >= 0.5.0"

# unittest is built-in to Nim stdlib

# Tasks

task test, "Run conformance tests":
  exec "nim c -r tests/test_conformance.nim"

task conformance, "Run conformance tests with server":
  exec "nim c -r -d:release tests/test_conformance.nim"

task docs, "Generate documentation":
  exec "nim doc --project --index:on src/capnwebdo.nim"
