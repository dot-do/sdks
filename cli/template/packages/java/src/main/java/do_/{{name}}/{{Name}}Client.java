package do_.{{name}};

import do_.rpc.RpcClient;
import do_.rpc.RpcConnection;

/**
 * {{Name}}.do SDK client.
 *
 * <p>Example usage:
 * <pre>{@code
 * var client = new {{Name}}Client(System.getenv("DOTDO_KEY"));
 * var rpc = client.connect();
 * var result = rpc.call("example");
 * }</pre>
 */
public class {{Name}}Client implements AutoCloseable {
    private static final String DEFAULT_BASE_URL = "https://{{name}}.do";

    private final String apiKey;
    private final String baseUrl;
    private RpcClient rpc;

    /**
     * Create a new client with an API key.
     *
     * @param apiKey the API key for authentication
     */
    public {{Name}}Client(String apiKey) {
        this(apiKey, DEFAULT_BASE_URL);
    }

    /**
     * Create a new client with an API key and custom base URL.
     *
     * @param apiKey the API key for authentication
     * @param baseUrl the base URL for the service
     */
    public {{Name}}Client(String apiKey, String baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    /**
     * Connect to the {{name}}.do service.
     *
     * @return the connected RPC client
     * @throws {{Name}}Exception if connection fails
     */
    public RpcClient connect() throws {{Name}}Exception {
        if (rpc != null) {
            return rpc;
        }

        try {
            var connection = RpcConnection.builder()
                .url(baseUrl)
                .header("Authorization", "Bearer " + apiKey)
                .build();
            rpc = new RpcClient(connection);
            return rpc;
        } catch (Exception e) {
            throw new {{Name}}Exception("Failed to connect", e);
        }
    }

    /**
     * Get the base URL.
     *
     * @return the base URL
     */
    public String getBaseUrl() {
        return baseUrl;
    }

    /**
     * Get the API key.
     *
     * @return the API key
     */
    public String getApiKey() {
        return apiKey;
    }

    @Override
    public void close() {
        if (rpc != null) {
            rpc.close();
            rpc = null;
        }
    }
}
