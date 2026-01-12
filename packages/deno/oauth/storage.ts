/**
 * File-based token storage for Deno.
 */

import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

interface TokenData {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

function getTokenDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return join(home, ".oauth.do");
}

function getTokenFile(): string {
  return join(getTokenDir(), "token");
}

/**
 * Saves tokens to file storage.
 */
export async function saveTokens(tokens: TokenData): Promise<void> {
  const tokenDir = getTokenDir();
  await ensureDir(tokenDir);

  const tokenFile = getTokenFile();
  await Deno.writeTextFile(tokenFile, JSON.stringify(tokens, null, 2));

  // Set restrictive permissions on Unix-like systems
  if (Deno.build.os !== "windows") {
    await Deno.chmod(tokenFile, 0o600);
  }
}

/**
 * Loads tokens from file storage.
 */
export async function loadTokens(): Promise<TokenData | null> {
  try {
    const tokenFile = getTokenFile();
    const content = await Deno.readTextFile(tokenFile);
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Gets the access token from storage.
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  return tokens?.access_token ?? null;
}

/**
 * Gets the refresh token from storage.
 */
export async function getRefreshToken(): Promise<string | null> {
  const tokens = await loadTokens();
  return tokens?.refresh_token ?? null;
}

/**
 * Deletes stored tokens.
 */
export async function deleteTokens(): Promise<void> {
  try {
    const tokenFile = getTokenFile();
    await Deno.remove(tokenFile);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/**
 * Checks if tokens exist.
 */
export async function hasTokens(): Promise<boolean> {
  try {
    const tokenFile = getTokenFile();
    await Deno.stat(tokenFile);
    return true;
  } catch {
    return false;
  }
}
