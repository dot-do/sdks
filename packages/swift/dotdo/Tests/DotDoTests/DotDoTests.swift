import XCTest
@testable import DotDo

final class DotDoTests: XCTestCase {

    // MARK: - Auth Tests

    func testAuthTokenNotExpired() {
        let token = AuthToken(
            accessToken: "test-token",
            expiresAt: Date().addingTimeInterval(3600)
        )
        XCTAssertFalse(token.isExpired)
    }

    func testAuthTokenExpired() {
        let token = AuthToken(
            accessToken: "test-token",
            expiresAt: Date().addingTimeInterval(-1)
        )
        XCTAssertTrue(token.isExpired)
    }

    func testAuthTokenNeedsRefresh() {
        let token = AuthToken(
            accessToken: "test-token",
            expiresAt: Date().addingTimeInterval(30)
        )
        XCTAssertTrue(token.needsRefresh(buffer: 60))
        XCTAssertFalse(token.needsRefresh(buffer: 10))
    }

    func testAuthTokenNoExpiration() {
        let token = AuthToken(accessToken: "test-token")
        XCTAssertFalse(token.isExpired)
        XCTAssertFalse(token.needsRefresh())
    }

    func testAuthProviderApiKey() async throws {
        let provider = AuthProvider(credentials: .apiKey("my-api-key"))
        let token = try await provider.getToken()

        XCTAssertEqual(token?.accessToken, "my-api-key")
        XCTAssertEqual(token?.tokenType, "ApiKey")
    }

    func testAuthProviderBearerToken() async throws {
        let provider = AuthProvider(credentials: .bearerToken("my-bearer-token"))
        let token = try await provider.getToken()

        XCTAssertEqual(token?.accessToken, "my-bearer-token")
        XCTAssertEqual(token?.tokenType, "Bearer")
    }

    func testAuthProviderNoAuth() async throws {
        let provider = AuthProvider(credentials: .none)
        let token = try await provider.getToken()

        XCTAssertNil(token)
    }

    // MARK: - Connection Pool Configuration Tests

    func testConnectionPoolConfigurationDefaults() {
        let config = ConnectionPoolConfiguration()

        XCTAssertEqual(config.maxConnections, 10)
        XCTAssertEqual(config.minConnections, 1)
        XCTAssertEqual(config.idleTimeout, 300)
        XCTAssertEqual(config.acquisitionTimeout, 30)
        XCTAssertEqual(config.healthCheckInterval, 30)
    }

    func testConnectionPoolConfigurationCustom() {
        let config = ConnectionPoolConfiguration(
            maxConnections: 20,
            minConnections: 5,
            idleTimeout: 600,
            acquisitionTimeout: 60,
            healthCheckInterval: 15
        )

        XCTAssertEqual(config.maxConnections, 20)
        XCTAssertEqual(config.minConnections, 5)
        XCTAssertEqual(config.idleTimeout, 600)
        XCTAssertEqual(config.acquisitionTimeout, 60)
        XCTAssertEqual(config.healthCheckInterval, 15)
    }

    func testPooledConnectionCreation() {
        let conn = PooledConnection()

        XCTAssertFalse(conn.id.isEmpty)
        XCTAssertTrue(conn.isHealthy)
    }

    func testConnectionPoolStats() async throws {
        let pool = ConnectionPool()
        let stats = await pool.stats()

        XCTAssertEqual(stats.available, 0)
        XCTAssertEqual(stats.inUse, 0)
        XCTAssertEqual(stats.waiting, 0)
        XCTAssertEqual(stats.total, 0)
    }

    func testConnectionPoolAcquireRelease() async throws {
        let pool = ConnectionPool(configuration: ConnectionPoolConfiguration(minConnections: 0))
        try await pool.start()

        let connection = try await pool.acquire()
        var stats = await pool.stats()

        XCTAssertEqual(stats.inUse, 1)
        XCTAssertEqual(stats.available, 0)

        await pool.release(connection)
        stats = await pool.stats()

        XCTAssertEqual(stats.inUse, 0)
        XCTAssertEqual(stats.available, 1)

        await pool.stop()
    }

    // MARK: - Retry Configuration Tests

    func testRetryConfigurationDefaults() {
        let config = RetryConfiguration()

        XCTAssertEqual(config.maxAttempts, 3)
        XCTAssertEqual(config.baseDelay, 0.1)
        XCTAssertEqual(config.maxDelay, 10.0)
        XCTAssertEqual(config.jitterFactor, 0.1)
        XCTAssertTrue(config.retryOnTimeout)
        XCTAssertTrue(config.retryOnConnectionLoss)
        XCTAssertTrue(config.retryableStatusCodes.contains(429))
        XCTAssertTrue(config.retryableStatusCodes.contains(503))
    }

