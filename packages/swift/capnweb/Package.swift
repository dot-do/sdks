// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "DotDoCapnWeb",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "DotDoCapnWeb",
            targets: ["DotDoCapnWeb"]
        ),
    ],
    dependencies: [
        // YAML parsing for conformance test specs
        .package(url: "https://github.com/jpsim/Yams.git", from: "5.0.0"),
        // Swift Testing framework
        .package(url: "https://github.com/apple/swift-testing.git", branch: "main"),
    ],
    targets: [
        .target(
            name: "DotDoCapnWeb",
            dependencies: []
        ),
        .testTarget(
            name: "DotDoCapnWebTests",
            dependencies: [
                "DotDoCapnWeb",
                "Yams",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ]
)
