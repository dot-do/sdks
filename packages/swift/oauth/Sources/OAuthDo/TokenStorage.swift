import Foundation

/// File-based token storage for OAuth tokens.
/// Stores tokens in ~/.oauth.do/token
public class TokenStorage {
    private static let defaultTokenDir = ".oauth.do"
    private static let defaultTokenFile = "token"

    private let tokenPath: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// Token data structure for serialization.
    public struct TokenData: Codable {
        public let accessToken: String
        public let refreshToken: String?
        public let tokenType: String
        public let expiresAt: Int64

        public init(accessToken: String, refreshToken: String?, tokenType: String = "Bearer", expiresAt: Int64) {
            self.accessToken = accessToken
            self.refreshToken = refreshToken
            self.tokenType = tokenType
            self.expiresAt = expiresAt
        }

        public var isExpired: Bool {
            return Int64(Date().timeIntervalSince1970) >= expiresAt
        }

        private enum CodingKeys: String, CodingKey {
            case accessToken = "accessToken"
            case refreshToken = "refreshToken"
            case tokenType = "tokenType"
            case expiresAt = "expiresAt"
        }
    }

    /// Creates a TokenStorage with default path (~/.oauth.do/token).
    public init() {
        let homeDir = FileManager.default.homeDirectoryForCurrentUser
        self.tokenPath = homeDir
            .appendingPathComponent(Self.defaultTokenDir)
            .appendingPathComponent(Self.defaultTokenFile)

        encoder.outputFormatting = .prettyPrinted
    }

    /// Creates a TokenStorage with a custom path.
    /// - Parameter tokenPath: Path to the token file
    public init(tokenPath: URL) {
        self.tokenPath = tokenPath
        encoder.outputFormatting = .prettyPrinted
    }

    /// Saves token data to disk.
    /// - Parameter data: Token data to save
    /// - Throws: If writing fails
    public func save(_ data: TokenData) throws {
        let directory = tokenPath.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let jsonData = try encoder.encode(data)
        try jsonData.write(to: tokenPath)

        // Set restrictive permissions (owner read/write only)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: tokenPath.path
        )
    }

    /// Loads token data from disk.
    /// - Returns: Token data, or nil if not found
    public func load() -> TokenData? {
        guard FileManager.default.fileExists(atPath: tokenPath.path) else {
            return nil
        }

        do {
            let data = try Data(contentsOf: tokenPath)
            return try decoder.decode(TokenData.self, from: data)
        } catch {
            return nil
        }
    }

    /// Deletes stored token data.
    /// - Returns: true if deletion was successful
    @discardableResult
    public func delete() -> Bool {
        do {
            try FileManager.default.removeItem(at: tokenPath)
            return true
        } catch {
            return false
        }
    }

    /// Checks if a valid (non-expired) token exists.
    /// - Returns: true if a valid token is stored
    public func hasValidToken() -> Bool {
        guard let data = load() else { return false }
        return !data.isExpired
    }

    /// Gets the token file path.
    /// - Returns: URL to the token file
    public func getTokenPath() -> URL {
        return tokenPath
    }
}
