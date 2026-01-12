package do_.oauth;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * OAuth client for .do platform authentication.
 * Provides device flow authentication and token management.
 */
public class OAuthClient {
    private static final String USER_INFO_URL = "https://apis.do/me";
    private static final Gson gson = new Gson();

    private final DeviceFlow deviceFlow;
    private final TokenStorage tokenStorage;
    private final HttpClient httpClient;

    /**
     * User information response.
     */
    public static class UserInfo {
        public String id;
        public String email;
        public String name;
        public String picture;

        @Override
        public String toString() {
            return String.format("User{id='%s', email='%s', name='%s'}", id, email, name);
        }
    }

    /**
     * Creates an OAuthClient with default configuration.
     */
    public OAuthClient() {
        this(new DeviceFlow(), new TokenStorage());
    }

    /**
     * Creates an OAuthClient with a custom client ID.
     * @param clientId OAuth client ID
     */
    public OAuthClient(String clientId) {
        this(new DeviceFlow(clientId), new TokenStorage());
    }

    /**
     * Creates an OAuthClient with custom components.
     * @param deviceFlow Device flow handler
     * @param tokenStorage Token storage handler
     */
    public OAuthClient(DeviceFlow deviceFlow, TokenStorage tokenStorage) {
        this.deviceFlow = deviceFlow;
        this.tokenStorage = tokenStorage;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    }

    /**
     * Performs device flow login.
     * @param onPrompt Callback to display authorization URL and code to user
     * @return Token data after successful authentication
     * @throws IOException If authentication fails
     * @throws InterruptedException If authentication is interrupted
     * @throws TimeoutException If authentication times out
     */
    public TokenStorage.TokenData login(Consumer<DeviceFlow.DeviceAuthResponse> onPrompt)
            throws IOException, InterruptedException, TimeoutException {
        return login(onPrompt, null);
    }

    /**
     * Performs device flow login with poll progress callback.
     * @param onPrompt Callback to display authorization URL and code to user
     * @param onPoll Callback for each poll attempt
     * @return Token data after successful authentication
     * @throws IOException If authentication fails
     * @throws InterruptedException If authentication is interrupted
     * @throws TimeoutException If authentication times out
     */
    public TokenStorage.TokenData login(Consumer<DeviceFlow.DeviceAuthResponse> onPrompt,
            Consumer<Integer> onPoll) throws IOException, InterruptedException, TimeoutException {
        // Initiate device authorization
        DeviceFlow.DeviceAuthResponse auth = deviceFlow.authorize();

        // Show prompt to user
        if (onPrompt != null) {
            onPrompt.accept(auth);
        }

        // Poll for token
        DeviceFlow.TokenResponse token = deviceFlow.pollForToken(
            auth.deviceCode,
            auth.interval,
            auth.expiresIn,
            onPoll
        );

        if (token.isError()) {
            throw new IOException("Authentication failed: " + token.error +
                (token.errorDescription != null ? " - " + token.errorDescription : ""));
        }

        // Save token
        long expiresAt = System.currentTimeMillis() / 1000 + token.expiresIn;
        TokenStorage.TokenData tokenData = new TokenStorage.TokenData(
            token.accessToken,
            token.refreshToken,
            token.tokenType,
            expiresAt
        );
        tokenStorage.save(tokenData);

        return tokenData;
    }

    /**
     * Logs out by deleting stored tokens.
     * @return true if logout was successful
     */
    public boolean logout() {
        return tokenStorage.delete();
    }

    /**
     * Gets the current access token if valid.
     * @return Access token, or null if not authenticated
     */
    public String getAccessToken() {
        TokenStorage.TokenData data = tokenStorage.load();
        if (data != null && !data.isExpired()) {
            return data.accessToken;
        }
        return null;
    }

    /**
     * Checks if user is authenticated with a valid token.
     * @return true if authenticated
     */
    public boolean isAuthenticated() {
        return tokenStorage.hasValidToken();
    }

    /**
     * Gets user information for the authenticated user.
     * @return User information
     * @throws IOException If the request fails or user is not authenticated
     * @throws InterruptedException If the request is interrupted
     */
    public UserInfo getUserInfo() throws IOException, InterruptedException {
        String accessToken = getAccessToken();
        if (accessToken == null) {
            throw new IOException("Not authenticated");
        }

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(USER_INFO_URL))
            .header("Authorization", "Bearer " + accessToken)
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new IOException("Failed to get user info: " + response.body());
        }

        JsonObject json = gson.fromJson(response.body(), JsonObject.class);
        UserInfo user = new UserInfo();

        // Handle nested user object if present
        JsonObject userData = json.has("user") ? json.getAsJsonObject("user") : json;

        if (userData.has("id")) user.id = userData.get("id").getAsString();
        if (userData.has("email")) user.email = userData.get("email").getAsString();
        if (userData.has("name")) user.name = userData.get("name").getAsString();
        if (userData.has("picture")) user.picture = userData.get("picture").getAsString();

        return user;
    }

    /**
     * Gets the device flow handler.
     * @return DeviceFlow instance
     */
    public DeviceFlow getDeviceFlow() {
        return deviceFlow;
    }

    /**
     * Gets the token storage handler.
     * @return TokenStorage instance
     */
    public TokenStorage getTokenStorage() {
        return tokenStorage;
    }
}
