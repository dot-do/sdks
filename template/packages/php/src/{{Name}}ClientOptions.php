<?php

declare(strict_types=1);

namespace DotDo\{{Name}};

/**
 * Configuration options for {{Name}}Client
 */
readonly class {{Name}}ClientOptions
{
    public function __construct(
        /** API key for authentication */
        public ?string $apiKey = null,
        /** Base URL for the service (defaults to https://{{name}}.do) */
        public string $baseUrl = 'https://{{name}}.do',
        /** Connection timeout in seconds */
        public int $timeout = 30
    ) {}
}
