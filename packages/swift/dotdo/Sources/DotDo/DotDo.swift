// DotDo Swift SDK
//
// Platform SDK for DotDo with auth, connection pooling, and retry logic.
// Built with native Swift async/await for modern concurrency.

import Foundation

// MARK: - SDK Version

/// SDK version string.
public let version = "0.1.0"

// MARK: - Errors

/// Errors that can occur during DotDo operations.
public enum DotDoError: Error, Sendable, Equatable {
    /// Authentication failed.
    case authenticationFailed(String)
    /// Token has expired.
    case tokenExpired
    /// Insufficient permissions.
    case unauthorized(String)
    /// Connection to server failed.
    case connectionFailed(String)
    /// Connection was lost.
    case connectionLost(String?)
    /// Request timed out.
    case timeout
    /// Rate limit exceeded.
    case rateLimitExceeded(retryAfter: TimeInterval?)
    /// Invalid configuration.
    case invalidConfiguration(String)
    /// Resource not found.
    case notFound(String)
    /// Server error.
    case serverError(code: Int, message: String)
    /// Request was cancelled.
    case cancelled
}

// MARK: - Authentication

/// Authentication credentials for DotDo.
public enum AuthCredentials: Sendable {
    /// API key authentication.
    case apiKey(String)
    /// OAuth2 bearer token.
    case bearerToken(String)
    /// OAuth2 client credentials.
    case clientCredentials(clientId: String, clientSecret: String)
    /// No authentication.
    case none
}

/// Token information from authentication.
public struct AuthToken: Sendable {
    /// The access token.
    public let accessToken: String
    /// Token type (e.g., "Bearer").
    public let tokenType: String
    /// Expiration date.
    public let expiresAt: Date?
    /// Refresh token for token refresh.
    public let refreshToken: String?

    public init(
        accessToken: String,
        tokenType: String = "Bearer",
        expiresAt: Date? = nil,
        refreshToken: String? = nil
    ) {
        self.accessToken = accessToken
        self.tokenType = tokenType
        self.expiresAt = expiresAt
        self.refreshToken = refreshToken
    }

    /// Check if the token is expired.
    public var isExpired: Bool {
        guard let expiresAt = expiresAt else { return false }
        return Date() >= expiresAt
    }

    /// Check if the token needs refresh (expires within buffer time).
    public func needsRefresh(buffer: TimeInterval = 60) -> Bool {
        guard let expiresAt = expiresAt else { return false }
        return Date().addingTimeInterval(buffer) >= expiresAt
    }
}

/// Authentication provider for managing tokens.
public actor AuthProvider {
    /// Current credentials.
    private let credentials: AuthCredentials
    /// Current token.
    private var currentToken: AuthToken?
    /// Lock for token refresh.
    private var refreshTask: Task<AuthToken, Error>?
    /// Token refresh callback.
    private let refreshCallback: (@Sendable (String) async throws -> AuthToken)?

    public init(
        credentials: AuthCredentials,
        refreshCallback: (@Sendable (String) async throws -> AuthToken)? = nil
    ) {
        self.credentials = credentials
        self.refreshCallback = refreshCallback
    }

    /// Get a valid token, refreshing if necessary.
    public func getToken() async throws -> AuthToken? {
        switch credentials {
        case .apiKey(let key):
            return AuthToken(accessToken: key, tokenType: "ApiKey")

        case .bearerToken(let token):
            return AuthToken(accessToken: token)

        case .clientCredentials:
            // Check if we have a valid token
            if let token = currentToken, !token.needsRefresh() {
                return token
            }

            // Refresh the token
            return try await refreshToken()

        case .none:
            return nil
        }
    }

    /// Refresh the token.
    private func refreshToken() async throws -> AuthToken {
        // If already refreshing, wait for that task
        if let refreshTask = refreshTask {
            return try await refreshTask.value
        }

        // Start a new refresh task
        let task = Task<AuthToken, Error> { [weak self] in
            guard let self = self else {
                throw DotDoError.authenticationFailed("Auth provider deallocated")
            }

            let token = await self.currentToken

            guard let refreshToken = token?.refreshToken else {
                throw DotDoError.tokenExpired
            }

            let callback = await self.refreshCallback
            guard let callback = callback else {
                throw DotDoError.authenticationFailed("No refresh callback provided")
            }

            return try await callback(refreshToken)
        }

        refreshTask = task

        do {
            let newToken = try await task.value
            currentToken = newToken
            refreshTask = nil
            return newToken
        } catch {
            refreshTask = nil
            throw error
        }
    }

    /// Set a new token.
    public func setToken(_ token: AuthToken) {
        currentToken = token
    }

    /// Clear the current token.
    public func clearToken() {
        currentToken = nil
    }
}

