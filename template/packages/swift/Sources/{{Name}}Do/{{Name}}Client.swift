import Foundation
import RpcDo

/// Configuration options for {{Name}}Client
public struct {{Name}}ClientOptions: Sendable {
    /// API key for authentication
    public var apiKey: String?

    /// Base URL for the service (defaults to https://{{name}}.do)
    public var baseUrl: String

    /// Connection timeout
    public var timeout: TimeInterval

    public init(
        apiKey: String? = nil,
        baseUrl: String = "https://{{name}}.do",
        timeout: TimeInterval = 30.0
    ) {
        self.apiKey = apiKey
        self.baseUrl = baseUrl
        self.timeout = timeout
    }
}

/// {{Name}}.do client for interacting with the {{name}} service
///
/// Example:
/// ```swift
/// let client = {{Name}}Client(apiKey: ProcessInfo.processInfo.environment["DOTDO_KEY"])
/// try await client.connect()
/// defer { await client.disconnect() }
/// // Use the client...
/// ```
public actor {{Name}}Client {
    private let options: {{Name}}ClientOptions
    private var rpc: RpcClient?

    /// Creates a new {{Name}}Client with the given options
    public init(options: {{Name}}ClientOptions = {{Name}}ClientOptions()) {
        self.options = options
    }

    /// Creates a new {{Name}}Client with an API key
    public init(apiKey: String?, baseUrl: String = "https://{{name}}.do") {
        self.options = {{Name}}ClientOptions(apiKey: apiKey, baseUrl: baseUrl)
    }

    /// Whether the client is currently connected
    public var isConnected: Bool {
        rpc != nil
    }

    /// Connect to the {{name}}.do service
    @discardableResult
    public func connect() async throws -> RpcClient {
        if rpc == nil {
            var headers: [String: String] = [:]
            if let apiKey = options.apiKey {
                headers["Authorization"] = "Bearer \(apiKey)"
            }

            rpc = try await RpcClient.connect(
                to: options.baseUrl,
                headers: headers.isEmpty ? nil : headers
            )
        }
        return rpc!
    }

    /// Disconnect from the service
    public func disconnect() async {
        if let client = rpc {
            await client.close()
            rpc = nil
        }
    }

    /// Get the underlying RPC client (must be connected first)
    public func getRpc() throws -> RpcClient {
        guard let client = rpc else {
            throw {{Name}}Error.notConnected
        }
        return client
    }
}
