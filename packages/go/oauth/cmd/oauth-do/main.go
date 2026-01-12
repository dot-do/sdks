// oauth-do is a CLI for authenticating with the .do platform using OAuth 2.0 device flow.
//
// Usage:
//
//	oauth-do login      - Login using device authorization flow
//	oauth-do logout     - Logout and remove stored credentials
//	oauth-do whoami     - Show current authenticated user
//	oauth-do token      - Display current authentication token
//	oauth-do status     - Show authentication and storage status
//
// Installation:
//
//	go install go.oauth.do/cmd/oauth-do@latest
package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"

	oauth "go.oauth.do"

	"github.com/spf13/cobra"
)

// Version is set at build time
var Version = "dev"

// ANSI color codes
const (
	colorReset  = "\033[0m"
	colorBright = "\033[1m"
	colorDim    = "\033[2m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorRed    = "\033[31m"
	colorCyan   = "\033[36m"
	colorGray   = "\033[90m"
	colorBlue   = "\033[34m"
)

var debug bool

var rootCmd = &cobra.Command{
	Use:   "oauth-do",
	Short: "OAuth.do CLI - authenticate with the .do platform",
	Long: `OAuth.do CLI

Authenticate with the .do platform using OAuth 2.0 device authorization flow.
Securely store tokens in the system keyring or file storage.

Examples:
  oauth-do login      Login to your account
  oauth-do whoami     Show current authenticated user
  oauth-do token      Get your authentication token
  oauth-do status     Show authentication status
  oauth-do logout     Log out and remove credentials`,
	Version: Version,
	Run: func(cmd *cobra.Command, args []string) {
		// Default: check if logged in, show user if yes, prompt to login if no
		if err := autoLoginOrShowUser(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login using device authorization flow",
	Long: `Login to the .do platform using OAuth 2.0 device authorization flow.

This will:
1. Request a device code from the authorization server
2. Display a URL and code for you to authorize in your browser
3. Poll for tokens once you complete authorization
4. Securely store your tokens for future use`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := loginCommand(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and remove stored credentials",
	Long: `Logout from the .do platform.

This will:
1. Call the logout endpoint to invalidate the session
2. Remove stored tokens from the keyring or file storage`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := logoutCommand(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current authenticated user",
	Long:  `Display information about the currently authenticated user.`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := whoamiCommand(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

var tokenCmd = &cobra.Command{
	Use:   "token",
	Short: "Display current authentication token",
	Long: `Display the current authentication token.

The token is printed without any formatting, making it suitable for use
in scripts or piping to other commands:

  curl -H "Authorization: Bearer $(oauth-do token)" https://apis.do/me`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := tokenCommand(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show authentication and storage status",
	Long: `Display the current authentication and storage status.

Shows:
- Storage backend (keyring or file)
- Authentication status
- User information if authenticated`,
	Run: func(cmd *cobra.Command, args []string) {
		if err := statusCommand(); err != nil {
			printError(err.Error(), nil)
			os.Exit(1)
		}
	},
}

func init() {
	// Configure from environment
	oauth.Configure(oauth.OAuthConfig{
		APIUrl:        getEnvOrDefault("OAUTH_API_URL", getEnvOrDefault("API_URL", "https://apis.do")),
		ClientID:      getEnvOrDefault("OAUTH_CLIENT_ID", "client_01JQYTRXK9ZPD8JPJTKDCRB656"),
		AuthKitDomain: getEnvOrDefault("OAUTH_AUTHKIT_DOMAIN", "login.oauth.do"),
	})

	// Add persistent flags
	rootCmd.PersistentFlags().BoolVar(&debug, "debug", false, "Enable debug output")

	// Add commands
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
	rootCmd.AddCommand(tokenCmd)
	rootCmd.AddCommand(statusCmd)
}

func main() {
	// Set debug environment variable if flag is set
	cobra.OnInitialize(func() {
		if debug {
			os.Setenv("DEBUG", "true")
		}
	})

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func printError(message string, err error) {
	fmt.Fprintf(os.Stderr, "%sError:%s %s\n", colorRed, colorReset, message)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err.Error())
	}
	if oauth.IsDebug() && err != nil {
		fmt.Fprintf(os.Stderr, "\n%sStack trace:%s\n", colorDim, colorReset)
		fmt.Fprintf(os.Stderr, "%s%v%s\n", colorDim, err, colorReset)
	}
}

func printSuccess(message string) {
	fmt.Printf("%s[ok]%s %s\n", colorGreen, colorReset, message)
}

func printInfo(message string) {
	fmt.Printf("%s[i]%s %s\n", colorCyan, colorReset, message)
}

func loginCommand() error {
	fmt.Printf("%sStarting OAuth login...%s\n\n", colorBright, colorReset)

	// Step 1: Authorize device
	printInfo("Requesting device authorization...")
	authResp, err := oauth.AuthorizeDevice()
	if err != nil {
		return fmt.Errorf("failed to initiate device authorization: %w", err)
	}

	// Step 2: Display instructions to user
	fmt.Printf("\n%sTo complete login:%s\n", colorBright, colorReset)
	fmt.Printf("\n  1. Visit: %s%s%s\n", colorCyan, authResp.VerificationURI, colorReset)
	fmt.Printf("  2. Enter code: %s%s%s%s\n", colorBright, colorYellow, authResp.UserCode, colorReset)
	fmt.Printf("\n  %sOr open this URL directly:%s\n", colorDim, colorReset)
	fmt.Printf("  %s%s%s\n\n", colorBlue, authResp.VerificationURIComplete, colorReset)

	// Auto-open browser
	if err := openBrowser(authResp.VerificationURIComplete); err == nil {
		printSuccess("Opened browser for authentication")
	} else {
		printInfo("Could not open browser. Please visit the URL above manually.")
	}

	// Step 3: Poll for tokens
	fmt.Printf("\n%sWaiting for authorization...%s\n\n", colorDim, colorReset)
	tokenResp, err := oauth.PollForTokens(
		authResp.DeviceCode,
		authResp.Interval,
		authResp.ExpiresIn,
	)
	if err != nil {
		return fmt.Errorf("login failed: %w", err)
	}

	// Step 4: Save token
	tokenData := &oauth.StoredTokenData{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
	}
	if tokenResp.ExpiresIn > 0 {
		tokenData.ExpiresAt = int64(tokenResp.ExpiresIn) * 1000 // Convert to ms
	}
	if err := oauth.SetTokenData(tokenData); err != nil {
		return fmt.Errorf("failed to save token: %w", err)
	}

	// Step 5: Get user info
	authResult, err := oauth.Auth(tokenResp.AccessToken)
	if err != nil {
		printSuccess("Login successful!")
		return nil
	}

	printSuccess("Login successful!")
	if authResult.User != nil {
		fmt.Printf("\n%sLogged in as:%s\n", colorDim, colorReset)
		if authResult.User.Name != "" {
			fmt.Printf("  %s%s%s\n", colorBright, authResult.User.Name, colorReset)
		}
		if authResult.User.Email != "" {
			fmt.Printf("  %s%s%s\n", colorGray, authResult.User.Email, colorReset)
		}
	}

	// Show storage info
	storageType, _, path, _ := oauth.GetStorageInfo()
	if storageType == "file" && path != "" {
		fmt.Printf("\n%sToken stored in: %s~/.oauth.do/token%s%s\n", colorDim, colorGreen, colorReset, colorReset)
	} else if storageType == "keyring" {
		fmt.Printf("\n%sToken stored in: %ssystem keyring%s%s\n", colorDim, colorGreen, colorReset, colorReset)
	}

	return nil
}

func logoutCommand() error {
	// Get current token
	token, _ := oauth.GetToken()
	if token == "" {
		printInfo("Not logged in")
		return nil
	}

	// Logout
	if err := oauth.Logout(token); err != nil {
		return fmt.Errorf("logout failed: %w", err)
	}

	printSuccess("Logged out successfully")
	return nil
}

func whoamiCommand() error {
	token, _ := oauth.GetToken()
	if token == "" {
		fmt.Printf("%sNot logged in%s\n", colorDim, colorReset)
		fmt.Printf("\nRun %soauth-do login%s to authenticate\n", colorCyan, colorReset)
		return nil
	}

	authResult, err := oauth.Auth(token)
	if err != nil {
		return fmt.Errorf("failed to get user info: %w", err)
	}

	if authResult.User == nil {
		fmt.Printf("%sNot authenticated%s\n", colorDim, colorReset)
		fmt.Printf("\nRun %soauth-do login%s to authenticate\n", colorCyan, colorReset)
		return nil
	}

	fmt.Printf("%sAuthenticated as:%s\n", colorBright, colorReset)
	if authResult.User.Name != "" {
		fmt.Printf("  %sName:%s %s\n", colorGreen, colorReset, authResult.User.Name)
	}
	if authResult.User.Email != "" {
		fmt.Printf("  %sEmail:%s %s\n", colorGreen, colorReset, authResult.User.Email)
	}
	if authResult.User.ID != "" {
		fmt.Printf("  %sID:%s %s\n", colorGreen, colorReset, authResult.User.ID)
	}

	return nil
}

func tokenCommand() error {
	token, err := oauth.GetToken()
	if err != nil {
		return fmt.Errorf("failed to get token: %w", err)
	}

	if token == "" {
		fmt.Printf("%sNo token found%s\n", colorDim, colorReset)
		fmt.Printf("\nRun %soauth-do login%s to authenticate\n", colorCyan, colorReset)
		return nil
	}

	// Print token without any formatting (for piping to other commands)
	fmt.Println(token)
	return nil
}

func statusCommand() error {
	fmt.Printf("%sOAuth.do Status%s\n\n", colorBright, colorReset)

	// Get storage info
	storageType, _, path, authenticated := oauth.GetStorageInfo()

	if storageType == "file" {
		fmt.Printf("%sStorage:%s %sSecure File%s\n", colorCyan, colorReset, colorGreen, colorReset)
		if path != "" {
			fmt.Printf("  %sUsing %s with 0600 permissions%s\n", colorDim, path, colorReset)
		}
	} else if storageType == "keyring" {
		fmt.Printf("%sStorage:%s %sSystem Keyring%s\n", colorCyan, colorReset, colorGreen, colorReset)
	} else {
		fmt.Printf("%sStorage:%s %s\n", colorCyan, colorReset, storageType)
	}

	// Get auth status
	if !authenticated {
		fmt.Printf("\n%sAuth:%s %sNot authenticated%s\n", colorCyan, colorReset, colorDim, colorReset)
		fmt.Printf("\nRun %soauth-do login%s to authenticate\n", colorCyan, colorReset)
		return nil
	}

	token, _ := oauth.GetToken()
	authResult, err := oauth.Auth(token)
	if err != nil || authResult.User == nil {
		fmt.Printf("\n%sAuth:%s %sToken expired or invalid%s\n", colorCyan, colorReset, colorYellow, colorReset)
		fmt.Printf("\nRun %soauth-do login%s to re-authenticate\n", colorCyan, colorReset)
		return nil
	}

	fmt.Printf("\n%sAuth:%s %sAuthenticated%s\n", colorCyan, colorReset, colorGreen, colorReset)
	if authResult.User.Email != "" {
		fmt.Printf("  %s%s%s\n", colorDim, authResult.User.Email, colorReset)
	}

	return nil
}

func autoLoginOrShowUser() error {
	// Check if we have a stored token
	token, _ := oauth.GetToken()
	if token != "" {
		// Verify the token is still valid
		authResult, err := oauth.Auth(token)
		if err == nil && authResult.User != nil {
			// Already logged in - show user info
			fmt.Printf("%s[ok]%s Already authenticated\n\n", colorGreen, colorReset)
			if authResult.User.Name != "" {
				fmt.Printf("  %s%s%s\n", colorBright, authResult.User.Name, colorReset)
			}
			if authResult.User.Email != "" {
				fmt.Printf("  %s%s%s\n", colorGray, authResult.User.Email, colorReset)
			}
			if authResult.User.ID != "" {
				fmt.Printf("  %sID: %s%s\n", colorDim, authResult.User.ID, colorReset)
			}
			return nil
		}
		// Token exists but is invalid/expired
		printInfo("Session expired, logging in again...\n")
	}

	// Not logged in - start login flow
	return loginCommand()
}

func openBrowser(url string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform")
	}

	return cmd.Start()
}