    func testRetryConfigurationCustom() {
        let config = RetryConfiguration(
            maxAttempts: 5,
            baseDelay: 0.5,
            maxDelay: 30.0,
            jitterFactor: 0.2,
            retryOnTimeout: false,
            retryOnConnectionLoss: false,
            retryableStatusCodes: [500, 502]
        )

        XCTAssertEqual(config.maxAttempts, 5)
        XCTAssertEqual(config.baseDelay, 0.5)
        XCTAssertEqual(config.maxDelay, 30.0)
        XCTAssertEqual(config.jitterFactor, 0.2)
        XCTAssertFalse(config.retryOnTimeout)
        XCTAssertFalse(config.retryOnConnectionLoss)
        XCTAssertTrue(config.retryableStatusCodes.contains(500))
        XCTAssertFalse(config.retryableStatusCodes.contains(429))
    }

    func testWithRetrySuccess() async throws {
        var attempts = 0
        let result = try await withRetry { () async throws -> Int in
            attempts += 1
            return 42
        }

        XCTAssertEqual(result, 42)
        XCTAssertEqual(attempts, 1)
    }

    func testWithRetryFailsThenSucceeds() async throws {
        var attempts = 0
        let result = try await withRetry(
            configuration: RetryConfiguration(baseDelay: 0.01)
        ) { () async throws -> Int in
            attempts += 1
            if attempts < 2 {
                throw DotDoError.timeout
            }
            return 42
        }

        XCTAssertEqual(result, 42)
        XCTAssertEqual(attempts, 2)
    }

    func testWithRetryExhaustsAttempts() async {
        var attempts = 0
        let config = RetryConfiguration(maxAttempts: 3, baseDelay: 0.01)

        do {
            _ = try await withRetry(configuration: config) { () async throws -> Int in
                attempts += 1
                throw DotDoError.timeout
            }
            XCTFail("Should have thrown")
        } catch {
            XCTAssertEqual(attempts, 3)
        }
    }

    func testWithRetryNonRetryableError() async {
        var attempts = 0

        do {
            _ = try await withRetry { () async throws -> Int in
                attempts += 1
                throw DotDoError.unauthorized("Not allowed")
            }
            XCTFail("Should have thrown")
        } catch {
            XCTAssertEqual(attempts, 1)
        }
    }

    // MARK: - Client Configuration Tests

    func testDotDoConfigurationDefaults() {
        let config = DotDoConfiguration(
            baseURL: URL(string: "https://api.do.gt")!
        )

        XCTAssertEqual(config.timeout, 30.0)
        XCTAssertTrue(config.headers.isEmpty)
    }

    func testDotDoConfigurationCustom() {
        let config = DotDoConfiguration(
            baseURL: URL(string: "https://api.do.gt")!,
            credentials: .apiKey("test-key"),
            timeout: 60.0,
            headers: ["X-Custom": "header"]
        )

        XCTAssertEqual(config.timeout, 60.0)
        XCTAssertEqual(config.headers["X-Custom"], "header")
    }

    // MARK: - Client Tests

    func testClientCreation() async {
        let config = DotDoConfiguration(
            baseURL: URL(string: "https://api.do.gt")!
        )
        let client = DotDoClient(configuration: config)

        let isStarted = await client.isStarted
        XCTAssertFalse(isStarted)
    }

    func testClientStartStop() async throws {
        let config = DotDoConfiguration(
            baseURL: URL(string: "https://api.do.gt")!
        )
        let client = DotDoClient(configuration: config)

        try await client.start()
        var isStarted = await client.isStarted
        XCTAssertTrue(isStarted)

        await client.stop()
        isStarted = await client.isStarted
        XCTAssertFalse(isStarted)
    }

    func testClientWithApiKey() async throws {
        let client = DotDoClient.withApiKey(
            "test-api-key",
            baseURL: URL(string: "https://api.do.gt")!
        )

        let authHeader = try await client.getAuthHeader()
        XCTAssertEqual(authHeader?.key, "Authorization")
        XCTAssertEqual(authHeader?.value, "ApiKey test-api-key")
    }

    func testClientWithBearerToken() async throws {
        let client = DotDoClient.withBearerToken(
            "test-bearer-token",
            baseURL: URL(string: "https://api.do.gt")!
        )

        let authHeader = try await client.getAuthHeader()
        XCTAssertEqual(authHeader?.key, "Authorization")
        XCTAssertEqual(authHeader?.value, "Bearer test-bearer-token")
    }

    func testClientExecuteWithRetry() async throws {
        let config = DotDoConfiguration(
            baseURL: URL(string: "https://api.do.gt")!,
            retry: RetryConfiguration(maxAttempts: 2, baseDelay: 0.01)
        )
        let client = DotDoClient(configuration: config)

        var attempts = 0
        let result = try await client.execute {
            attempts += 1
            return "success"
        }

        XCTAssertEqual(result, "success")
        XCTAssertEqual(attempts, 1)
    }

    // MARK: - SDK Info Tests

    func testSDKVersion() {
        XCTAssertFalse(version.isEmpty)
    }

    // MARK: - Error Tests

    func testDotDoErrorEquality() {
        XCTAssertEqual(DotDoError.timeout, DotDoError.timeout)
        XCTAssertEqual(DotDoError.cancelled, DotDoError.cancelled)
        XCTAssertEqual(
            DotDoError.authenticationFailed("test"),
            DotDoError.authenticationFailed("test")
        )
        XCTAssertNotEqual(
            DotDoError.authenticationFailed("a"),
            DotDoError.authenticationFailed("b")
        )
    }
}
