package do_.{{name}};

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class {{Name}}ClientTest {

    @Test
    void shouldCreateClientWithApiKey() {
        var client = new {{Name}}Client("test-key");
        assertThat(client.getApiKey()).isEqualTo("test-key");
        assertThat(client.getBaseUrl()).isEqualTo("https://{{name}}.do");
    }

    @Test
    void shouldCreateClientWithCustomBaseUrl() {
        var client = new {{Name}}Client("test-key", "https://custom.{{name}}.do");
        assertThat(client.getBaseUrl()).isEqualTo("https://custom.{{name}}.do");
    }
}
