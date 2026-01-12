<?php

declare(strict_types=1);

namespace DotDo\OAuth;

use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;

/**
 * Device flow authentication.
 */
class DeviceFlow
{
    public const DEFAULT_CLIENT_ID = 'client_01JQYTRXK9ZPD8JPJTKDCRB656';

    private const AUTH_URL = 'https://auth.apis.do/user_management/authorize_device';
    private const TOKEN_URL = 'https://auth.apis.do/user_management/authenticate';
    private const USER_URL = 'https://apis.do/me';

    private Client $client;
    private string $clientId;

    public function __construct(string $clientId = self::DEFAULT_CLIENT_ID)
    {
        $this->clientId = $clientId;
        $this->client = new Client([
            'timeout' => 30,
            'http_errors' => false,
        ]);
    }

    /**
     * Initiates device authorization.
     *
     * @param string $scope OAuth scope
     * @return array Device authorization response
     * @throws \Exception on failure
     */
    public function authorize(string $scope = 'openid profile email'): array
    {
        $response = $this->client->post(self::AUTH_URL, [
            'json' => [
                'client_id' => $this->clientId,
                'scope' => $scope,
            ],
        ]);

        $statusCode = $response->getStatusCode();
        $body = json_decode((string) $response->getBody(), true);

        if ($statusCode !== 200) {
            throw new \Exception("Authorization failed: " . ($body['error'] ?? 'Unknown error'));
        }

        return $body;
    }

    /**
     * Polls for tokens until user authorizes or timeout.
     *
     * @param string $deviceCode Device code
     * @param int $interval Polling interval in seconds
     * @param int $expiresIn Expiration time in seconds
     * @return array Token response
     * @throws \Exception on failure
     */
    public function pollForTokens(string $deviceCode, int $interval, int $expiresIn): array
    {
        $deadline = time() + $expiresIn;

        while (time() < $deadline) {
            $response = $this->client->post(self::TOKEN_URL, [
                'json' => [
                    'client_id' => $this->clientId,
                    'device_code' => $deviceCode,
                    'grant_type' => 'urn:ietf:params:oauth:grant-type:device_code',
                ],
            ]);

            $statusCode = $response->getStatusCode();
            $body = json_decode((string) $response->getBody(), true);

            if ($statusCode === 200) {
                return $body;
            }

            if ($statusCode === 400) {
                $error = $body['error'] ?? '';

                if ($error === 'authorization_pending') {
                    sleep($interval);
                    continue;
                }

                if ($error === 'slow_down') {
                    $interval += 5;
                    sleep($interval);
                    continue;
                }

                throw new \Exception("Token request failed: $error");
            }

            throw new \Exception("Unexpected response: $statusCode");
        }

        throw new \Exception('Authorization expired');
    }

    /**
     * Gets user info with access token.
     *
     * @param string $accessToken Access token
     * @return array User info
     * @throws \Exception on failure
     */
    public function getUserInfo(string $accessToken): array
    {
        $response = $this->client->get(self::USER_URL, [
            'headers' => [
                'Authorization' => "Bearer $accessToken",
            ],
        ]);

        $statusCode = $response->getStatusCode();
        $body = json_decode((string) $response->getBody(), true);

        if ($statusCode !== 200) {
            throw new \Exception("Failed to get user info: " . ($body['error'] ?? 'Unknown error'));
        }

        return $body;
    }
}
