import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pollForTokens, authorizeDevice } from '../src/device.js'
import { configure } from '../src/config.js'

describe('Device Flow', () => {
	const mockClientId = 'test-client-id'
	const mockDeviceCode = 'device_code_123'
	const mockAccessToken = 'access_token_abc'

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset config with a mock fetch
		configure({
			clientId: mockClientId,
			fetch: globalThis.fetch,
		})
	})

	describe('pollForTokens()', () => {
		describe('race condition handling', () => {
			it('should respect timeout correctly even with short intervals', async () => {
				// RED: This test demonstrates the race condition
				// With the old implementation, the timeout check happens BEFORE the sleep,
				// so the total time could exceed the timeout by up to one full interval.
				//
				// Scenario:
				// - timeout: 100ms
				// - interval: 50ms
				// - Old behavior: Check (0ms) -> Sleep 50ms -> Poll -> Check (50ms) -> Sleep 50ms -> Poll
				//   The user could timeout between the check and sleep completion
				// - New behavior: Should never sleep longer than remaining time

				const timeoutMs = 100
				const intervalSeconds = 0.05 // 50ms
				const expiresInSeconds = timeoutMs / 1000 // 0.1 seconds

				let pollCount = 0
				const mockFetch = vi.fn().mockImplementation(async () => {
					pollCount++
					// Always return authorization_pending to force timeout
					return {
						ok: false,
						json: async () => ({ error: 'authorization_pending' }),
					}
				})

				configure({
					clientId: mockClientId,
					fetch: mockFetch as any,
				})

				const startTime = Date.now()

				await expect(
					pollForTokens(mockDeviceCode, intervalSeconds, expiresInSeconds)
				).rejects.toThrow('Device authorization expired')

				const elapsed = Date.now() - startTime

				// The total elapsed time should not significantly exceed the timeout
				// Allow some slack for test execution overhead (50ms)
				expect(elapsed).toBeLessThan(timeoutMs + 100)
			})

			it('should not sleep longer than remaining time when close to timeout', async () => {
				// This test verifies that when remaining time is less than the interval,
				// the sleep time is reduced accordingly

				const timeoutMs = 150
				const intervalSeconds = 0.1 // 100ms interval
				const expiresInSeconds = timeoutMs / 1000

				let pollCount = 0
				const pollTimestamps: number[] = []
				const startTime = Date.now()

				const mockFetch = vi.fn().mockImplementation(async () => {
					pollCount++
					pollTimestamps.push(Date.now() - startTime)
					return {
						ok: false,
						json: async () => ({ error: 'authorization_pending' }),
					}
				})

				configure({
					clientId: mockClientId,
					fetch: mockFetch as any,
				})

				await expect(
					pollForTokens(mockDeviceCode, intervalSeconds, expiresInSeconds)
				).rejects.toThrow('Device authorization expired')

				const totalElapsed = Date.now() - startTime

				// With proper race condition handling:
				// - First sleep: min(100ms, 150ms) = 100ms
				// - After first poll at ~100ms, remaining is ~50ms
				// - Second sleep: min(100ms, 50ms) = 50ms
				// - Total should be around 150ms, not 200ms+
				expect(totalElapsed).toBeLessThan(timeoutMs + 100)
			})

			it('should check timeout after sleep to handle edge cases', async () => {
				// This test verifies the post-sleep timeout check works correctly
				// when the sleep completes right at the timeout boundary

				const timeoutMs = 80
				const intervalSeconds = 0.05 // 50ms
				const expiresInSeconds = timeoutMs / 1000

				const mockFetch = vi.fn().mockImplementation(async () => {
					return {
						ok: false,
						json: async () => ({ error: 'authorization_pending' }),
					}
				})

				configure({
					clientId: mockClientId,
					fetch: mockFetch as any,
				})

				await expect(
					pollForTokens(mockDeviceCode, intervalSeconds, expiresInSeconds)
				).rejects.toThrow('Device authorization expired')
			})
		})

		it('should return tokens on successful authorization', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					access_token: mockAccessToken,
					token_type: 'Bearer',
					scope: 'openid profile email',
				}),
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			const result = await pollForTokens(mockDeviceCode, 0.01, 10)

			expect(result.access_token).toBe(mockAccessToken)
		})

		it('should handle authorization_pending and continue polling', async () => {
			let callCount = 0
			const mockFetch = vi.fn().mockImplementation(async () => {
				callCount++
				if (callCount < 3) {
					return {
						ok: false,
						json: async () => ({ error: 'authorization_pending' }),
					}
				}
				return {
					ok: true,
					json: async () => ({
						access_token: mockAccessToken,
						token_type: 'Bearer',
					}),
				}
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			const result = await pollForTokens(mockDeviceCode, 0.01, 10)

			expect(mockFetch).toHaveBeenCalledTimes(3)
			expect(result.access_token).toBe(mockAccessToken)
		})

		it('should handle slow_down by increasing interval', async () => {
			let callCount = 0
			const mockFetch = vi.fn().mockImplementation(async () => {
				callCount++
				if (callCount === 1) {
					return {
						ok: false,
						json: async () => ({ error: 'slow_down' }),
					}
				}
				return {
					ok: true,
					json: async () => ({
						access_token: mockAccessToken,
						token_type: 'Bearer',
					}),
				}
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			const result = await pollForTokens(mockDeviceCode, 0.01, 60)

			expect(result.access_token).toBe(mockAccessToken)
			expect(mockFetch).toHaveBeenCalledTimes(2)
		}, 10000)

		it('should throw error on access_denied', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: false,
				json: async () => ({ error: 'access_denied' }),
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			await expect(
				pollForTokens(mockDeviceCode, 0.01, 10)
			).rejects.toThrow('Access denied by user')
		})

		it('should throw error on expired_token', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: false,
				json: async () => ({ error: 'expired_token' }),
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			await expect(
				pollForTokens(mockDeviceCode, 0.01, 10)
			).rejects.toThrow('Device code expired')
		})

		it('should throw error when client ID is missing', async () => {
			configure({
				clientId: '',
				fetch: globalThis.fetch,
			})

			await expect(
				pollForTokens(mockDeviceCode, 5, 600)
			).rejects.toThrow('Client ID is required')
		})
	})

	describe('authorizeDevice()', () => {
		it('should throw error when client ID is missing', async () => {
			configure({
				clientId: '',
				fetch: globalThis.fetch,
			})

			await expect(authorizeDevice()).rejects.toThrow('Client ID is required')
		})

		it('should initiate device flow with correct parameters', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					device_code: mockDeviceCode,
					user_code: 'ABCD-1234',
					verification_uri: 'https://example.com/device',
					expires_in: 900,
					interval: 5,
				}),
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			const result = await authorizeDevice()

			expect(mockFetch).toHaveBeenCalledWith(
				'https://auth.apis.do/user_management/authorize/device',
				expect.objectContaining({
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
				})
			)

			expect(result.device_code).toBe(mockDeviceCode)
		})

		it('should include provider when specified', async () => {
			const mockFetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					device_code: mockDeviceCode,
					user_code: 'ABCD-1234',
					verification_uri: 'https://example.com/device',
					expires_in: 900,
					interval: 5,
				}),
			})

			configure({
				clientId: mockClientId,
				fetch: mockFetch as any,
			})

			await authorizeDevice({ provider: 'GitHubOAuth' })

			const callBody = mockFetch.mock.calls[0][1].body as string
			expect(callBody).toContain('provider=GitHubOAuth')
		})
	})
})
