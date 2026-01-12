package do_.{{name}}

import cats.effect.IO
import do_.rpc.RpcClient
import do_.rpc.RpcConnection

/**
 * {{Name}}.do SDK Client
 *
 * {{description}}
 *
 * @example
 * {{{
 * val client = {{Name}}Client(apiKey = sys.env.get("DOTDO_KEY"))
 * val result = client.connect().flatMap(_.call("example"))
 * }}}
 */
case class {{Name}}ClientOptions(
  apiKey: Option[String] = None,
  baseUrl: String = "https://{{name}}.do"
)

class {{Name}}Client(options: {{Name}}ClientOptions = {{Name}}ClientOptions()) {
  private var rpc: Option[RpcClient] = None

  /**
   * Connect to the {{name}}.do service
   */
  def connect(): IO[RpcClient] = {
    rpc match {
      case Some(client) => IO.pure(client)
      case None =>
        val headers = options.apiKey.map(key =>
          Map("Authorization" -> s"Bearer $key")
        ).getOrElse(Map.empty)

        RpcConnection.connect(options.baseUrl, headers).map { client =>
          rpc = Some(client)
          client
        }
    }
  }

  /**
   * Disconnect from the service
   */
  def disconnect(): IO[Unit] = IO {
    rpc = None
  }

  /**
   * Get the base URL
   */
  def baseUrl: String = options.baseUrl
}

object {{Name}}Client {
  def apply(apiKey: Option[String] = None, baseUrl: String = "https://{{name}}.do"): {{Name}}Client =
    new {{Name}}Client({{Name}}ClientOptions(apiKey, baseUrl))
}
