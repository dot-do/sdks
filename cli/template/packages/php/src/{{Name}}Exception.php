<?php

declare(strict_types=1);

namespace DotDo\{{Name}};

use Exception;

/**
 * Exception thrown by {{Name}} client operations
 */
class {{Name}}Exception extends Exception
{
    private ?string $code_;
    private mixed $details;

    public function __construct(
        string $message,
        ?string $code = null,
        mixed $details = null,
        ?Exception $previous = null
    ) {
        parent::__construct($message, 0, $previous);
        $this->code_ = $code;
        $this->details = $details;
    }

    /**
     * Get the error code
     */
    public function getErrorCode(): ?string
    {
        return $this->code_;
    }

    /**
     * Get additional error details
     */
    public function getDetails(): mixed
    {
        return $this->details;
    }

    /**
     * Create from RPC error response
     */
    public static function fromRpcError(array $error): self
    {
        return new self(
            $error['message'] ?? 'Unknown error',
            $error['code'] ?? null,
            $error['details'] ?? null
        );
    }
}
