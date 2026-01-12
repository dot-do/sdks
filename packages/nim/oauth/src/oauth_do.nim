## OAuth device flow SDK for .do APIs.

import std/[httpclient, json, os, times]
import oauth_do/device
import oauth_do/storage

export device, storage

const
  DefaultClientId* = "client_01JQYTRXK9ZPD8JPJTKDCRB656"

type
  OAuthClient* = object
    clientId: string
    deviceFlow: DeviceFlow
    storage: TokenStorage

proc newOAuthClient*(clientId: string = DefaultClientId): OAuthClient =
  ## Creates a new OAuth client.
  OAuthClient(
    clientId: clientId,
    deviceFlow: newDeviceFlow(clientId),
    storage: newTokenStorage()
  )

proc authorizeDevice*(client: OAuthClient, scope: string = "openid profile email"): DeviceAuthResponse =
  ## Initiates device authorization flow.
  client.deviceFlow.authorize(scope)

proc pollForTokens*(client: OAuthClient, deviceCode: string, interval: int, expiresIn: int): TokenResponse =
  ## Polls for tokens after user authorizes the device.
  let tokens = client.deviceFlow.pollForTokens(deviceCode, interval, expiresIn)
  client.storage.saveTokens(tokens)
  tokens

proc getUser*(client: OAuthClient, accessToken: string = ""): JsonNode =
  ## Gets current user info using stored or provided access token.
  var token = accessToken
  if token == "":
    token = client.storage.getAccessToken()
  if token == "":
    raise newException(ValueError, "No access token available")
  client.deviceFlow.getUserInfo(token)

proc login*(client: OAuthClient, scope: string = "openid profile email"): TokenResponse =
  ## Interactive login flow.
  let deviceInfo = client.authorizeDevice(scope)

  echo "\nTo sign in, visit: ", deviceInfo.verificationUri
  echo "And enter code: ", deviceInfo.userCode, "\n"

  let interval = if deviceInfo.interval > 0: deviceInfo.interval else: 5
  let expiresIn = if deviceInfo.expiresIn > 0: deviceInfo.expiresIn else: 900

  client.pollForTokens(deviceInfo.deviceCode, interval, expiresIn)

proc logout*(client: OAuthClient) =
  ## Logs out by removing stored tokens.
  client.storage.deleteTokens()

proc hasTokens*(client: OAuthClient): bool =
  ## Checks if tokens exist.
  client.storage.hasTokens()
