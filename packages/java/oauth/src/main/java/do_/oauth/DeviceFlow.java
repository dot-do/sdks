package do_.oauth;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.*;
import java.util.function.Consumer;

/**
 * Device flow authorization for OAuth.
 * Implements the device authorization grant flow.
 */
public class DeviceFlow {
    private static final String AUTH_URL = "https://auth.apis.do/user_management/authorize_device";
    private static final String TOKEN_URL = "https://auth.apis.do/user_management/authenticate";
    private static final Gson gson = new Gson();

    private final String clientId;
    private final HttpClient httpClient;

    /**
     * Device authorization response.
     */
    public static class DeviceAuthResponse {
        public String deviceCode;
        public String userCode;
        public String verificationUri;
        public String verificationUriComplete;
        public int expiresIn;
        public int interval;

        @Override
        public String toString() {
            return String.format(
                "Visit %s and enter code: %s",
                verificationUri, userCode
            );
        }
    }

    /**
     * Token response from authentication.
     */
    public static class TokenResponse {
        public String accessToken;
        public String refreshToken;
        public String tokenType;
        public int expiresIn;
        public String error;
        public String errorDescription;

        public boolean isError() {
            return error != null;
        }

        public boolean isPending() {
            return "authorization_pending".equals(error) || "slow_down".equals(error);
        }
    }

    /**
     * Creates a DeviceFlow with the default client ID.
     */
    public DeviceFlow() {
        this("client_01JQYTRXK9ZPD8JPJTKDCRB656");
    }

    /**
     * Creates a DeviceFlow with a custom client ID.
     * @param clientId OAuth client ID
     */
    public DeviceFlow(String clientId) {
        this.clientId = clientId;
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    }

    /**
     * Initiates device authorization.
     * @return Device authorization response
     * @throws IOException If the request fails
     * @throws InterruptedException If the request is interrupted
     */
    public DeviceAuthResponse authorize() throws IOException, InterruptedException {
        String body = String.format("client_id=%s", URLEncoder.encode(clientId, "UTF-8"));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(AUTH_URL))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            throw new IOException("Authorization failed: " + response.body());
        }

        JsonObject json = gson.fromJson(response.body(), JsonObject.class);
        DeviceAuthResponse auth = new DeviceAuthResponse();
        auth.deviceCode = json.get("device_code").getAsString();
        auth.userCode = json.get("user_code").getAsString();
        auth.verificationUri = json.get("verification_uri").getAsString();
        if (json.has("verification_uri_complete")) {
            auth.verificationUriComplete = json.get("verification_uri_complete").getAsString();
        }
        auth.expiresIn = json.has("expires_in") ? json.get("expires_in").getAsInt() : 900;
        auth.interval = json.has("interval") ? json.get("interval").getAsInt() : 5;

        return auth;
    }

    /**
     * Polls for token after user authorization.
     * @param deviceCode Device code from authorization response
     * @param interval Polling interval in seconds
     * @param timeout Maximum time to wait in seconds
     * @return Token response
     * @throws IOException If the request fails
     * @throws InterruptedException If polling is interrupted
     * @throws TimeoutException If polling times out
     */
    public TokenResponse pollForToken(String deviceCode, int interval, int timeout)
            throws IOException, InterruptedException, TimeoutException {
        return pollForToken(deviceCode, interval, timeout, null);
    }

    /**
     * Polls for token after user authorization with progress callback.
     * @param deviceCode Device code from authorization response
     * @param interval Polling interval in seconds
     * @param timeout Maximum time to wait in seconds
     * @param onPoll Callback for each poll attempt (optional)
     * @return Token response
     * @throws IOException If the request fails
     * @throws InterruptedException If polling is interrupted
     * @throws TimeoutException If polling times out
     */
    public TokenResponse pollForToken(String deviceCode, int interval, int timeout,
            Consumer<Integer> onPoll) throws IOException, InterruptedException, TimeoutException {
        long startTime = System.currentTimeMillis();
        long timeoutMs = timeout * 1000L;
        int pollInterval = interval;
        int attempts = 0;

        while (System.currentTimeMillis() - startTime < timeoutMs) {
            attempts++;
            if (onPoll != null) {
                onPoll.accept(attempts);
            }

            String body = String.format(
                "client_id=%s&device_code=%s&grant_type=urn:ietf:params:oauth:grant-type:device_code",
                URLEncoder.encode(clientId, "UTF-8"),
                URLEncoder.encode(deviceCode, "UTF-8")
            );

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(TOKEN_URL))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            JsonObject json = gson.fromJson(response.body(), JsonObject.class);

            TokenResponse token = new TokenResponse();

            if (json.has("error")) {
                token.error = json.get("error").getAsString();
                if (json.has("error_description")) {
                    token.errorDescription = json.get("error_description").getAsString();
                }

                if ("slow_down".equals(token.error)) {
                    pollInterval += 5;
                }

                if (!token.isPending()) {
                    return token;
                }
            } else {
                token.accessToken = json.get("access_token").getAsString();
                if (json.has("refresh_token")) {
                    token.refreshToken = json.get("refresh_token").getAsString();
                }
                token.tokenType = json.has("token_type") ? json.get("token_type").getAsString() : "Bearer";
                token.expiresIn = json.has("expires_in") ? json.get("expires_in").getAsInt() : 3600;
                return token;
            }

            Thread.sleep(pollInterval * 1000L);
        }

        throw new TimeoutException("Authorization timed out after " + timeout + " seconds");
    }

    /**
     * Gets the client ID.
     * @return OAuth client ID
     */
    public String getClientId() {
        return clientId;
    }
}
