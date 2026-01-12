# Package
version       = "0.1.0"
author        = "DotDo"
description   = "{{description}}"
license       = "MIT"
srcDir        = "src"
bin           = @[]

# Dependencies
requires "nim >= 2.0.0"
requires "rpc_do >= 0.1.0"
requires "ws >= 0.5.0"
requires "jsony >= 1.1.5"
requires "asynctools >= 0.1.1"

# Tasks
task test, "Run tests":
  exec "nim c -r tests/test_client.nim"
