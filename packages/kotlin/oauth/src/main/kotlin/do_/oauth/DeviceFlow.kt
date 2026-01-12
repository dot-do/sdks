package do_.oauth

import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.client.statement.*
import io.ktor.http.*
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.TimeoutException

/**
 * Device flow authorization for OAuth.
 * Implements the device authorization grant flow.
 */
class DeviceFlow(
    private val clientId: String = DEFAULT_CLIENT_ID
) {
    companion object {
        private const val AUTH_URL = "https://auth.apis.do/user_management/authorize_device"
        private const val TOKEN_URL = "https://auth.apis.do/user_management/authenticate"
        const val DEFAULT_CLIENT_ID = "client_01JQYTRXK9ZPD8JPJTKDCRB656"
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val httpClient = HttpClient(CIO) {
        engine {
            requestTimeout = 30_000
        }
    }

    /**
     * Device authorization response.
     */
    @Serializable
    data class DeviceAuthResponse(
        val deviceCode: String,
        val userCode: String,
        val verificationUri: String,
        val verificationUriComplete: String? = null,
        val expiresIn: Int = 900,
        val interval: Int = 5
    ) {
        override fun toString(): String = "Visit $verificationUri and enter code: $userCode"
    }

    /**
     * Token response from authentication.
     */
    @Serializable
    data class TokenResponse(
        val accessToken: String? = null,
        val refreshToken: String? = null,
        val tokenType: String = "Bearer",
        val expiresIn: Int = 3600,
        val error: String? = null,
        val errorDescription: String? = null
    ) {
        fun isError(): Boolean = error != null
        fun isPending(): Boolean = error == "authorization_pending" || error == "slow_down"
    }

    /**
     * Initiates device authorization.
     * @return Device authorization response
     */
    suspend fun authorize(): DeviceAuthResponse {
        val response = httpClient.submitForm(
            url = AUTH_URL,
            formParameters = parameters {
                append("client_id", clientId)
            }
        )

        if (response.status != HttpStatusCode.OK) {
            throw RuntimeException("Authorization failed: ${response.bodyAsText()}")
        }

        val jsonBody = json.parseToJsonElement(response.bodyAsText()).jsonObject
        return DeviceAuthResponse(
            deviceCode = jsonBody["device_code"]?.jsonPrimitive?.content ?: "",
            userCode = jsonBody["user_code"]?.jsonPrimitive?.content ?: "",
            verificationUri = jsonBody["verification_uri"]?.jsonPrimitive?.content ?: "",
            verificationUriComplete = jsonBody["verification_uri_complete"]?.jsonPrimitive?.content,
            expiresIn = jsonBody["expires_in"]?.jsonPrimitive?.content?.toIntOrNull() ?: 900,
            interval = jsonBody["interval"]?.jsonPrimitive?.content?.toIntOrNull() ?: 5
        )
    }

    /**
     * Polls for token after user authorization.
     * @param deviceCode Device code from authorization response
     * @param interval Polling interval in seconds
     * @param timeout Maximum time to wait in seconds
     * @param onPoll Callback for each poll attempt (optional)
     * @return Token response
     */
    suspend fun pollForToken(
        deviceCode: String,
        interval: Int = 5,
        timeout: Int = 900,
        onPoll: ((Int) -> Unit)? = null
    ): TokenResponse {
        val startTime = System.currentTimeMillis()
        val timeoutMs = timeout * 1000L
        var pollInterval = interval
        var attempts = 0

        while (System.currentTimeMillis() - startTime < timeoutMs) {
            attempts++
            onPoll?.invoke(attempts)

            val response = httpClient.submitForm(
                url = TOKEN_URL,
                formParameters = parameters {
                    append("client_id", clientId)
                    append("device_code", deviceCode)
                    append("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
                }
            )

            val jsonBody = json.parseToJsonElement(response.bodyAsText()).jsonObject

            if (jsonBody.containsKey("error")) {
                val error = jsonBody["error"]?.jsonPrimitive?.content
                val errorDescription = jsonBody["error_description"]?.jsonPrimitive?.content

                if (error == "slow_down") {
                    pollInterval += 5
                }

                if (error != "authorization_pending" && error != "slow_down") {
                    return TokenResponse(
                        error = error,
                        errorDescription = errorDescription
                    )
                }
            } else {
                return TokenResponse(
                    accessToken = jsonBody["access_token"]?.jsonPrimitive?.content,
                    refreshToken = jsonBody["refresh_token"]?.jsonPrimitive?.content,
                    tokenType = jsonBody["token_type"]?.jsonPrimitive?.content ?: "Bearer",
                    expiresIn = jsonBody["expires_in"]?.jsonPrimitive?.content?.toIntOrNull() ?: 3600
                )
            }

            delay(pollInterval * 1000L)
        }

        throw TimeoutException("Authorization timed out after $timeout seconds")
    }

    /**
     * Closes the HTTP client.
     */
    fun close() {
        httpClient.close()
    }

    /**
     * Gets the client ID.
     * @return OAuth client ID
     */
    fun getClientId(): String = clientId
}
