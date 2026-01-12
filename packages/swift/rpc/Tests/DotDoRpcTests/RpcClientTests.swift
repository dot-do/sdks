import XCTest
@testable import DotDoRpc

final class RpcClientTests: XCTestCase {

    func testRpcValueFromInt() {
        let value = RpcValue.from(42)
        XCTAssertEqual(value, .int(42))
    }

    func testRpcValueFromString() {
        let value = RpcValue.from("hello")
        XCTAssertEqual(value, .string("hello"))
    }

    func testRpcValueFromBool() {
        let value = RpcValue.from(true)
        XCTAssertEqual(value, .bool(true))
    }

    func testRpcValueFromNull() {
        let value = RpcValue.from(nil)
        XCTAssertEqual(value, .null)
    }

    func testRpcValueFromArray() {
        let value = RpcValue.from([1, 2, 3])
        XCTAssertEqual(value, .array([.int(1), .int(2), .int(3)]))
    }

    func testRpcValueFromDictionary() {
        let value = RpcValue.from(["key": "value"])
        XCTAssertEqual(value, .object(["key": .string("value")]))
    }

    func testRpcValueAsAny() {
        let value = RpcValue.int(42)
        XCTAssertEqual(value.asAny as? Int, 42)
    }

    func testRpcRequestEncoding() throws {
        let request = RpcRequest(id: "test-1", method: "echo", params: [.string("hello")])
        let encoder = JSONEncoder()
        let data = try encoder.encode(request)

        XCTAssertFalse(data.isEmpty)
    }

    func testRpcResponseDecoding() throws {
        let json = """
        {"id": "test-1", "result": {"value": 42}}
        """
        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let response = try decoder.decode(RpcResponse.self, from: data)

        XCTAssertEqual(response.id, "test-1")
        XCTAssertNotNil(response.result)
    }

    func testClientConfiguration() {
        let config = RpcClientConfiguration(
            url: URL(string: "wss://api.example.com")!,
            timeout: 60.0,
            maxRetries: 5,
            retryBaseDelay: 0.5,
            maxRetryDelay: 30.0,
            headers: ["Authorization": "Bearer token"]
        )

        XCTAssertEqual(config.url.absoluteString, "wss://api.example.com")
        XCTAssertEqual(config.timeout, 60.0)
        XCTAssertEqual(config.maxRetries, 5)
        XCTAssertEqual(config.retryBaseDelay, 0.5)
        XCTAssertEqual(config.maxRetryDelay, 30.0)
        XCTAssertEqual(config.headers["Authorization"], "Bearer token")
    }

    func testRpcRefExpressionString() async throws {
        let client = try RpcClient(url: "wss://api.example.com")

        let ref: RpcRef<Any> = client.api.users.profile
        XCTAssertTrue(ref.expressionString.contains("users"))
        XCTAssertTrue(ref.expressionString.contains("profile"))
    }

    func testRpcRefMapExpression() async throws {
        let client = try RpcClient(url: "wss://api.example.com")

        // Using Swift trailing closure syntax: .map { x in ... }
        let baseRef: RpcRef<[Int]> = client.api.numbers
        let mappedRef: RpcRef<[RpcRef<Int>]> = baseRef.map { x in
            client.api.square
        }

        XCTAssertTrue(mappedRef.expressionString.contains("numbers"))
        XCTAssertTrue(mappedRef.expressionString.contains("map"))
    }

    func testSDKVersion() {
        XCTAssertFalse(version.isEmpty)
    }
}
