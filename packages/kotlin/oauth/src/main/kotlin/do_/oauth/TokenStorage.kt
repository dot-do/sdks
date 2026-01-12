package do_.oauth

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * File-based token storage for OAuth tokens.
 * Stores tokens in ~/.oauth.do/token
 */
class TokenStorage(
    private val tokenPath: Path = Paths.get(
        System.getProperty("user.home"),
        ".oauth.do",
        "token"
    )
) {
    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
    }

    /**
     * Token data structure for serialization.
     */
    @Serializable
    data class TokenData(
        val accessToken: String,
        val refreshToken: String? = null,
        val tokenType: String = "Bearer",
        val expiresAt: Long
    ) {
        fun isExpired(): Boolean = System.currentTimeMillis() / 1000 >= expiresAt
    }

    /**
     * Saves token data to disk.
     * @param data Token data to save
     */
    fun save(data: TokenData) {
        Files.createDirectories(tokenPath.parent)
        val content = json.encodeToString(data)
        Files.writeString(tokenPath, content)

        // Set restrictive permissions on Unix systems
        try {
            val file = tokenPath.toFile()
            file.setReadable(false, false)
            file.setReadable(true, true)
            file.setWritable(false, false)
            file.setWritable(true, true)
        } catch (_: Exception) {
            // Permissions may not be supported on all systems
        }
    }

    /**
     * Loads token data from disk.
     * @return Token data, or null if not found
     */
    fun load(): TokenData? {
        if (!Files.exists(tokenPath)) {
            return null
        }

        return try {
            val content = Files.readString(tokenPath)
            json.decodeFromString<TokenData>(content)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Deletes stored token data.
     * @return true if deletion was successful
     */
    fun delete(): Boolean {
        return try {
            Files.deleteIfExists(tokenPath)
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Checks if a valid (non-expired) token exists.
     * @return true if a valid token is stored
     */
    fun hasValidToken(): Boolean {
        val data = load()
        return data != null && !data.isExpired()
    }

    /**
     * Gets the token file path.
     * @return Path to the token file
     */
    fun getTokenPath(): Path = tokenPath
}
