<?php

declare(strict_types=1);

namespace DotDo\{{Name}};

use DotDo\Rpc\RpcClient;
use DotDo\Rpc\RpcConnection;

/**
 * {{Name}}.do SDK Client
 *
 * {{description}}
 *
 * @example
 * ```php
 * $client = new {{Name}}Client(['apiKey' => getenv('DOTDO_KEY')]);
 * $result = $client->example();
 * ```
 */
class {{Name}}Client
{
    private ?RpcClient $rpc = null;
    private array $options;

    /**
     * Create a new {{Name}} client
     *
     * @param array{apiKey?: string, baseUrl?: string} $options
     */
    public function __construct(array $options = [])
    {
        $this->options = array_merge([
            'baseUrl' => 'https://{{name}}.do',
        ], $options);
    }

    /**
     * Connect to the {{name}}.do service
     */
    public function connect(): RpcClient
    {
        if ($this->rpc === null) {
            $headers = [];
            if (isset($this->options['apiKey'])) {
                $headers['Authorization'] = 'Bearer ' . $this->options['apiKey'];
            }

            $this->rpc = RpcConnection::connect($this->options['baseUrl'], [
                'headers' => $headers,
            ]);
        }

        return $this->rpc;
    }

    /**
     * Disconnect from the service
     */
    public function disconnect(): void
    {
        if ($this->rpc !== null) {
            $this->rpc = null;
        }
    }

    /**
     * Get the base URL
     */
    public function getBaseUrl(): string
    {
        return $this->options['baseUrl'];
    }
}
