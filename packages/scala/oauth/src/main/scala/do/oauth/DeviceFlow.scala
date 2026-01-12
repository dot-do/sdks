package `do`.oauth

import sttp.client3._
import sttp.client3.circe._
import io.circe._
import io.circe.generic.auto._
import io.circe.parser._
import scala.util.{Try, Success, Failure}

case class DeviceAuthResponse(
  deviceCode: String,
  userCode: String,
  verificationUri: String,
  expiresIn: Int,
  interval: Int
)

case class TokenResponse(
  accessToken: String,
  refreshToken: Option[String],
  tokenType: String,
  expiresIn: Option[Int]
)

/**
 * Device flow authentication.
 */
class DeviceFlow(clientId: String) {
  private val backend = HttpURLConnectionBackend()
  private val authUrl = "https://auth.apis.do/user_management/authorize_device"
  private val tokenUrl = "https://auth.apis.do/user_management/authenticate"
  private val userUrl = "https://apis.do/me"

  /**
   * Initiates device authorization.
   */
  def authorize(scope: String): Try[DeviceAuthResponse] = {
    val body = Json.obj(
      "client_id" -> Json.fromString(clientId),
      "scope" -> Json.fromString(scope)
    )

    val request = basicRequest
      .post(uri"$authUrl")
      .contentType("application/json")
      .body(body.noSpaces)

    Try {
      val response = request.send(backend)
      response.body match {
        case Right(json) =>
          parse(json).flatMap { j =>
            val cursor = j.hcursor
            for {
              deviceCode <- cursor.get[String]("device_code")
              userCode <- cursor.get[String]("user_code")
              verificationUri <- cursor.get[String]("verification_uri")
              expiresIn <- cursor.getOrElse[Int]("expires_in")(900)
              interval <- cursor.getOrElse[Int]("interval")(5)
            } yield DeviceAuthResponse(deviceCode, userCode, verificationUri, expiresIn, interval)
          }.toTry.get
        case Left(error) => throw new Exception(s"Authorization failed: $error")
      }
    }
  }

  /**
   * Polls for tokens until user authorizes or timeout.
   */
  def pollForTokens(deviceCode: String, interval: Int, expiresIn: Int): Try[TokenResponse] = {
    val deadline = System.currentTimeMillis() + (expiresIn * 1000L)
    doPoll(deviceCode, interval, deadline)
  }

  private def doPoll(deviceCode: String, interval: Int, deadline: Long): Try[TokenResponse] = {
    if (System.currentTimeMillis() >= deadline) {
      Failure(new Exception("Authorization expired"))
    } else {
      val body = Json.obj(
        "client_id" -> Json.fromString(clientId),
        "device_code" -> Json.fromString(deviceCode),
        "grant_type" -> Json.fromString("urn:ietf:params:oauth:grant-type:device_code")
      )

      val request = basicRequest
        .post(uri"$tokenUrl")
        .contentType("application/json")
        .body(body.noSpaces)

      val response = request.send(backend)
      response.body match {
        case Right(json) =>
          parse(json).flatMap { j =>
            val cursor = j.hcursor
            cursor.get[String]("error") match {
              case Right("authorization_pending") =>
                Thread.sleep(interval * 1000L)
                doPoll(deviceCode, interval, deadline).toEither
              case Right("slow_down") =>
                Thread.sleep((interval + 5) * 1000L)
                doPoll(deviceCode, interval + 5, deadline).toEither
              case Right(error) =>
                Left(DecodingFailure(s"Error: $error", Nil))
              case Left(_) =>
                for {
                  accessToken <- cursor.get[String]("access_token")
                  refreshToken = cursor.get[String]("refresh_token").toOption
                  tokenType <- cursor.getOrElse[String]("token_type")("Bearer")
                  expiresIn = cursor.get[Int]("expires_in").toOption
                } yield TokenResponse(accessToken, refreshToken, tokenType, expiresIn)
            }
          }.toTry
        case Left(error) => Failure(new Exception(s"Token request failed: $error"))
      }
    }
  }

  /**
   * Gets user info with access token.
   */
  def getUserInfo(accessToken: String): Try[Json] = {
    val request = basicRequest
      .get(uri"$userUrl")
      .header("Authorization", s"Bearer $accessToken")

    Try {
      val response = request.send(backend)
      response.body match {
        case Right(json) => parse(json).toTry.get
        case Left(error) => throw new Exception(s"Failed to get user info: $error")
      }
    }
  }
}
