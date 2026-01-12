package `do`.oauth

import scala.util.{Try, Success, Failure}
import io.circe.Json

/**
 * OAuth device flow client for .do APIs.
 */
class OAuthClient(clientId: String = OAuthClient.DefaultClientId) {
  private val deviceFlow = new DeviceFlow(clientId)
  private val storage = new TokenStorage()

  /**
   * Initiates device authorization flow.
   */
  def authorizeDevice(scope: String = "openid profile email"): Try[DeviceAuthResponse] = {
    deviceFlow.authorize(scope)
  }

  /**
   * Polls for tokens after user authorizes the device.
   */
  def pollForTokens(deviceCode: String, interval: Int, expiresIn: Int): Try[TokenResponse] = {
    deviceFlow.pollForTokens(deviceCode, interval, expiresIn) match {
      case Success(tokens) =>
        storage.saveTokens(tokens)
        Success(tokens)
      case f @ Failure(_) => f
    }
  }

  /**
   * Gets current user info using stored access token.
   */
  def getUser(accessToken: Option[String] = None): Try[Json] = {
    val token = accessToken.orElse(storage.getAccessToken())
    token match {
      case Some(t) => deviceFlow.getUserInfo(t)
      case None => Failure(new Exception("No access token available"))
    }
  }

  /**
   * Interactive login flow.
   */
  def login(scope: String = "openid profile email"): Try[TokenResponse] = {
    authorizeDevice(scope) match {
      case Success(deviceInfo) =>
        println(s"\nTo sign in, visit: ${deviceInfo.verificationUri}")
        println(s"And enter code: ${deviceInfo.userCode}\n")
        pollForTokens(deviceInfo.deviceCode, deviceInfo.interval, deviceInfo.expiresIn)
      case Failure(e) => Failure(e)
    }
  }

  /**
   * Logs out by removing stored tokens.
   */
  def logout(): Try[Unit] = {
    storage.deleteTokens()
  }
}

object OAuthClient {
  val DefaultClientId = "client_01JQYTRXK9ZPD8JPJTKDCRB656"

  def apply(clientId: String = DefaultClientId): OAuthClient = new OAuthClient(clientId)
}
