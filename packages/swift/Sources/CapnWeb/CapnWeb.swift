// CapnWeb Swift SDK
//
// Capability-based RPC for Swift with native async/await.
// This is a stub implementation for conformance testing.

import Foundation

// MARK: - Errors

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
    /// SDK not yet implemented.
    case notImplemented(String)
    /// Invalid argument provided.
    case invalidArgument(String)
    /// Resource not found.
    case notFound(String)
}

// MARK: - JSON Value Type

/// A type-erased JSON value for dynamic RPC operations.
public enum JsonValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JsonValue])
    case object([String: JsonValue])

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
        } else if let array = try? container.decode([JsonValue].self) {
            self = .array(array)
        } else if let object = try? container.decode([String: JsonValue].self) {
            self = .object(object)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode JSON value"
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

    /// Convert from Any (for test harness).
    public static func from(_ any: Any?) -> JsonValue {
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

    /// Compare with tolerance for floating point.
    public static func valuesEqual(_ lhs: JsonValue, _ rhs: JsonValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null):
            return true
        case (.bool(let a), .bool(let b)):
            return a == b
        case (.int(let a), .int(let b)):
            return a == b
        case (.double(let a), .double(let b)):
            return abs(a - b) < 1e-10
        case (.int(let a), .double(let b)):
            return abs(Double(a) - b) < 1e-10
        case (.double(let a), .int(let b)):
            return abs(a - Double(b)) < 1e-10
        case (.string(let a), .string(let b)):
            return a == b
        case (.array(let a), .array(let b)):
            return a.count == b.count && zip(a, b).allSatisfy { valuesEqual($0, $1) }
        case (.object(let a), .object(let b)):
            return a.count == b.count && a.allSatisfy { key, value in
                b[key].map { valuesEqual(value, $0) } ?? false
            }
        default:
            return false
        }
    }
}

// MARK: - Path Component

/// A component in a Ref expression path.
/// Moved outside of Ref<T> to avoid generic type compatibility issues.
public enum RefPathComponent: Sendable {
    case property(String)
    case call(method: String, args: [JsonValue])
    case map(closure: @Sendable (Ref<Any>) async throws -> Any)
    case subscriptAccess(key: JsonValue)
}

// MARK: - Ref Type

/// A reference to a remote capability or value.
///
/// `Ref<T>` represents a lazy reference to a remote object. Method calls and
/// property accesses build up a pipeline that is executed when awaited.
///
/// Supports `.map { }` for server-side collection transformation.
@dynamicMemberLookup
@dynamicCallable
public struct Ref<T>: Sendable {
    /// The session this ref belongs to.
    internal let session: RpcSession

    /// The expression path for this ref (method chain).
    internal let path: [RefPathComponent]

    /// Create a new ref from a session.
    internal init(session: RpcSession, path: [RefPathComponent] = []) {
        self.session = session
        self.path = path
    }

    /// Access a property on the remote object.
    public subscript<U>(dynamicMember member: String) -> Ref<U> {
        Ref<U>(session: session, path: path + [.property(member)])
    }

    /// Call a method on the remote object with keyword arguments.
    @discardableResult
    public func dynamicallyCall<R>(
        withKeywordArguments args: KeyValuePairs<String, Any>
    ) -> Ref<R> {
        let jsonArgs = args.map { (key: $0.key, value: JsonValue.from($0.value)) }
        let argsArray = jsonArgs.map { $0.value }
        let method = path.last.flatMap { component -> String? in
            if case .property(let name) = component {
                return name
            }
            return nil
        } ?? ""

        var newPath = path
        if !newPath.isEmpty, case .property = newPath.last {
            newPath.removeLast()
        }
        newPath.append(.call(method: method, args: argsArray))

        return Ref<R>(session: session, path: newPath)
    }

