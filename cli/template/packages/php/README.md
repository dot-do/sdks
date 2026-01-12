# {{name}}-do

[![Packagist Version](https://img.shields.io/packagist/v/dotdo/{{name}}-do.svg)](https://packagist.org/packages/dotdo/{{name}}-do)

{{Name}}.do SDK for PHP - {{description}}

## Requirements

- PHP 8.2 or higher

## Installation

```bash
composer require dotdo/{{name}}-do
```

## Quick Start

```php
<?php

use DotDo\{{Name}}\{{Name}}Client;

// Create client with API key
$client = new {{Name}}Client([
    'apiKey' => getenv('DOTDO_KEY'),
]);

// Connect to the service
$client->connect();

try {
    // Make RPC calls through the client
    $rpc = $client->getRpc();
    // ...
} finally {
    $client->disconnect();
}
```

## Configuration

```php
$client = new {{Name}}Client([
    'apiKey' => 'your-api-key',
    'baseUrl' => 'https://{{name}}.do',  // Custom endpoint
    'timeout' => 30,                       // Connection timeout in seconds
]);
```

## Error Handling

```php
use DotDo\{{Name}}\{{Name}}AuthException;
use DotDo\{{Name}}\{{Name}}ConnectionException;
use DotDo\{{Name}}\{{Name}}Exception;

try {
    $client->connect();
    // ...
} catch ({{Name}}AuthException $e) {
    echo "Authentication failed: $e\n";
} catch ({{Name}}ConnectionException $e) {
    echo "Connection failed: $e\n";
} catch ({{Name}}Exception $e) {
    echo "Error: $e\n";
}
```

## License

MIT
