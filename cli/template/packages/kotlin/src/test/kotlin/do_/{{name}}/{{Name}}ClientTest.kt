package do_.{{name}}

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class {{Name}}ClientTest {

    @Test
    fun `should create client with api key`() {
        val client = {{Name}}Client("test-key")
        assertEquals("test-key", client.apiKey)
        assertEquals("https://{{name}}.do", client.baseUrl)
    }

    @Test
    fun `should create client with custom base url`() {
        val client = {{Name}}Client("test-key", "https://custom.{{name}}.do")
        assertEquals("https://custom.{{name}}.do", client.baseUrl)
    }

    @Test
    fun `should create client without api key`() {
        val client = {{Name}}Client()
        assertNull(client.apiKey)
    }
}
