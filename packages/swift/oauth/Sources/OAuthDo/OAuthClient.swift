import Foundation

/// OAuth client for .do platform authentication.
/// Provides device flow authentication and token management.
public class OAuthClient {
    private static let userInfoURL = "https://apis.do/me"

    private let deviceFlow: DeviceFlow
    private let tokenStorage: TokenStorage
    private let session: URLSession

    /// User information response.
    public struct UserInfo {
        public let id: String?
        public let email: String?
        public let name: String?
        public let picture: String?

        public var description: String {
            "User(id='\(id ?? "")', email='\(email ?? "")', name='\(name ?? "")')"
        }
    }

    /// OAuth client errors.
    public enum OAuthError: Error, LocalizedError {
        case notAuthenticated
        case authenticationFailed(String)
        case userInfoFailed(String)

        public var errorDescription: String? {
            switch self {
            case .notAuthenticated: return "Not authenticated"
            case .authenticationFailed(let message): return "Authentication failed: \(message)"
            case .userInfoFailed(let message): return "Failed to get user info: \(message)"
            }
        }
    }

    /// Creates an OAuthClient with default configuration.
    public init() {
        self.deviceFlow = DeviceFlow()
        self.tokenStorage = TokenStorage()
        self.session = URLSession.shared
    }

    /// Creates an OAuthClient with a custom client ID.
    /// - Parameter clientId: OAuth client ID
    public init(clientId: String) {
        self.deviceFlow = DeviceFlow(clientId: clientId)
        self.tokenStorage = TokenStorage()
        self.session = URLSession.shared
    }

    /// Creates an OAuthClient with custom components.
    /// - Parameters:
    ///   - deviceFlow: Device flow handler
    ///   - tokenStorage: Token storage handler
    public init(deviceFlow: DeviceFlow, tokenStorage: TokenStorage) {
        self.deviceFlow = deviceFlow
        self.tokenStorage = tokenStorage
        self.session = URLSession.shared
    }

    /// Performs device flow login.
    /// - Parameters:
    ///   - onPrompt: Callback to display authorization URL and code to user
    ///   - onPoll: Callback for each poll attempt (optional)
    /// - Returns: Token data after successful authentication
    /// - Throws: OAuthError if authentication fails
    @discardableResult
    public func login(
        onPrompt: (DeviceFlow.DeviceAuthResponse) -> Void,
        onPoll: ((Int) -> Void)? = nil
    ) async throws -> TokenStorage.TokenData {
        // Initiate device authorization
        let auth = try await deviceFlow.authorize()

        // Show prompt to user
        onPrompt(auth)

        // Poll for token
        let token = try await deviceFlow.pollForToken(
            deviceCode: auth.deviceCode,
            interval: auth.interval,
            timeout: auth.expiresIn,
            onPoll: onPoll
        )

        if token.isError {
            throw OAuthError.authenticationFailed("\(token.error ?? "Unknown")" +
                (token.errorDescription.map { " - \($0)" } ?? ""))
        }

        guard let accessToken = token.accessToken else {
            throw OAuthError.authenticationFailed("No access token received")
        }

        // Save token
        let expiresAt = Int64(Date().timeIntervalSince1970) + Int64(token.expiresIn)
        let tokenData = TokenStorage.TokenData(
            accessToken: accessToken,
            refreshToken: token.refreshToken,
            tokenType: token.tokenType,
            expiresAt: expiresAt
        )
        try tokenStorage.save(tokenData)

        return tokenData
    }

    /// Logs out by deleting stored tokens.
    /// - Returns: true if logout was successful
    @discardableResult
    public func logout() -> Bool {
        return tokenStorage.delete()
    }

    /// Gets the current access token if valid.
    /// - Returns: Access token, or nil if not authenticated
    public func getAccessToken() -> String? {
        guard let data = tokenStorage.load(), !data.isExpired else {
            return nil
        }
        return data.accessToken
    }

    /// Checks if user is authenticated with a valid token.
    /// - Returns: true if authenticated
    public func isAuthenticated() -> Bool {
        return tokenStorage.hasValidToken()
    }

    /// Gets user information for the authenticated user.
    /// - Returns: User information
    /// - Throws: OAuthError if the request fails or user is not authenticated
    public func getUserInfo() async throws -> UserInfo {
        guard let accessToken = getAccessToken() else {
            throw OAuthError.notAuthenticated
        }

        var request = URLRequest(url: URL(string: Self.userInfoURL)!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw OAuthError.userInfoFailed(String(data: data, encoding: .utf8) ?? "Unknown error")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw OAuthError.userInfoFailed("Invalid response")
        }

        // Handle nested user object if present
        let userData = json["user"] as? [String: Any] ?? json

        return UserInfo(
            id: userData["id"] as? String,
            email: userData["email"] as? String,
            name: userData["name"] as? String,
            picture: userData["picture"] as? String
        )
    }

    /// Gets the device flow handler.
    /// - Returns: DeviceFlow instance
    public func getDeviceFlow() -> DeviceFlow {
        return deviceFlow
    }

    /// Gets the token storage handler.
    /// - Returns: TokenStorage instance
    public func getTokenStorage() -> TokenStorage {
        return tokenStorage
    }
}
