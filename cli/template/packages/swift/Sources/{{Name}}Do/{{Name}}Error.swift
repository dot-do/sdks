import Foundation

/// Errors that can occur when using {{Name}}Client
public enum {{Name}}Error: LocalizedError, Sendable {
    /// The client is not connected
    case notConnected

    /// Authentication failed
    case authenticationFailed(reason: String)

    /// Resource not found
    case notFound(entity: String, id: String)

    /// Connection failed
    case connectionFailed(reason: String)

    /// General RPC error
    case rpcError(code: String?, message: String)

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            return "{{Name}}Client is not connected. Call connect() first."
        case .authenticationFailed(let reason):
            return "Authentication failed: \(reason)"
        case .notFound(let entity, let id):
            return "\(entity) not found: \(id)"
        case .connectionFailed(let reason):
            return "Connection failed: \(reason)"
        case .rpcError(let code, let message):
            if let code = code {
                return "RPC error [\(code)]: \(message)"
            }
            return "RPC error: \(message)"
        }
    }
}
