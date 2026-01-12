import { getConfig } from './config.js'
import type { DeviceAuthorizationResponse, TokenResponse, TokenError } from './types.js'

/**
 * OAuth provider options for direct provider login
 * Bypasses AuthKit login screen and goes directly to the provider
 */
export type OAuthProvider = 'GitHubOAuth' | 'GoogleOAuth' | 'MicrosoftOAuth' | 'AppleOAuth'

export interface DeviceAuthOptions {
	/** OAuth provider to use directly (bypasses AuthKit login screen) */
	provider?: OAuthProvider
}

/**
 * Initiate device authorization flow
 * Following OAuth 2.0 Device Authorization Grant (RFC 8628)
 *
 * @param options - Optional settings including provider for direct OAuth
 * @returns Device authorization response with codes and URIs
 */
export async function authorizeDevice(options: DeviceAuthOptions = {}): Promise<DeviceAuthorizationResponse> {
	const config = getConfig()

	if (!config.clientId) {
		throw new Error('Client ID is required for device authorization. Set OAUTH_CLIENT_ID or configure({ clientId: "..." })')
	}

	try {
		const url = 'https://auth.apis.do/user_management/authorize/device'
		const body = new URLSearchParams({
			client_id: config.clientId,
			scope: 'openid profile email',
		})

		// Add provider if specified (bypasses AuthKit login screen)
		if (options.provider) {
			body.set('provider', options.provider)
		}

		const response = await config.fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Device authorization failed: ${response.statusText} - ${errorText}`)
		}

		const data = (await response.json()) as DeviceAuthorizationResponse
		return data
	} catch (error) {
		console.error('Device authorization error:', error)
		throw error
	}
}

/**
 * Poll for tokens after device authorization
 *
 * This function implements the polling loop for OAuth 2.0 Device Authorization Grant (RFC 8628).
 * It includes careful timing logic to avoid race conditions where the timeout could be exceeded
 * due to the sleep interval.
 *
 * @param deviceCode - Device code from authorization response
 * @param interval - Polling interval in seconds (default: 5)
 * @param expiresIn - Expiration time in seconds (default: 600)
 * @returns Token response with access token and user info
 */
export async function pollForTokens(
	deviceCode: string,
	interval: number = 5,
	expiresIn: number = 600
): Promise<TokenResponse> {
	const config = getConfig()

	if (!config.clientId) {
		throw new Error('Client ID is required for token polling')
	}

	const startTime = Date.now()
	const timeout = expiresIn * 1000
	let currentInterval = interval * 1000

	while (true) {
		// Calculate elapsed time and remaining time before timeout
		const elapsed = Date.now() - startTime
		const timeRemaining = timeout - elapsed

		// Check if we've already exceeded the timeout
		if (timeRemaining <= 0) {
			throw new Error('Device authorization expired. Please try again.')
		}

		// RACE CONDITION FIX: Don't sleep longer than the remaining time.
		// Without this, we could sleep for a full interval even when there's
		// less time remaining, causing the actual timeout to exceed the specified limit.
		// Example: If timeout=100ms, interval=50ms, and we're at 80ms elapsed,
		// we should only sleep for 20ms, not 50ms.
		const sleepTime = Math.min(currentInterval, timeRemaining)
		await new Promise((resolve) => setTimeout(resolve, sleepTime))

		// Check timeout again after sleep to handle edge cases where the sleep
		// completed right at or just past the timeout boundary
		if (Date.now() - startTime > timeout) {
			throw new Error('Device authorization expired. Please try again.')
		}

		try {
			const response = await config.fetch('https://auth.apis.do/user_management/authenticate', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					device_code: deviceCode,
					client_id: config.clientId,
				}).toString(),
			})

			if (response.ok) {
				const data = (await response.json()) as TokenResponse
				return data
			}

			// Handle error responses
			const errorData = (await response.json().catch(() => ({ error: 'unknown' }))) as { error?: string }
			const error = (errorData.error || 'unknown') as TokenError

			switch (error) {
				case 'authorization_pending':
					// Continue polling
					continue

				case 'slow_down':
					// Increase interval by 5 seconds
					currentInterval += 5000
					continue

				case 'access_denied':
					throw new Error('Access denied by user')

				case 'expired_token':
					throw new Error('Device code expired')

				default:
					throw new Error(`Token polling failed: ${error}`)
			}
		} catch (error) {
			// If it's our thrown error, re-throw it
			if (error instanceof Error) {
				throw error
			}
			// Otherwise continue polling
			continue
		}
	}
}
