<?php

declare(strict_types=1);

namespace DotDo\{{Name}}\Tests;

use PHPUnit\Framework\TestCase;
use DotDo\{{Name}}\{{Name}}Client;

class {{Name}}ClientTest extends TestCase
{
    public function testClientCreation(): void
    {
        $client = new {{Name}}Client();
        $this->assertInstanceOf({{Name}}Client::class, $client);
    }

    public function testClientWithApiKey(): void
    {
        $client = new {{Name}}Client(['apiKey' => 'test-key']);
        $this->assertInstanceOf({{Name}}Client::class, $client);
    }

    public function testClientWithCustomBaseUrl(): void
    {
        $client = new {{Name}}Client(['baseUrl' => 'https://custom.{{name}}.do']);
        $this->assertEquals('https://custom.{{name}}.do', $client->getBaseUrl());
    }

    public function testDefaultBaseUrl(): void
    {
        $client = new {{Name}}Client();
        $this->assertEquals('https://{{name}}.do', $client->getBaseUrl());
    }
}
