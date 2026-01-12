// Package {{name}} provides a Go client for the {{name}}.do service.
//
// Example usage:
//
//	client, err := {{name}}.NewClient(os.Getenv("DOTDO_KEY"))
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
//
//	// Use the client...
package {{name}}

import (
	"context"
	"fmt"
	"sync"

	rpc "go.rpc.do"
)

// ClientOptions configures the {{Name}} client.
type ClientOptions struct {
	// APIKey for authentication
	APIKey string
	// BaseURL for the service (defaults to https://{{name}}.do)
	BaseURL string
}

// DefaultOptions returns the default client options.
func DefaultOptions() ClientOptions {
	return ClientOptions{
		BaseURL: "https://{{name}}.do",
	}
}

// Client is a {{name}}.do client.
type Client struct {
	options ClientOptions
	rpc     *rpc.Client
	mu      sync.RWMutex
}

// NewClient creates a new {{Name}} client with the given API key.
func NewClient(apiKey string) (*Client, error) {
	opts := DefaultOptions()
	opts.APIKey = apiKey
	return NewClientWithOptions(opts)
}

// NewClientWithOptions creates a new {{Name}} client with custom options.
func NewClientWithOptions(opts ClientOptions) (*Client, error) {
	if opts.BaseURL == "" {
		opts.BaseURL = "https://{{name}}.do"
	}
	return &Client{
		options: opts,
	}, nil
}

// Connect establishes a connection to the {{name}}.do service.
func (c *Client) Connect(ctx context.Context) (*rpc.Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.rpc != nil {
		return c.rpc, nil
	}

	rpcClient, err := rpc.Connect(ctx, c.options.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	c.rpc = rpcClient
	return c.rpc, nil
}

// Close closes the connection to the service.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.rpc != nil {
		err := c.rpc.Close()
		c.rpc = nil
		return err
	}
	return nil
}
