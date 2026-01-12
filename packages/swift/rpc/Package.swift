// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "DotDoRpc",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "DotDoRpc",
            targets: ["DotDoRpc"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "DotDoRpc",
            dependencies: []
        ),
        .testTarget(
            name: "DotDoRpcTests",
            dependencies: ["DotDoRpc"]
        ),
    ]
)
