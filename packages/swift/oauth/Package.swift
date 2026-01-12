// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OAuthDo",
    platforms: [
        .macOS(.v12),
        .iOS(.v15),
        .tvOS(.v15),
        .watchOS(.v8)
    ],
    products: [
        .library(
            name: "OAuthDo",
            targets: ["OAuthDo"]
        ),
    ],
    targets: [
        .target(
            name: "OAuthDo",
            path: "Sources/OAuthDo"
        ),
        .testTarget(
            name: "OAuthDoTests",
            dependencies: ["OAuthDo"]
        ),
    ]
)
