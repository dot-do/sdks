package do_.{{name}}

import do_.rpc.RpcClient
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * {{Name}}.do SDK client.
 *
 * Example usage:
 * ```kotlin
 * val client = {{Name}}Client(System.getenv("DOTDO_KEY"))
 * val rpc = client.connect()
 * val result = rpc.call("example")
 * ```
 *
 * @param apiKey The API key for authentication
 * @param baseUrl The base URL for the service (defaults to https://{{name}}.do)
 */
class {{Name}}Client(
    val apiKey: String? = null,
    val baseUrl: String = DEFAULT_BASE_URL
) : AutoCloseable {

    private var rpc: RpcClient? = null
    private val mutex = Mutex()

    /**
     * Connect to the {{name}}.do service.
     *
     * @return The connected RPC client
     * @throws {{Name}}Exception if connection fails
     */
    suspend fun connect(): RpcClient = mutex.withLock {
        rpc?.let { return it }

        try {
            val headers = buildMap {
                apiKey?.let { put("Authorization", "Bearer $it") }
            }
            val client = RpcClient.connect(baseUrl, headers)
            rpc = client
            client
        } catch (e: Exception) {
            throw {{Name}}Exception("Failed to connect", e)
        }
    }

    /**
     * Disconnect from the service.
     */
    suspend fun disconnect() = mutex.withLock {
        rpc?.close()
        rpc = null
    }

    override fun close() {
        rpc?.close()
        rpc = null
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://{{name}}.do"
    }
}

/**
 * Exception thrown by {{Name}} operations.
 */
class {{Name}}Exception(message: String, cause: Throwable? = null) : Exception(message, cause)
