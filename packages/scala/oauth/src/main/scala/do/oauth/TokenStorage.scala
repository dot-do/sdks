package `do`.oauth

import java.nio.file.{Files, Paths, StandardOpenOption}
import io.circe._
import io.circe.parser._
import io.circe.syntax._
import scala.util.{Try, Success, Failure}

/**
 * File-based token storage.
 */
class TokenStorage(tokenDir: String = TokenStorage.DefaultTokenDir) {
  private val tokenFile = Paths.get(tokenDir, "token")

  /**
   * Saves tokens to file storage.
   */
  def saveTokens(tokens: TokenResponse): Try[Unit] = Try {
    val dir = Paths.get(tokenDir)
    if (!Files.exists(dir)) {
      Files.createDirectories(dir)
    }

    val json = Json.obj(
      "access_token" -> Json.fromString(tokens.accessToken),
      "refresh_token" -> tokens.refreshToken.map(Json.fromString).getOrElse(Json.Null),
      "token_type" -> Json.fromString(tokens.tokenType),
      "expires_in" -> tokens.expiresIn.map(Json.fromInt).getOrElse(Json.Null)
    )

    Files.writeString(tokenFile, json.noSpaces)
  }

  /**
   * Loads tokens from file storage.
   */
  def loadTokens(): Try[TokenResponse] = Try {
    val content = Files.readString(tokenFile)
    parse(content).flatMap { json =>
      val cursor = json.hcursor
      for {
        accessToken <- cursor.get[String]("access_token")
        refreshToken = cursor.get[String]("refresh_token").toOption
        tokenType <- cursor.getOrElse[String]("token_type")("Bearer")
        expiresIn = cursor.get[Int]("expires_in").toOption
      } yield TokenResponse(accessToken, refreshToken, tokenType, expiresIn)
    }.toTry.get
  }

  /**
   * Gets the access token from storage.
   */
  def getAccessToken(): Option[String] = {
    loadTokens().toOption.map(_.accessToken)
  }

  /**
   * Gets the refresh token from storage.
   */
  def getRefreshToken(): Option[String] = {
    loadTokens().toOption.flatMap(_.refreshToken)
  }

  /**
   * Deletes stored tokens.
   */
  def deleteTokens(): Try[Unit] = Try {
    if (Files.exists(tokenFile)) {
      Files.delete(tokenFile)
    }
  }

  /**
   * Checks if tokens exist.
   */
  def hasTokens: Boolean = Files.exists(tokenFile)
}

object TokenStorage {
  val DefaultTokenDir: String = System.getProperty("user.home") + "/.oauth.do"
}
