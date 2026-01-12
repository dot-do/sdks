# Package

version       = "0.1.0"
author        = "DotDo Team"
description   = "DotDo RPC client for Nim - type-safe RPC with remap support"
license       = "MIT"
srcDir        = "src"
bin           = @[]

# Dependencies

requires "nim >= 2.0.0"
requires "ws >= 0.5.0"

# Tasks

task test, "Run tests":
  exec "nim c -r tests/test_rpc.nim"

task docs, "Generate documentation":
  exec "nim doc --project --index:on src/rpcdo.nim"
