package do_.oauth

import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * OAuth client for .do platform authentication.
 * Provides device flow authentication and token management.
 */
class OAuthClient(
    private val deviceFlow: DeviceFlow = DeviceFlow(),
    private val tokenStorage: TokenStorage = TokenStorage()
) {
    companion object {
        private const val USER_INFO_URL = "https://apis.do/me"
    }

    /**
     * Creates an OAuthClient with a custom client ID.
     * @param clientId OAuth client ID
     */
    constructor(clientId: String) : this(DeviceFlow(clientId), TokenStorage())

    private val json = Json { ignoreUnknownKeys = true }
    private val httpClient = HttpClient(CIO) {
        engine {
            requestTimeout = 30_000
        }
    }

    /**
     * User information response.
     */
    @Serializable
    data class UserInfo(
        val id: String? = null,
        val email: String? = null,
        val name: String? = null,
        val picture: String? = null
    ) {
        override fun toString(): String = "User(id='$id', email='$email', name='$name')"
    }

    /**
     * Performs device flow login.
     * @param onPrompt Callback to display authorization URL and code to user
     * @param onPoll Callback for each poll attempt (optional)
     * @return Token data after successful authentication
     */
    suspend fun login(
        onPrompt: (DeviceFlow.DeviceAuthResponse) -> Unit,
        onPoll: ((Int) -> Unit)? = null
    ): TokenStorage.TokenData {
        // Initiate device authorization
        val auth = deviceFlow.authorize()

        // Show prompt to user
        onPrompt(auth)

        // Poll for token
        val token = deviceFlow.pollForToken(
            deviceCode = auth.deviceCode,
            interval = auth.interval,
            timeout = auth.expiresIn,
            onPoll = onPoll
        )

        if (token.isError()) {
            throw RuntimeException("Authentication failed: ${token.error}" +
                (token.errorDescription?.let { " - $it" } ?: ""))
        }

        // Save token
        val expiresAt = System.currentTimeMillis() / 1000 + token.expiresIn
        val tokenData = TokenStorage.TokenData(
            accessToken = token.accessToken!!,
            refreshToken = token.refreshToken,
            tokenType = token.tokenType,
            expiresAt = expiresAt
        )
        tokenStorage.save(tokenData)

        return tokenData
    }

    /**
     * Logs out by deleting stored tokens.
     * @return true if logout was successful
     */
    fun logout(): Boolean = tokenStorage.delete()

    /**
     * Gets the current access token if valid.
     * @return Access token, or null if not authenticated
     */
    fun getAccessToken(): String? {
        val data = tokenStorage.load()
        return if (data != null && !data.isExpired()) data.accessToken else null
    }

    /**
     * Checks if user is authenticated with a valid token.
     * @return true if authenticated
     */
    fun isAuthenticated(): Boolean = tokenStorage.hasValidToken()

    /**
     * Gets user information for the authenticated user.
     * @return User information
     */
    suspend fun getUserInfo(): UserInfo {
        val accessToken = getAccessToken()
            ?: throw RuntimeException("Not authenticated")

        val response = httpClient.get(USER_INFO_URL) {
            header(HttpHeaders.Authorization, "Bearer $accessToken")
        }

        if (response.status != HttpStatusCode.OK) {
            throw RuntimeException("Failed to get user info: ${response.bodyAsText()}")
        }

        val jsonBody = json.parseToJsonElement(response.bodyAsText()).jsonObject

        // Handle nested user object if present
        val userData = jsonBody["user"]?.jsonObject ?: jsonBody

        return UserInfo(
            id = userData["id"]?.jsonPrimitive?.content,
            email = userData["email"]?.jsonPrimitive?.content,
            name = userData["name"]?.jsonPrimitive?.content,
            picture = userData["picture"]?.jsonPrimitive?.content
        )
    }

    /**
     * Closes the HTTP client and device flow.
     */
    fun close() {
        httpClient.close()
        deviceFlow.close()
    }

    /**
     * Gets the device flow handler.
     * @return DeviceFlow instance
     */
    fun getDeviceFlow(): DeviceFlow = deviceFlow

    /**
     * Gets the token storage handler.
     * @return TokenStorage instance
     */
    fun getTokenStorage(): TokenStorage = tokenStorage
}
