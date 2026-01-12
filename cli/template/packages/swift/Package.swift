// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "{{Name}}Do",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    products: [
        .library(
            name: "{{Name}}Do",
            targets: ["{{Name}}Do"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/dot-do/rpc-swift.git", from: "0.1.0"),
    ],
    targets: [
        .target(
            name: "{{Name}}Do",
            dependencies: [
                .product(name: "RpcDo", package: "rpc-swift"),
            ],
            path: "Sources/{{Name}}Do"
        ),
        .testTarget(
            name: "{{Name}}DoTests",
            dependencies: ["{{Name}}Do"],
            path: "Tests/{{Name}}DoTests"
        ),
    ]
)
