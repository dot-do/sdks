/**
 * OAuth device flow SDK for .do APIs.
 * @module
 */

export { OAuthClient, type OAuthClientOptions } from "./device.ts";
export {
  authorizeDevice,
  pollForTokens,
  getUserInfo,
  type DeviceAuthResponse,
  type TokenResponse,
} from "./device.ts";
export {
  saveTokens,
  loadTokens,
  getAccessToken,
  getRefreshToken,
  deleteTokens,
  hasTokens,
} from "./storage.ts";

import { OAuthClient } from "./device.ts";

/**
 * Default client instance.
 */
export const defaultClient = new OAuthClient();

/**
 * Interactive login flow using default client.
 */
export async function login(scope?: string) {
  return defaultClient.login(scope);
}

/**
 * Logout using default client.
 */
export async function logout() {
  return defaultClient.logout();
}

/**
 * Get user info using default client.
 */
export async function getUser(accessToken?: string) {
  return defaultClient.getUser(accessToken);
}
