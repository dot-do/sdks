rootProject.name = "dotdo-core"

include(":rpc")
include(":capnweb")

project(":rpc").projectDir = file("../rpc")
project(":capnweb").projectDir = file("../capnweb")
