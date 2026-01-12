rootProject.name = "dotdo-core"

// Include sibling modules for local development
includeBuild("../rpc") {
    dependencySubstitution {
        substitute(module("com.dotdo:rpc")).using(project(":"))
    }
}

includeBuild("../capnweb") {
    dependencySubstitution {
        substitute(module("com.dotdo:capnweb")).using(project(":"))
    }
}
