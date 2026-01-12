/**
 * Device flow authentication for OAuth.
 */

import { saveTokens, getAccessToken } from "./storage.ts";

const DEFAULT_CLIENT_ID = "client_01JQYTRXK9ZPD8JPJTKDCRB656";
const AUTH_URL = "https://auth.apis.do/user_management/authorize_device";
const TOKEN_URL = "https://auth.apis.do/user_management/authenticate";
const USER_URL = "https://apis.do/me";

export interface OAuthClientOptions {
  clientId?: string;
}

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Initiates device authorization.
 */
export async function authorizeDevice(
  clientId: string = DEFAULT_CLIENT_ID,
  scope: string = "openid profile email"
): Promise<DeviceAuthResponse> {
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Authorization failed: ${error}`);
  }

  return response.json();
}

/**
 * Polls for tokens until user authorizes or timeout.
 */
export async function pollForTokens(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  clientId: string = DEFAULT_CLIENT_ID
): Promise<TokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;
  let currentInterval = interval;

  while (Date.now() < deadline) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (response.ok) {
      const tokens = await response.json();
      await saveTokens(tokens);
      return tokens;
    }

    if (response.status === 400) {
      const body = await response.json();
      const error = body.error;

      if (error === "authorization_pending") {
        await sleep(currentInterval * 1000);
        continue;
      }

      if (error === "slow_down") {
        currentInterval += 5;
        await sleep(currentInterval * 1000);
        continue;
      }

      throw new Error(`Token request failed: ${error}`);
    }

    throw new Error(`Unexpected response: ${response.status}`);
  }

  throw new Error("Authorization expired");
}

/**
 * Gets user info with access token.
 */
export async function getUserInfo(accessToken: string): Promise<unknown> {
  const response = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OAuth client for device flow authentication.
 */
export class OAuthClient {
  private clientId: string;

  constructor(options: OAuthClientOptions = {}) {
    this.clientId = options.clientId ?? DEFAULT_CLIENT_ID;
  }

  /**
   * Initiates device authorization.
   */
  async authorizeDevice(
    scope: string = "openid profile email"
  ): Promise<DeviceAuthResponse> {
    return authorizeDevice(this.clientId, scope);
  }

  /**
   * Polls for tokens after user authorizes.
   */
  async pollForTokens(
    deviceCode: string,
    interval: number,
    expiresIn: number
  ): Promise<TokenResponse> {
    return pollForTokens(deviceCode, interval, expiresIn, this.clientId);
  }

  /**
   * Gets current user info.
   */
  async getUser(accessToken?: string): Promise<unknown> {
    const token = accessToken ?? (await getAccessToken());
    if (!token) {
      throw new Error("No access token available");
    }
    return getUserInfo(token);
  }

  /**
   * Interactive login flow.
   */
  async login(scope: string = "openid profile email"): Promise<TokenResponse> {
    const deviceInfo = await this.authorizeDevice(scope);

    console.log(`\nTo sign in, visit: ${deviceInfo.verification_uri}`);
    console.log(`And enter code: ${deviceInfo.user_code}\n`);

    return this.pollForTokens(
      deviceInfo.device_code,
      deviceInfo.interval ?? 5,
      deviceInfo.expires_in ?? 900
    );
  }

  /**
   * Logs out by removing stored tokens.
   */
  async logout(): Promise<void> {
    const { deleteTokens } = await import("./storage.ts");
    await deleteTokens();
  }
}