// MARK: - Connection Pooling

/// Configuration for connection pooling.
public struct ConnectionPoolConfiguration: Sendable {
    /// Maximum number of connections in the pool.
    public var maxConnections: Int
    /// Minimum number of connections to maintain.
    public var minConnections: Int
    /// Connection idle timeout.
    public var idleTimeout: TimeInterval
    /// Maximum time to wait for a connection.
    public var acquisitionTimeout: TimeInterval
    /// Health check interval.
    public var healthCheckInterval: TimeInterval

    public init(
        maxConnections: Int = 10,
        minConnections: Int = 1,
        idleTimeout: TimeInterval = 300,
        acquisitionTimeout: TimeInterval = 30,
        healthCheckInterval: TimeInterval = 30
    ) {
        self.maxConnections = maxConnections
        self.minConnections = minConnections
        self.idleTimeout = idleTimeout
        self.acquisitionTimeout = acquisitionTimeout
        self.healthCheckInterval = healthCheckInterval
    }
}

/// A pooled connection wrapper.
public struct PooledConnection: Sendable {
    /// Unique connection identifier.
    public let id: String
    /// When the connection was created.
    public let createdAt: Date
    /// Last time the connection was used.
    public var lastUsedAt: Date
    /// Whether the connection is healthy.
    public var isHealthy: Bool

    public init(id: String = UUID().uuidString) {
        self.id = id
        self.createdAt = Date()
        self.lastUsedAt = Date()
        self.isHealthy = true
    }
}

/// Connection pool for managing reusable connections.
public actor ConnectionPool {
    /// Pool configuration.
    private let configuration: ConnectionPoolConfiguration
    /// Available connections.
    private var available: [PooledConnection] = []
    /// In-use connections.
    private var inUse: [String: PooledConnection] = [:]
    /// Waiting continuations for connections.
    private var waiters: [CheckedContinuation<PooledConnection, Error>] = []
    /// Health check task.
    private var healthCheckTask: Task<Void, Never>?

    public init(configuration: ConnectionPoolConfiguration = ConnectionPoolConfiguration()) {
        self.configuration = configuration
    }

    /// Start the connection pool.
    public func start() async throws {
        // Create minimum connections
        for _ in 0..<configuration.minConnections {
            let conn = try await createConnection()
            available.append(conn)
        }

        // Start health check task
        healthCheckTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(self?.configuration.healthCheckInterval ?? 30) * 1_000_000_000)
                await self?.performHealthCheck()
            }
        }
    }

    /// Stop the connection pool.
    public func stop() async {
        healthCheckTask?.cancel()
        healthCheckTask = nil

        // Close all connections
        available.removeAll()
        inUse.removeAll()

        // Cancel all waiters
        for waiter in waiters {
            waiter.resume(throwing: DotDoError.connectionLost("Pool stopped"))
        }
        waiters.removeAll()
    }

    /// Acquire a connection from the pool.
    public func acquire() async throws -> PooledConnection {
        // Try to get an available connection
        if !available.isEmpty {
            var conn = available.removeFirst()
            conn.lastUsedAt = Date()
            inUse[conn.id] = conn
            return conn
        }

        // Can we create a new connection?
        let totalConnections = available.count + inUse.count
        if totalConnections < configuration.maxConnections {
            let conn = try await createConnection()
            inUse[conn.id] = conn
            return conn
        }

        // Wait for a connection to become available
        return try await withCheckedThrowingContinuation { continuation in
            waiters.append(continuation)

            // Set up timeout
            Task {
                try? await Task.sleep(nanoseconds: UInt64(configuration.acquisitionTimeout) * 1_000_000_000)
                await self.timeoutWaiter(continuation)
            }
        }
    }

    /// Release a connection back to the pool.
    public func release(_ connection: PooledConnection) {
        guard inUse.removeValue(forKey: connection.id) != nil else { return }

        var conn = connection
        conn.lastUsedAt = Date()

        // If there are waiters, give them the connection directly
        if !waiters.isEmpty {
            let waiter = waiters.removeFirst()
            inUse[conn.id] = conn
            waiter.resume(returning: conn)
        } else {
            available.append(conn)
        }
    }

    /// Create a new connection.
    private func createConnection() async throws -> PooledConnection {
        // In a real implementation, this would establish an actual connection
        return PooledConnection()
    }

    /// Handle waiter timeout.
    private func timeoutWaiter(_ continuation: CheckedContinuation<PooledConnection, Error>) {
        if let index = waiters.firstIndex(where: { $0 == continuation as AnyObject }) {
            waiters.remove(at: index)
            continuation.resume(throwing: DotDoError.timeout)
        }
    }

    /// Perform health check on idle connections.
    private func performHealthCheck() {
        let now = Date()

        // Remove expired idle connections
        available.removeAll { conn in
            now.timeIntervalSince(conn.lastUsedAt) > configuration.idleTimeout
        }

        // Ensure minimum connections
        let neededConnections = configuration.minConnections - available.count - inUse.count
        if neededConnections > 0 {
            Task {
                for _ in 0..<neededConnections {
                    if let conn = try? await createConnection() {
                        await self.addToAvailable(conn)
                    }
                }
            }
        }
    }

    /// Add a connection to available pool.
    private func addToAvailable(_ conn: PooledConnection) {
        available.append(conn)
    }

    /// Get pool statistics.
    public func stats() -> ConnectionPoolStats {
        ConnectionPoolStats(
            available: available.count,
            inUse: inUse.count,
            waiting: waiters.count,
            total: available.count + inUse.count
        )
    }
}

