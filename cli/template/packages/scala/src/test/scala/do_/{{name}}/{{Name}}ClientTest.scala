package do_.{{name}}

import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class {{Name}}ClientTest extends AnyFlatSpec with Matchers {

  "{{Name}}Client" should "create with default options" in {
    val client = {{Name}}Client()
    client.baseUrl shouldBe "https://{{name}}.do"
  }

  it should "create with custom base URL" in {
    val client = {{Name}}Client(baseUrl = "https://custom.{{name}}.do")
    client.baseUrl shouldBe "https://custom.{{name}}.do"
  }

  it should "accept API key" in {
    val client = {{Name}}Client(apiKey = Some("test-key"))
    client shouldBe a[{{Name}}Client]
  }

  it should "create with options case class" in {
    val options = {{Name}}ClientOptions(
      apiKey = Some("test-key"),
      baseUrl = "https://test.{{name}}.do"
    )
    val client = new {{Name}}Client(options)
    client.baseUrl shouldBe "https://test.{{name}}.do"
  }
}
