## File-based token storage.

import std/[json, os]
import device

let
  TokenDir = getHomeDir() / ".oauth.do"
  TokenFile = TokenDir / "token"

type
  TokenStorage* = object
    tokenDir: string
    tokenFile: string

proc newTokenStorage*(tokenDir: string = TokenDir): TokenStorage =
  ## Creates a new token storage.
  TokenStorage(
    tokenDir: tokenDir,
    tokenFile: tokenDir / "token"
  )

proc saveTokens*(storage: TokenStorage, tokens: TokenResponse) =
  ## Saves tokens to file storage.
  createDir(storage.tokenDir)
  writeFile(storage.tokenFile, $tokens.toJson())
  # Note: Nim doesn't have a built-in chmod, permissions depend on umask

proc loadTokens*(storage: TokenStorage): TokenResponse =
  ## Loads tokens from file storage.
  if not fileExists(storage.tokenFile):
    raise newException(IOError, "Token file not found")

  let content = readFile(storage.tokenFile)
  let json = parseJson(content)

  TokenResponse(
    accessToken: json["access_token"].getStr(),
    refreshToken: json{"refresh_token"}.getStr(""),
    tokenType: json{"token_type"}.getStr("Bearer"),
    expiresIn: json{"expires_in"}.getInt(0)
  )

proc getAccessToken*(storage: TokenStorage): string =
  ## Gets the access token from storage.
  try:
    let tokens = storage.loadTokens()
    tokens.accessToken
  except:
    ""

proc getRefreshToken*(storage: TokenStorage): string =
  ## Gets the refresh token from storage.
  try:
    let tokens = storage.loadTokens()
    tokens.refreshToken
  except:
    ""

proc deleteTokens*(storage: TokenStorage) =
  ## Deletes stored tokens.
  if fileExists(storage.tokenFile):
    removeFile(storage.tokenFile)

proc hasTokens*(storage: TokenStorage): bool =
  ## Checks if tokens exist.
  fileExists(storage.tokenFile)
