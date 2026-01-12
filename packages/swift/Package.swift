// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "CapnWeb",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "CapnWeb",
            targets: ["CapnWeb"]
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
            name: "CapnWeb",
            dependencies: []
        ),
        .testTarget(
            name: "CapnWebTests",
            dependencies: [
                "CapnWeb",
                "Yams",
                .product(name: "Testing", package: "swift-testing"),
            ]
        ),
    ]
)
