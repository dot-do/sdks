<?php

declare(strict_types=1);

namespace DotDo\OAuth;

/**
 * OAuth device flow client for .do APIs.
 */
class OAuthClient
{
    private DeviceFlow $deviceFlow;
    private TokenStorage $storage;

    public function __construct(
        string $clientId = DeviceFlow::DEFAULT_CLIENT_ID
    ) {
        $this->deviceFlow = new DeviceFlow($clientId);
        $this->storage = new TokenStorage();
    }

    /**
     * Initiates device authorization flow.
     *
     * @param string $scope OAuth scope
     * @return array Device authorization response
     * @throws \Exception on failure
     */
    public function authorizeDevice(string $scope = 'openid profile email'): array
    {
        return $this->deviceFlow->authorize($scope);
    }

    /**
     * Polls for tokens after user authorizes the device.
     *
     * @param string $deviceCode Device code from authorization
     * @param int $interval Polling interval in seconds
     * @param int $expiresIn Expiration time in seconds
     * @return array Token response
     * @throws \Exception on failure
     */
    public function pollForTokens(string $deviceCode, int $interval, int $expiresIn): array
    {
        $tokens = $this->deviceFlow->pollForTokens($deviceCode, $interval, $expiresIn);
        $this->storage->saveTokens($tokens);
        return $tokens;
    }

    /**
     * Gets current user info using stored or provided access token.
     *
     * @param string|null $accessToken Optional access token
     * @return array User info
     * @throws \Exception on failure
     */
    public function getUser(?string $accessToken = null): array
    {
        $token = $accessToken ?? $this->storage->getAccessToken();

        if ($token === null) {
            throw new \Exception('No access token available');
        }

        return $this->deviceFlow->getUserInfo($token);
    }

    /**
     * Interactive login flow.
     *
     * @param string $scope OAuth scope
     * @return array Token response
     * @throws \Exception on failure
     */
    public function login(string $scope = 'openid profile email'): array
    {
        $deviceInfo = $this->authorizeDevice($scope);

        echo "\nTo sign in, visit: {$deviceInfo['verification_uri']}\n";
        echo "And enter code: {$deviceInfo['user_code']}\n\n";

        return $this->pollForTokens(
            $deviceInfo['device_code'],
            $deviceInfo['interval'] ?? 5,
            $deviceInfo['expires_in'] ?? 900
        );
    }

    /**
     * Logs out by removing stored tokens.
     */
    public function logout(): void
    {
        $this->storage->deleteTokens();
    }

    /**
     * Checks if tokens exist.
     */
    public function hasTokens(): bool
    {
        return $this->storage->hasTokens();
    }
}
