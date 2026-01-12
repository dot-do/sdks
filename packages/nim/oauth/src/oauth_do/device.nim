## Device flow authentication for OAuth.

import std/[httpclient, json, times, os]

const
  AuthUrl = "https://auth.apis.do/user_management/authorize_device"
  TokenUrl = "https://auth.apis.do/user_management/authenticate"
  UserUrl = "https://apis.do/me"

type
  DeviceAuthResponse* = object
    deviceCode*: string
    userCode*: string
    verificationUri*: string
    expiresIn*: int
    interval*: int

  TokenResponse* = object
    accessToken*: string
    refreshToken*: string
    tokenType*: string
    expiresIn*: int

  DeviceFlow* = object
    clientId: string

proc newDeviceFlow*(clientId: string): DeviceFlow =
  ## Creates a new device flow handler.
  DeviceFlow(clientId: clientId)

proc parseDeviceAuthResponse(json: JsonNode): DeviceAuthResponse =
  DeviceAuthResponse(
    deviceCode: json["device_code"].getStr(),
    userCode: json["user_code"].getStr(),
    verificationUri: json["verification_uri"].getStr(),
    expiresIn: json{"expires_in"}.getInt(900),
    interval: json{"interval"}.getInt(5)
  )

proc parseTokenResponse(json: JsonNode): TokenResponse =
  TokenResponse(
    accessToken: json["access_token"].getStr(),
    refreshToken: json{"refresh_token"}.getStr(""),
    tokenType: json{"token_type"}.getStr("Bearer"),
    expiresIn: json{"expires_in"}.getInt(0)
  )

proc toJson*(resp: TokenResponse): JsonNode =
  result = %*{
    "access_token": resp.accessToken,
    "token_type": resp.tokenType
  }
  if resp.refreshToken != "":
    result["refresh_token"] = %resp.refreshToken
  if resp.expiresIn > 0:
    result["expires_in"] = %resp.expiresIn

proc authorize*(flow: DeviceFlow, scope: string = "openid profile email"): DeviceAuthResponse =
  ## Initiates device authorization.
  let client = newHttpClient()
  client.headers = newHttpHeaders({"Content-Type": "application/json"})

  let body = %*{
    "client_id": flow.clientId,
    "scope": scope
  }

  let response = client.request(AuthUrl, httpMethod = HttpPost, body = $body)

  if response.code != Http200:
    raise newException(IOError, "Authorization failed: " & response.body)

  let json = parseJson(response.body)
  parseDeviceAuthResponse(json)

proc pollForTokens*(flow: DeviceFlow, deviceCode: string, interval: int, expiresIn: int): TokenResponse =
  ## Polls for tokens until user authorizes or timeout.
  let deadline = epochTime() + float(expiresIn)
  var currentInterval = interval

  let client = newHttpClient()
  client.headers = newHttpHeaders({"Content-Type": "application/json"})

  while epochTime() < deadline:
    let body = %*{
      "client_id": flow.clientId,
      "device_code": deviceCode,
      "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    }

    let response = client.request(TokenUrl, httpMethod = HttpPost, body = $body)

    if response.code == Http200:
      let json = parseJson(response.body)
      return parseTokenResponse(json)

    if response.code == Http400:
      let json = parseJson(response.body)
      let error = json{"error"}.getStr("")

      case error
      of "authorization_pending":
        sleep(currentInterval * 1000)
        continue
      of "slow_down":
        currentInterval += 5
        sleep(currentInterval * 1000)
        continue
      else:
        raise newException(IOError, "Token request failed: " & error)

    raise newException(IOError, "Unexpected response: " & $response.code)

  raise newException(IOError, "Authorization expired")

proc getUserInfo*(flow: DeviceFlow, accessToken: string): JsonNode =
  ## Gets user info with access token.
  let client = newHttpClient()
  client.headers = newHttpHeaders({"Authorization": "Bearer " & accessToken})

  let response = client.request(UserUrl, httpMethod = HttpGet)

  if response.code != Http200:
    raise newException(IOError, "Failed to get user info: " & $response.code)

  parseJson(response.body)
