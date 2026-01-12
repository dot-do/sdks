package do_.oauth;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.*;
import java.nio.file.*;

/**
 * File-based token storage for OAuth tokens.
 * Stores tokens in ~/.oauth.do/token
 */
public class TokenStorage {
    private static final String DEFAULT_TOKEN_DIR = ".oauth.do";
    private static final String DEFAULT_TOKEN_FILE = "token";
    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();

    private final Path tokenPath;

    /**
     * Token data structure for serialization.
     */
    public static class TokenData {
        public String accessToken;
        public String refreshToken;
        public String tokenType;
        public long expiresAt;

        public TokenData() {}

        public TokenData(String accessToken, String refreshToken, String tokenType, long expiresAt) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.tokenType = tokenType;
            this.expiresAt = expiresAt;
        }

        public boolean isExpired() {
            return System.currentTimeMillis() / 1000 >= expiresAt;
        }
    }

    /**
     * Creates a TokenStorage with default path (~/.oauth.do/token).
     */
    public TokenStorage() {
        this(Paths.get(System.getProperty("user.home"), DEFAULT_TOKEN_DIR, DEFAULT_TOKEN_FILE));
    }

    /**
     * Creates a TokenStorage with a custom path.
     * @param tokenPath Path to the token file
     */
    public TokenStorage(Path tokenPath) {
        this.tokenPath = tokenPath;
    }

    /**
     * Saves token data to disk.
     * @param data Token data to save
     * @throws IOException If writing fails
     */
    public void save(TokenData data) throws IOException {
        Files.createDirectories(tokenPath.getParent());
        String json = gson.toJson(data);
        Files.writeString(tokenPath, json);

        // Set restrictive permissions on Unix systems
        try {
            tokenPath.toFile().setReadable(false, false);
            tokenPath.toFile().setReadable(true, true);
            tokenPath.toFile().setWritable(false, false);
            tokenPath.toFile().setWritable(true, true);
        } catch (Exception ignored) {
            // Permissions may not be supported on all systems
        }
    }

    /**
     * Loads token data from disk.
     * @return Token data, or null if not found
     */
    public TokenData load() {
        if (!Files.exists(tokenPath)) {
            return null;
        }

        try {
            String json = Files.readString(tokenPath);
            return gson.fromJson(json, TokenData.class);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * Deletes stored token data.
     * @return true if deletion was successful
     */
    public boolean delete() {
        try {
            return Files.deleteIfExists(tokenPath);
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Checks if a valid (non-expired) token exists.
     * @return true if a valid token is stored
     */
    public boolean hasValidToken() {
        TokenData data = load();
        return data != null && !data.isExpired();
    }

    /**
     * Gets the token file path.
     * @return Path to the token file
     */
    public Path getTokenPath() {
        return tokenPath;
    }
}
