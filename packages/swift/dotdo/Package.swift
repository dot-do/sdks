// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "DotDo",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "DotDo",
            targets: ["DotDo"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "DotDo",
            dependencies: []
        ),
        .testTarget(
            name: "DotDoTests",
            dependencies: ["DotDo"]
        ),
    ]
)
