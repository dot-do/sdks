package do_.{{name}}

/**
 * Exception thrown by {{Name}} client operations
 */
case class {{Name}}Exception(
  message: String,
  code: Option[String] = None,
  details: Option[Any] = None,
  cause: Option[Throwable] = None
) extends Exception(message, cause.orNull) {

  override def toString: String = {
    val codeStr = code.map(c => s" [$c]").getOrElse("")
    s"{{Name}}Exception$codeStr: $message"
  }
}

object {{Name}}Exception {
  /**
   * Create from RPC error response
   */
  def fromRpcError(error: Map[String, Any]): {{Name}}Exception = {
    {{Name}}Exception(
      message = error.getOrElse("message", "Unknown error").toString,
      code = error.get("code").map(_.toString),
      details = error.get("details")
    )
  }
}