/// Statistics for the connection pool.
public struct ConnectionPoolStats: Sendable {
    public let available: Int
    public let inUse: Int
    public let waiting: Int
    public let total: Int
}

// MARK: - Retry Logic

/// Configuration for retry behavior.
public struct RetryConfiguration: Sendable {
    /// Maximum number of retry attempts.
    public var maxAttempts: Int
    /// Base delay for exponential backoff.
    public var baseDelay: TimeInterval
    /// Maximum delay between retries.
    public var maxDelay: TimeInterval
    /// Jitter factor (0-1) to add randomness to delays.
    public var jitterFactor: Double
    /// Whether to retry on timeout.
    public var retryOnTimeout: Bool
    /// Whether to retry on connection loss.
    public var retryOnConnectionLoss: Bool
    /// Status codes that should trigger a retry.
    public var retryableStatusCodes: Set<Int>

    public init(
        maxAttempts: Int = 3,
        baseDelay: TimeInterval = 0.1,
        maxDelay: TimeInterval = 10.0,
        jitterFactor: Double = 0.1,
        retryOnTimeout: Bool = true,
        retryOnConnectionLoss: Bool = true,
        retryableStatusCodes: Set<Int> = [408, 429, 500, 502, 503, 504]
    ) {
        self.maxAttempts = maxAttempts
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.jitterFactor = jitterFactor
        self.retryOnTimeout = retryOnTimeout
        self.retryOnConnectionLoss = retryOnConnectionLoss
        self.retryableStatusCodes = retryableStatusCodes
    }
}

/// Execute an operation with retry logic.
public func withRetry<T>(
    configuration: RetryConfiguration = RetryConfiguration(),
    operation: @Sendable () async throws -> T
) async throws -> T {
    var lastError: Error?
    var delay = configuration.baseDelay

    for attempt in 0..<configuration.maxAttempts {
        do {
            return try await operation()
        } catch let error as DotDoError {
            lastError = error

            // Check if we should retry
            let shouldRetry: Bool
            switch error {
            case .timeout:
                shouldRetry = configuration.retryOnTimeout
            case .connectionLost, .connectionFailed:
                shouldRetry = configuration.retryOnConnectionLoss
            case .rateLimitExceeded(let retryAfter):
                if let retryAfter = retryAfter {
                    if attempt < configuration.maxAttempts - 1 {
                        try await Task.sleep(nanoseconds: UInt64(retryAfter * 1_000_000_000))
                        continue
                    }
                }
                shouldRetry = true
            case .serverError(let code, _):
                shouldRetry = configuration.retryableStatusCodes.contains(code)
            default:
                shouldRetry = false
            }

            if !shouldRetry || attempt >= configuration.maxAttempts - 1 {
                throw error
            }

            // Calculate delay with jitter
            let jitter = delay * configuration.jitterFactor * Double.random(in: -1...1)
            let totalDelay = min(delay + jitter, configuration.maxDelay)

            try await Task.sleep(nanoseconds: UInt64(totalDelay * 1_000_000_000))
            delay = min(delay * 2, configuration.maxDelay)
        } catch {
            // Non-DotDoError errors are not retried
            throw error
        }
    }

    throw lastError ?? DotDoError.connectionFailed("Max retries exceeded")
}