    /// Map a transformation over this ref's value.
    ///
    /// For arrays, the closure is applied to each element on the server.
    /// For single values, the closure is applied to the value.
    /// For null/nil, returns null without error.
    ///
    /// This is the key feature that eliminates N+1 round trips.
    ///
    /// ```swift
    /// // Single round-trip: squares each Fibonacci number on the server
    /// let squared = try await api.generateFibonacci(6).map { x in
    ///     api.square(x)
    /// }
    /// // [0, 1, 1, 4, 9, 25]
    /// ```
    public func map<U>(_ transform: @escaping @Sendable (Ref<Any>) async throws -> U) -> Ref<[U]> {
        let wrappedTransform: @Sendable (Ref<Any>) async throws -> Any = { ref in
            try await transform(ref)
        }
        return Ref<[U]>(session: session, path: path + [.map(closure: wrappedTransform)])
    }

    /// Map with explicit result ref.
    public func map<U>(_ transform: @escaping @Sendable (Ref<Any>) async throws -> Ref<U>) -> Ref<[U]> {
        let wrappedTransform: @Sendable (Ref<Any>) async throws -> Any = { ref in
            try await transform(ref) as Any
        }
        return Ref<[U]>(session: session, path: path + [.map(closure: wrappedTransform)])
    }

    /// Subscript access for array/dictionary.
    public subscript(index: Int) -> Ref<Any> {
        Ref<Any>(session: session, path: path + [.subscriptAccess(key: .int(index))])
    }

