// DotDoRpc Swift SDK
//
// RPC client for DotDo platform with Swift async/await support.

import Foundation

// MARK: - RPC Errors

/// Errors that can occur during RPC operations.
public enum RpcError: Error, Sendable, Equatable {
    /// Remote server returned an error.
    case remote(type: String, message: String)
    /// Connection was lost.
    case connectionLost(String?)
    /// Request timed out.
    case timeout
    /// Request was cancelled.
    case cancelled
    /// Invalid response from server.
    case invalidResponse(String)
    /// Invalid argument provided.
    case invalidArgument(String)
    /// Resource not found.
    case notFound(String)
    /// Method not implemented.
    case notImplemented(String)
    /// Authentication failed.
    case authenticationFailed(String)
    /// Rate limit exceeded.
    case rateLimitExceeded(retryAfter: TimeInterval?)
}

// MARK: - RPC Value Type

/// A type-erased value for dynamic RPC operations.
public enum RpcValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([RpcValue])
    case object([String: RpcValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let int = try? container.decode(Int.self) {
            self = .int(int)
        } else if let double = try? container.decode(Double.self) {
            self = .double(double)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([RpcValue].self) {
            self = .array(array)
        } else if let object = try? container.decode([String: RpcValue].self) {
            self = .object(object)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode RPC value"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }

    /// Convert from Any.
    public static func from(_ any: Any?) -> RpcValue {
        guard let any = any else { return .null }

        switch any {
        case is NSNull:
            return .null
        case let bool as Bool:
            return .bool(bool)
        case let int as Int:
            return .int(int)
        case let double as Double:
            return .double(double)
        case let string as String:
            return .string(string)
        case let array as [Any]:
            return .array(array.map { from($0) })
        case let dict as [String: Any]:
            return .object(dict.mapValues { from($0) })
        default:
            return .string(String(describing: any))
        }
    }

    /// Convert to native Swift type.
    public var asAny: Any? {
        switch self {
        case .null:
            return nil
        case .bool(let value):
            return value
        case .int(let value):
            return value
        case .double(let value):
            return value
        case .string(let value):
            return value
        case .array(let value):
            return value.map { $0.asAny }
        case .object(let value):
            return value.mapValues { $0.asAny }
        }
    }
}

// MARK: - RPC Request

/// An RPC request message.
public struct RpcRequest: Sendable, Codable {
    /// Unique request identifier.
    public let id: String
    /// Method name to call.
    public let method: String
    /// Parameters for the method.
    public let params: [RpcValue]

    public init(id: String = UUID().uuidString, method: String, params: [RpcValue] = []) {
        self.id = id
        self.method = method
        self.params = params
    }
}

// MARK: - RPC Response

/// An RPC response message.
public struct RpcResponse: Sendable, Codable {
    /// Request identifier this response is for.
    public let id: String
    /// Result value if successful.
    public let result: RpcValue?
    /// Error if failed.
    public let error: RpcResponseError?

    public init(id: String, result: RpcValue? = nil, error: RpcResponseError? = nil) {
        self.id = id
        self.result = result
        self.error = error
    }
}

/// An RPC error in a response.
public struct RpcResponseError: Sendable, Codable, Equatable {
    /// Error code.
    public let code: Int
    /// Error message.
    public let message: String
    /// Additional error data.
    public let data: RpcValue?

    public init(code: Int, message: String, data: RpcValue? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}

// MARK: - RpcRef

/// A reference to a remote value or capability.
///
/// `RpcRef<T>` represents a lazy reference that builds up a pipeline
/// of operations to be executed on the server.
@dynamicMemberLookup
public struct RpcRef<T>: Sendable {
    /// The client this ref belongs to.
    internal let client: RpcClient

    /// The expression path for this ref.
    internal let path: [RpcPathComponent]

    /// Create a new ref from a client.
    internal init(client: RpcClient, path: [RpcPathComponent] = []) {
        self.client = client
        self.path = path
    }

    /// Access a property on the remote object.
    public subscript<U>(dynamicMember member: String) -> RpcRef<U> {
        RpcRef<U>(client: client, path: path + [.property(member)])
    }

    /// Map a transformation over this ref's value.
    ///
    /// For arrays, the closure is applied to each element on the server.
    /// This eliminates N+1 round trips by executing the transformation server-side.
    ///
    /// ```swift
    /// // Single round-trip: transforms each item on the server
    /// let results = try await api.items.map { x in
    ///     api.process(x)
    /// }
    /// ```
    public func map<U>(_ transform: @escaping @Sendable (RpcRef<Any>) async throws -> U) -> RpcRef<[U]> {
        let wrappedTransform: @Sendable (RpcRef<Any>) async throws -> Any = { ref in
            try await transform(ref)
        }
        return RpcRef<[U]>(client: client, path: path + [.map(closure: wrappedTransform)])
    }

    /// Map with explicit result ref.
    public func map<U>(_ transform: @escaping @Sendable (RpcRef<Any>) async throws -> RpcRef<U>) -> RpcRef<[U]> {
        let wrappedTransform: @Sendable (RpcRef<Any>) async throws -> Any = { ref in
            try await transform(ref) as Any
        }
        return RpcRef<[U]>(client: client, path: path + [.map(closure: wrappedTransform)])
    }

    /// Build the expression string for debugging.
    public var expressionString: String {
        path.map { component in
            switch component {
            case .property(let name):
                return ".\(name)"
            case .call(let method, let args):
                let argsStr = args.map { "\($0)" }.joined(separator: ", ")
                return ".\(method)(\(argsStr))"
            case .map:
                return ".map { ... }"
            case .subscriptAccess(let key):
                return "[\(key)]"
            }
        }.joined()
    }
}

/// A component in an RpcRef expression path.
public enum RpcPathComponent: Sendable {
    case property(String)
    case call(method: String, args: [RpcValue])
    case map(closure: @Sendable (RpcRef<Any>) async throws -> Any)
    case subscriptAccess(key: RpcValue)
}

// MARK: - RPC Client Configuration

/// Configuration for the RPC client.
public struct RpcClientConfiguration: Sendable {
    /// The server URL.
    public let url: URL
    /// Request timeout interval.
    public var timeout: TimeInterval
    /// Maximum number of retry attempts.
    public var maxRetries: Int
    /// Base delay for exponential backoff.
    public var retryBaseDelay: TimeInterval
    /// Maximum delay between retries.
    public var maxRetryDelay: TimeInterval
    /// Headers to include in requests.
    public var headers: [String: String]

    public init(
        url: URL,
        timeout: TimeInterval = 30.0,
        maxRetries: Int = 3,
        retryBaseDelay: TimeInterval = 0.1,
        maxRetryDelay: TimeInterval = 10.0,
        headers: [String: String] = [:]
    ) {
        self.url = url
        self.timeout = timeout
        self.maxRetries = maxRetries
        self.retryBaseDelay = retryBaseDelay
        self.maxRetryDelay = maxRetryDelay
        self.headers = headers
    }
}

// MARK: - RPC Client

/// An RPC client for communicating with DotDo services.
public actor RpcClient {
    /// The client configuration.
    public let configuration: RpcClientConfiguration

    /// Whether the client is connected.
    public private(set) var isConnected: Bool = false

    /// Pending requests waiting for responses.
    private var pendingRequests: [String: CheckedContinuation<RpcResponse, Error>] = [:]

    /// The URL session for HTTP requests.
    private var urlSession: URLSession?

    /// The WebSocket task for bidirectional communication.
    private var webSocketTask: URLSessionWebSocketTask?

    /// Create a new RPC client with the given configuration.
    public init(configuration: RpcClientConfiguration) {
        self.configuration = configuration
    }

    /// Create a new RPC client with a URL string.
    public init(url: String) throws {
        guard let url = URL(string: url) else {
            throw RpcError.invalidArgument("Invalid URL: \(url)")
        }
        self.configuration = RpcClientConfiguration(url: url)
    }

    /// Connect to the server.
    public func connect() async throws {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = configuration.timeout
        urlSession = URLSession(configuration: config)
        webSocketTask = urlSession?.webSocketTask(with: configuration.url)
        webSocketTask?.resume()
        isConnected = true
    }

    /// Disconnect from the server.
    public func disconnect() async {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        urlSession?.invalidateAndCancel()
        isConnected = false
    }

    /// The root API reference.
    public nonisolated var api: RpcRef<Any> {
        RpcRef<Any>(client: self, path: [])
    }

    /// Call a method on the server.
    public func call(_ method: String, params: [RpcValue] = []) async throws -> RpcValue {
        let request = RpcRequest(method: method, params: params)
        return try await sendRequest(request)
    }

    /// Send an RPC request with retry logic.
    private func sendRequest(_ request: RpcRequest) async throws -> RpcValue {
        var lastError: Error?
        var delay = configuration.retryBaseDelay

        for attempt in 0..<configuration.maxRetries {
            do {
                let response = try await sendSingleRequest(request)

                if let error = response.error {
                    throw RpcError.remote(type: "RpcError", message: error.message)
                }

                return response.result ?? .null
            } catch let error as RpcError {
                switch error {
                case .timeout, .connectionLost:
                    // Retry on transient errors
                    lastError = error
                    if attempt < configuration.maxRetries - 1 {
                        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                        delay = min(delay * 2, configuration.maxRetryDelay)
                    }
                case .rateLimitExceeded(let retryAfter):
                    // Respect rate limit retry-after
                    if let retryAfter = retryAfter, attempt < configuration.maxRetries - 1 {
                        try await Task.sleep(nanoseconds: UInt64(retryAfter * 1_000_000_000))
                    } else {
                        throw error
                    }
                default:
                    throw error
                }
            } catch {
                lastError = error
                if attempt < configuration.maxRetries - 1 {
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    delay = min(delay * 2, configuration.maxRetryDelay)
                }
            }
        }

        throw lastError ?? RpcError.connectionLost("Max retries exceeded")
    }

    /// Send a single RPC request.
    private func sendSingleRequest(_ request: RpcRequest) async throws -> RpcResponse {
        guard isConnected else {
            throw RpcError.connectionLost("Not connected")
        }

        let encoder = JSONEncoder()
        let data = try encoder.encode(request)
        let message = URLSessionWebSocketTask.Message.data(data)

        try await webSocketTask?.send(message)

        guard let received = try await webSocketTask?.receive() else {
            throw RpcError.connectionLost("Failed to receive response")
        }

        switch received {
        case .data(let responseData):
            let decoder = JSONDecoder()
            return try decoder.decode(RpcResponse.self, from: responseData)
        case .string(let responseString):
            guard let responseData = responseString.data(using: .utf8) else {
                throw RpcError.invalidResponse("Invalid UTF-8 response")
            }
            let decoder = JSONDecoder()
            return try decoder.decode(RpcResponse.self, from: responseData)
        @unknown default:
            throw RpcError.invalidResponse("Unknown response type")
        }
    }
}

// MARK: - Convenience Extensions

extension RpcClient {
    /// Connect to a server and execute operations.
    public static func withConnection<T>(
        to url: String,
        operation: (RpcClient) async throws -> T
    ) async throws -> T {
        let client = try RpcClient(url: url)
        try await client.connect()
        defer {
            Task { await client.disconnect() }
        }
        return try await operation(client)
    }
}

// MARK: - SDK Info

/// SDK version string.
public let version = "0.1.0"