// MARK: - Client Configuration

/// Configuration for the DotDo client.
public struct DotDoConfiguration: Sendable {
    /// The base URL for the DotDo service.
    public let baseURL: URL
    /// Authentication credentials.
    public let credentials: AuthCredentials
    /// Retry configuration.
    public var retry: RetryConfiguration
    /// Connection pool configuration.
    public var connectionPool: ConnectionPoolConfiguration
    /// Request timeout.
    public var timeout: TimeInterval
    /// Custom headers.
    public var headers: [String: String]

    public init(
        baseURL: URL,
        credentials: AuthCredentials = .none,
        retry: RetryConfiguration = RetryConfiguration(),
        connectionPool: ConnectionPoolConfiguration = ConnectionPoolConfiguration(),
        timeout: TimeInterval = 30.0,
        headers: [String: String] = [:]
    ) {
        self.baseURL = baseURL
        self.credentials = credentials
        self.retry = retry
        self.connectionPool = connectionPool
        self.timeout = timeout
        self.headers = headers
    }
}

// MARK: - DotDo Client

/// Main client for interacting with DotDo services.
public actor DotDoClient {
    /// Client configuration.
    public let configuration: DotDoConfiguration
    /// Authentication provider.
    private let authProvider: AuthProvider
    /// Connection pool.
    private let pool: ConnectionPool
    /// Whether the client is started.
    public private(set) var isStarted: Bool = false

    public init(configuration: DotDoConfiguration) {
        self.configuration = configuration
        self.authProvider = AuthProvider(credentials: configuration.credentials)
        self.pool = ConnectionPool(configuration: configuration.connectionPool)
    }

    /// Start the client.
    public func start() async throws {
        guard !isStarted else { return }
        try await pool.start()
        isStarted = true
    }

    /// Stop the client.
    public func stop() async {
        guard isStarted else { return }
        await pool.stop()
        isStarted = false
    }

    /// Execute a request with the configured retry logic.
    public func execute<T>(
        _ operation: @Sendable @escaping () async throws -> T
    ) async throws -> T {
        try await withRetry(configuration: configuration.retry) {
            try await operation()
        }
    }

    /// Get a connection from the pool.
    public func withConnection<T>(
        _ operation: @Sendable @escaping (PooledConnection) async throws -> T
    ) async throws -> T {
        let connection = try await pool.acquire()
        defer {
            Task { await pool.release(connection) }
        }
        return try await operation(connection)
    }

    /// Get an authenticated request header.
    public func getAuthHeader() async throws -> (key: String, value: String)? {
        guard let token = try await authProvider.getToken() else {
            return nil
        }
        return ("Authorization", "\(token.tokenType) \(token.accessToken)")
    }

    /// Get pool statistics.
    public func poolStats() async -> ConnectionPoolStats {
        await pool.stats()
    }
}

// MARK: - Convenience

extension DotDoClient {
    /// Create a client with an API key.
    public static func withApiKey(
        _ apiKey: String,
        baseURL: URL
    ) -> DotDoClient {
        let config = DotDoConfiguration(
            baseURL: baseURL,
            credentials: .apiKey(apiKey)
        )
        return DotDoClient(configuration: config)
    }

    /// Create a client with a bearer token.
    public static func withBearerToken(
        _ token: String,
        baseURL: URL
    ) -> DotDoClient {
        let config = DotDoConfiguration(
            baseURL: baseURL,
            credentials: .bearerToken(token)
        )
        return DotDoClient(configuration: config)
    }
}

// MARK: - Scoped Client

/// Execute operations with a scoped client that starts/stops automatically.
public func withDotDoClient<T>(
    configuration: DotDoConfiguration,
    operation: @Sendable @escaping (DotDoClient) async throws -> T
) async throws -> T {
    let client = DotDoClient(configuration: configuration)
    try await client.start()
    defer {
        Task { await client.stop() }
    }
    return try await operation(client)
}
