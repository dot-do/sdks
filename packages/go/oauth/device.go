package oauth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// AuthorizeDevice initiates the device authorization flow.
// Following OAuth 2.0 Device Authorization Grant (RFC 8628).
func AuthorizeDevice(opts ...DeviceAuthOptions) (*DeviceAuthorizationResponse, error) {
	config := GetConfig()

	if config.ClientID == "" {
		return nil, fmt.Errorf("client ID is required for device authorization. Set OAUTH_CLIENT_ID or use Configure()")
	}

	// Build request body
	data := url.Values{}
	data.Set("client_id", config.ClientID)
	data.Set("scope", "openid profile email")

	// Add provider if specified (bypasses AuthKit login screen)
	if len(opts) > 0 && opts[0].Provider != "" {
		data.Set("provider", string(opts[0].Provider))
	}

	// Make request
	endpoint := GetDeviceAuthEndpoint()
	req, err := http.NewRequest("POST", endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("device authorization request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var errResp ErrorResponse
		if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
			return nil, fmt.Errorf("device authorization failed: %s - %s", errResp.Error, errResp.ErrorDescription)
		}
		return nil, fmt.Errorf("device authorization failed: %s - %s", resp.Status, string(body))
	}

	var authResp DeviceAuthorizationResponse
	if err := json.Unmarshal(body, &authResp); err != nil {
		return nil, fmt.Errorf("failed to parse device authorization response: %w", err)
	}

	return &authResp, nil
}

// PollForTokens polls for tokens after device authorization.
// This implements the polling loop as specified in RFC 8628 Section 3.4.
//
// Parameters:
//   - deviceCode: Device code from authorization response
//   - interval: Polling interval in seconds (default: 5)
//   - expiresIn: Expiration time in seconds (default: 600)
func PollForTokens(deviceCode string, interval int, expiresIn int) (*TokenResponse, error) {
	config := GetConfig()

	if config.ClientID == "" {
		return nil, fmt.Errorf("client ID is required for token polling")
	}

	if interval <= 0 {
		interval = 5
	}
	if expiresIn <= 0 {
		expiresIn = 600
	}

	startTime := time.Now()
	timeout := time.Duration(expiresIn) * time.Second
	currentInterval := time.Duration(interval) * time.Second

	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := GetTokenEndpoint()

	for {
		// Check if expired
		if time.Since(startTime) > timeout {
			return nil, fmt.Errorf("device authorization expired. Please try again")
		}

		// Wait for interval
		time.Sleep(currentInterval)

		// Build request
		data := url.Values{}
		data.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
		data.Set("device_code", deviceCode)
		data.Set("client_id", config.ClientID)

		req, err := http.NewRequest("POST", endpoint, strings.NewReader(data.Encode()))
		if err != nil {
			continue // Retry on request creation error
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		resp, err := client.Do(req)
		if err != nil {
			continue // Retry on network error
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue // Retry on read error
		}

		// Success case
		if resp.StatusCode == http.StatusOK {
			var tokenResp TokenResponse
			if err := json.Unmarshal(body, &tokenResp); err != nil {
				return nil, fmt.Errorf("failed to parse token response: %w", err)
			}
			return &tokenResp, nil
		}

		// Parse error response
		var errResp ErrorResponse
		if json.Unmarshal(body, &errResp) != nil {
			errResp.Error = "unknown"
		}

		switch TokenError(errResp.Error) {
		case TokenErrorAuthorizationPending:
			// User hasn't completed authorization yet - continue polling
			continue

		case TokenErrorSlowDown:
			// Increase interval by 5 seconds as per RFC 8628
			currentInterval += 5 * time.Second
			continue

		case TokenErrorAccessDenied:
			return nil, fmt.Errorf("access denied by user")

		case TokenErrorExpiredToken:
			return nil, fmt.Errorf("device code expired")

		default:
			return nil, fmt.Errorf("token polling failed: %s", errResp.Error)
		}
	}
}

// PollForTokensWithCallback polls for tokens with progress callbacks.
// This is useful for CLI applications that want to show polling status.
func PollForTokensWithCallback(
	deviceCode string,
	interval int,
	expiresIn int,
	onPoll func(attempt int),
) (*TokenResponse, error) {
	config := GetConfig()

	if config.ClientID == "" {
		return nil, fmt.Errorf("client ID is required for token polling")
	}

	if interval <= 0 {
		interval = 5
	}
	if expiresIn <= 0 {
		expiresIn = 600
	}

	startTime := time.Now()
	timeout := time.Duration(expiresIn) * time.Second
	currentInterval := time.Duration(interval) * time.Second

	client := &http.Client{Timeout: 30 * time.Second}
	endpoint := GetTokenEndpoint()
	attempt := 0

	for {
		// Check if expired
		if time.Since(startTime) > timeout {
			return nil, fmt.Errorf("device authorization expired. Please try again")
		}

		// Wait for interval
		time.Sleep(currentInterval)
		attempt++

		// Call progress callback
		if onPoll != nil {
			onPoll(attempt)
		}

		// Build request
		data := url.Values{}
		data.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
		data.Set("device_code", deviceCode)
		data.Set("client_id", config.ClientID)

		req, err := http.NewRequest("POST", endpoint, strings.NewReader(data.Encode()))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}

		if resp.StatusCode == http.StatusOK {
			var tokenResp TokenResponse
			if err := json.Unmarshal(body, &tokenResp); err != nil {
				return nil, fmt.Errorf("failed to parse token response: %w", err)
			}
			return &tokenResp, nil
		}

		var errResp ErrorResponse
		if json.Unmarshal(body, &errResp) != nil {
			errResp.Error = "unknown"
		}

		switch TokenError(errResp.Error) {
		case TokenErrorAuthorizationPending:
			continue
		case TokenErrorSlowDown:
			currentInterval += 5 * time.Second
			continue
		case TokenErrorAccessDenied:
			return nil, fmt.Errorf("access denied by user")
		case TokenErrorExpiredToken:
			return nil, fmt.Errorf("device code expired")
		default:
			return nil, fmt.Errorf("token polling failed: %s", errResp.Error)
		}
	}
}