    public subscript(key: String) -> Ref<Any> {
        Ref<Any>(session: session, path: path + [.subscriptAccess(key: .string(key))])
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

// MARK: - Ref Async Resolution

extension Ref {
    /// Resolve the ref by executing the pipeline.
    public func resolve() async throws -> T {
        throw RpcError.notImplemented("Ref.resolve() - expression: \(expressionString)")
    }
}

// Conform Ref to AsyncSequence for streams (placeholder)
extension Ref: AsyncSequence where T: Sequence {
    public typealias Element = T.Element

    public struct AsyncIterator: AsyncIteratorProtocol {
        public mutating func next() async throws -> Element? {
            return nil
        }
    }

    public func makeAsyncIterator() -> AsyncIterator {
        AsyncIterator()
    }
}

// MARK: - RpcSession

/// An active connection to a CapnWeb server.
///
/// `RpcSession` manages the WebSocket connection and provides access to the
/// remote API through the `api` property.
public actor RpcSession {
    /// The URL this session is connected to.
    public let url: URL

    /// Whether the session is currently connected.
    public private(set) var isConnected: Bool = false

    /// Whether the SDK is fully implemented.
    public static var isImplemented: Bool { false }

    /// Internal connection state.
    private var urlSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?

    /// Create a new session (internal).
    private init(url: URL) {
        self.url = url
    }

    /// Connect to a CapnWeb server.
    ///
    /// - Parameters:
    ///   - urlString: The WebSocket URL to connect to.
    /// - Returns: A connected session.
    /// - Throws: `RpcError` if connection fails.
    public static func connect(to urlString: String) async throws -> RpcSession {
        guard let url = URL(string: urlString) else {
            throw RpcError.invalidArgument("Invalid URL: \(urlString)")
        }
        return try await connect(to: url)
    }

    /// Connect to a CapnWeb server.
    ///
    /// - Parameters:
    ///   - url: The WebSocket URL to connect to.
    /// - Returns: A connected session.
    /// - Throws: `RpcError` if connection fails.
    public static func connect(to url: URL) async throws -> RpcSession {
        let session = RpcSession(url: url)
        try await session.establishConnection()
        return session
    }

    /// Establish the WebSocket connection.
    private func establishConnection() async throws {
        // Stub implementation - mark as connected for testing
        // Real implementation would establish WebSocket connection
        isConnected = true

        // Note: Actual WebSocket connection would be:
        // let config = URLSessionConfiguration.default
        // urlSession = URLSession(configuration: config)
        // webSocketTask = urlSession?.webSocketTask(with: url)
        // webSocketTask?.resume()
    }

    /// The root API reference.
    ///
    /// Use this to start building method chains:
    /// ```swift
    /// let result = try await session.api.users.get(id: 123)
    /// ```
    public nonisolated var api: Ref<Any> {
        Ref<Any>(session: self, path: [])
    }

    /// Close the connection gracefully.
    public func close() async {
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        urlSession?.invalidateAndCancel()
        isConnected = false
    }

    /// Execute a dynamic method call (for conformance testing).
    ///
    /// - Parameters:
    ///   - method: The method name to call.
    ///   - args: Arguments to pass to the method.
    /// - Returns: The result as a JsonValue.
    /// - Throws: `RpcError.notImplemented` (stub).
    public func callMethod(_ method: String, args: [JsonValue]) async throws -> JsonValue {
        throw RpcError.notImplemented("RpcSession.callMethod(\(method), \(args))")
    }

    /// Execute a pipelined call sequence (for conformance testing).
    ///
    /// - Parameters:
    ///   - steps: The pipeline steps to execute.
    /// - Returns: The final result as a JsonValue.
    /// - Throws: `RpcError.notImplemented` (stub).
    public func callPipeline(_ steps: [PipelineStep]) async throws -> JsonValue {
        throw RpcError.notImplemented("RpcSession.callPipeline(\(steps))")
    }

    /// Execute a map operation (for conformance testing).
    ///
    /// - Parameters:
    ///   - base: The base call to get the collection.
    ///   - mapExpression: The map expression to apply.
    /// - Returns: The mapped result as a JsonValue.
    /// - Throws: `RpcError.notImplemented` (stub).
    public func callMap(
        base: (method: String, args: [JsonValue]),
        mapExpression: MapExpression
    ) async throws -> JsonValue {
        throw RpcError.notImplemented(
            "RpcSession.callMap(base: \(base), map: \(mapExpression))"
        )
    }
}

// MARK: - Pipeline Types

/// A step in a pipeline call.
public struct PipelineStep: Sendable {
    /// The method to call (may include dot notation like "counter.increment").
    public let call: String
    /// Arguments to pass.
    public let args: [JsonValue]
    /// Optional alias for the result.
    public let alias: String?
    /// Whether to await this step.
    public let shouldAwait: Bool
    /// Optional map operation.
    public let map: MapExpression?

    public init(
        call: String,
        args: [JsonValue] = [],
        alias: String? = nil,
        shouldAwait: Bool = false,
        map: MapExpression? = nil
    ) {
        self.call = call
        self.args = args
        self.alias = alias
        self.shouldAwait = shouldAwait
        self.map = map
    }
}

/// A map expression specification.
public struct MapExpression: Sendable {
    /// The expression string (e.g., "x => self.square(x)").
    public let expression: String
    /// Captured variables (e.g., ["$self"]).
    public let captures: [String]

    public init(expression: String, captures: [String] = []) {
        self.expression = expression
        self.captures = captures
    }
}

// MARK: - Typed Session

/// A typed RPC session with a specific API protocol.
public actor TypedRpcSession<API> {
    /// The underlying untyped session.
    public let session: RpcSession

    /// Create a typed session wrapper.
    private init(session: RpcSession) {
        self.session = session
    }

    /// Connect to a CapnWeb server with a typed API.
    public static func connect(to urlString: String) async throws -> TypedRpcSession<API> {
        let session = try await RpcSession.connect(to: urlString)
        return TypedRpcSession(session: session)
    }

    /// Connect to a CapnWeb server with a typed API.
    public static func connect(to url: URL) async throws -> TypedRpcSession<API> {
        let session = try await RpcSession.connect(to: url)
        return TypedRpcSession(session: session)
    }

    /// The typed API reference.
    public nonisolated var api: Ref<API> {
        Ref<API>(session: session, path: [])
    }

    /// Close the connection.
    public func close() async {
        await session.close()
    }
}

// MARK: - Scoped Session

/// Execute operations with a scoped session that closes automatically.
public func withRpcSession<T>(
    to url: URL,
    operation: (RpcSession) async throws -> T
) async throws -> T {
    let session = try await RpcSession.connect(to: url)
    defer {
        Task { await session.close() }
    }
    return try await operation(session)
}

/// Execute operations with a typed scoped session.
public func withRpcSession<API, T>(
    to url: URL,
    as apiType: API.Type,
    operation: (TypedRpcSession<API>) async throws -> T
) async throws -> T {
    let session = try await TypedRpcSession<API>.connect(to: url)
    defer {
        Task { await session.close() }
    }
    return try await operation(session)
}

// MARK: - SDK Info

/// SDK version string.
public let version = "0.1.0"

/// Check if the SDK is fully implemented.
public var isImplemented: Bool { RpcSession.isImplemented }
