# dotdo/oauth

OAuth device flow SDK for .do APIs in PHP.

## Installation

```bash
composer require dotdo/oauth
```

## Usage

### Interactive Login

```php
<?php

use DotDo\OAuth\OAuthClient;

$client = new OAuthClient();

// Start device flow login
$tokens = $client->login();

// Get current user info
$user = $client->getUser();

// Logout
$client->logout();
```

### Manual Device Flow

```php
<?php

use DotDo\OAuth\OAuthClient;

$client = new OAuthClient();

// Step 1: Initiate device authorization
$deviceInfo = $client->authorizeDevice();

// Display to user
echo "Visit: {$deviceInfo['verification_uri']}\n";
echo "Enter code: {$deviceInfo['user_code']}\n";

// Step 2: Poll for tokens
$tokens = $client->pollForTokens(
    $deviceInfo['device_code'],
    $deviceInfo['interval'],
    $deviceInfo['expires_in']
);
```

### Custom Client ID

```php
$client = new OAuthClient('your_client_id');
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `authorizeDevice(string $scope)` - Initiate device authorization
- `pollForTokens(string $deviceCode, int $interval, int $expiresIn)` - Poll for tokens
- `getUser(?string $accessToken)` - Get current user info
- `login(string $scope)` - Interactive login flow
- `logout()` - Remove stored tokens
- `hasTokens()` - Check if tokens exist

## License

MIT
