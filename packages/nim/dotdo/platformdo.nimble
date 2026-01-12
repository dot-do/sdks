# Package

version       = "0.1.0"
author        = "DotDo Team"
description   = "DotDo Platform SDK for Nim - authentication, connection pooling, and retry logic"
license       = "MIT"
srcDir        = "src"
bin           = @[]

# Dependencies

requires "nim >= 2.0.0"
requires "ws >= 0.5.0"

# Local dependencies (when published, these would be nimble packages)
# requires "rpcdo >= 0.1.0"
# requires "capnwebdo >= 0.1.0"

# Tasks

task test, "Run tests":
  exec "nim c -r tests/test_dotdo.nim"

task docs, "Generate documentation":
  exec "nim doc --project --index:on src/platformdo.nim"
