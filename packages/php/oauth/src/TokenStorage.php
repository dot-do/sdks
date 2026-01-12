<?php

declare(strict_types=1);

namespace DotDo\OAuth;

/**
 * File-based token storage.
 */
class TokenStorage
{
    private string $tokenDir;
    private string $tokenFile;

    public function __construct(?string $tokenDir = null)
    {
        $this->tokenDir = $tokenDir ?? $this->getDefaultTokenDir();
        $this->tokenFile = $this->tokenDir . '/token';
    }

    private function getDefaultTokenDir(): string
    {
        $home = getenv('HOME') ?: getenv('USERPROFILE');
        return $home . '/.oauth.do';
    }

    /**
     * Saves tokens to file storage.
     *
     * @param array $tokens Token data
     */
    public function saveTokens(array $tokens): void
    {
        if (!is_dir($this->tokenDir)) {
            mkdir($this->tokenDir, 0700, true);
        }

        file_put_contents(
            $this->tokenFile,
            json_encode($tokens, JSON_PRETTY_PRINT),
            LOCK_EX
        );
        chmod($this->tokenFile, 0600);
    }

    /**
     * Loads tokens from file storage.
     *
     * @return array|null Token data or null if not found
     */
    public function loadTokens(): ?array
    {
        if (!file_exists($this->tokenFile)) {
            return null;
        }

        $content = file_get_contents($this->tokenFile);
        if ($content === false) {
            return null;
        }

        return json_decode($content, true);
    }

    /**
     * Gets the access token from storage.
     *
     * @return string|null Access token or null if not found
     */
    public function getAccessToken(): ?string
    {
        $tokens = $this->loadTokens();
        return $tokens['access_token'] ?? null;
    }

    /**
     * Gets the refresh token from storage.
     *
     * @return string|null Refresh token or null if not found
     */
    public function getRefreshToken(): ?string
    {
        $tokens = $this->loadTokens();
        return $tokens['refresh_token'] ?? null;
    }

    /**
     * Deletes stored tokens.
     */
    public function deleteTokens(): void
    {
        if (file_exists($this->tokenFile)) {
            unlink($this->tokenFile);
        }
    }

    /**
     * Checks if tokens exist.
     */
    public function hasTokens(): bool
    {
        return file_exists($this->tokenFile);
    }
}
