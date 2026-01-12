import Foundation

/// Device flow authorization for OAuth.
/// Implements the device authorization grant flow.
public class DeviceFlow {
    private static let authURL = "https://auth.apis.do/user_management/authorize_device"
    private static let tokenURL = "https://auth.apis.do/user_management/authenticate"
    public static let defaultClientId = "client_01JQYTRXK9ZPD8JPJTKDCRB656"

    private let clientId: String
    private let session: URLSession

    /// Device authorization response.
    public struct DeviceAuthResponse {
        public let deviceCode: String
        public let userCode: String
        public let verificationUri: String
        public let verificationUriComplete: String?
        public let expiresIn: Int
        public let interval: Int

        public var description: String {
            "Visit \(verificationUri) and enter code: \(userCode)"
        }
    }

    /// Token response from authentication.
    public struct TokenResponse {
        public let accessToken: String?
        public let refreshToken: String?
        public let tokenType: String
        public let expiresIn: Int
        public let error: String?
        public let errorDescription: String?

        public var isError: Bool { error != nil }
        public var isPending: Bool { error == "authorization_pending" || error == "slow_down" }
    }

    /// Device flow errors.
    public enum DeviceFlowError: Error, LocalizedError {
        case authorizationFailed(String)
        case timeout
        case invalidResponse

        public var errorDescription: String? {
            switch self {
            case .authorizationFailed(let message): return "Authorization failed: \(message)"
            case .timeout: return "Authorization timed out"
            case .invalidResponse: return "Invalid response from server"
            }
        }
    }

    /// Creates a DeviceFlow with the default client ID.
    public init() {
        self.clientId = Self.defaultClientId
        self.session = URLSession.shared
    }

    /// Creates a DeviceFlow with a custom client ID.
    /// - Parameter clientId: OAuth client ID
    public init(clientId: String) {
        self.clientId = clientId
        self.session = URLSession.shared
    }

    /// Initiates device authorization.
    /// - Returns: Device authorization response
    /// - Throws: DeviceFlowError if authorization fails
    public func authorize() async throws -> DeviceAuthResponse {
        var request = URLRequest(url: URL(string: Self.authURL)!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "client_id=\(clientId)".data(using: .utf8)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw DeviceFlowError.authorizationFailed(String(data: data, encoding: .utf8) ?? "Unknown error")
        }

        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DeviceFlowError.invalidResponse
        }

        guard let deviceCode = json["device_code"] as? String,
              let userCode = json["user_code"] as? String,
              let verificationUri = json["verification_uri"] as? String else {
            throw DeviceFlowError.invalidResponse
        }

        return DeviceAuthResponse(
            deviceCode: deviceCode,
            userCode: userCode,
            verificationUri: verificationUri,
            verificationUriComplete: json["verification_uri_complete"] as? String,
            expiresIn: json["expires_in"] as? Int ?? 900,
            interval: json["interval"] as? Int ?? 5
        )
    }

    /// Polls for token after user authorization.
    /// - Parameters:
    ///   - deviceCode: Device code from authorization response
    ///   - interval: Polling interval in seconds
    ///   - timeout: Maximum time to wait in seconds
    ///   - onPoll: Callback for each poll attempt (optional)
    /// - Returns: Token response
    /// - Throws: DeviceFlowError if polling fails
    public func pollForToken(
        deviceCode: String,
        interval: Int = 5,
        timeout: Int = 900,
        onPoll: ((Int) -> Void)? = nil
    ) async throws -> TokenResponse {
        let startTime = Date()
        var pollInterval = interval
        var attempts = 0

        while Date().timeIntervalSince(startTime) < Double(timeout) {
            attempts += 1
            onPoll?(attempts)

            let body = "client_id=\(clientId)&device_code=\(deviceCode)&grant_type=urn:ietf:params:oauth:grant-type:device_code"

            var request = URLRequest(url: URL(string: Self.tokenURL)!)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = body.data(using: .utf8)

            let (data, _) = try await session.data(for: request)

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw DeviceFlowError.invalidResponse
            }

            if let error = json["error"] as? String {
                if error == "slow_down" {
                    pollInterval += 5
                }

                if error != "authorization_pending" && error != "slow_down" {
                    return TokenResponse(
                        accessToken: nil,
                        refreshToken: nil,
                        tokenType: "Bearer",
                        expiresIn: 0,
                        error: error,
                        errorDescription: json["error_description"] as? String
                    )
                }
            } else if let accessToken = json["access_token"] as? String {
                return TokenResponse(
                    accessToken: accessToken,
                    refreshToken: json["refresh_token"] as? String,
                    tokenType: json["token_type"] as? String ?? "Bearer",
                    expiresIn: json["expires_in"] as? Int ?? 3600,
                    error: nil,
                    errorDescription: nil
                )
            }

            try await Task.sleep(nanoseconds: UInt64(pollInterval) * 1_000_000_000)
        }

        throw DeviceFlowError.timeout
    }

    /// Gets the client ID.
    /// - Returns: OAuth client ID
    public func getClientId() -> String {
        return clientId
    }
}
