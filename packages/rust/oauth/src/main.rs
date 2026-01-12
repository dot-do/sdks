//! OAuth.do CLI
//!
//! Authenticate with .do Platform using OAuth device flow.
//!
//! # Usage
//!
//! ```bash
//! oauth-do login     # Login using device authorization flow
//! oauth-do logout    # Logout and remove stored credentials
//! oauth-do whoami    # Show current authenticated user
//! oauth-do token     # Display current authentication token
//! oauth-do status    # Show authentication and storage status
//! ```

use anyhow::Result;
use clap::{Parser, Subcommand};
use colored::*;
use oauth_do::{
    auth::{get_user, logout as auth_logout},
    config::get_config,
    device::{authorize_device, poll_for_tokens, DeviceAuthOptions},
    storage::{create_secure_storage, SecureStorage, TokenStorage},
    types::StoredTokenData,
};

#[derive(Parser)]
#[command(name = "oauth-do")]
#[command(author = "apis.do")]
#[command(version)]
#[command(about = "Simple, secure OAuth authentication for humans and AI agents")]
#[command(long_about = "OAuth.do CLI - Authenticate with .do Platform using OAuth device flow.\n\n\
    Examples:\n  \
    oauth-do login       Login to your account\n  \
    oauth-do whoami      Check who is logged in\n  \
    oauth-do token       Get your authentication token\n  \
    oauth-do logout      Logout and remove credentials\n\n\
    Environment Variables:\n  \
    OAUTH_CLIENT_ID        Client ID for OAuth\n  \
    OAUTH_AUTHKIT_DOMAIN   AuthKit domain (default: login.oauth.do)\n  \
    OAUTH_API_URL          API base URL (default: https://apis.do)\n  \
    DEBUG                  Enable debug output")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Enable debug output
    #[arg(long, global = true)]
    debug: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Login using device authorization flow
    Login,
    /// Logout and remove stored credentials
    Logout,
    /// Show current authenticated user
    Whoami,
    /// Display current authentication token
    Token,
    /// Show authentication and storage status
    Status,
}

/// Print error message
fn print_error(message: &str, error: Option<&anyhow::Error>) {
    eprintln!("{} {}", "Error:".red(), message);
    if let Some(e) = error {
        eprintln!("{}", e);
        if std::env::var("DEBUG").is_ok() {
            eprintln!("\n{}", "Stack trace:".dimmed());
            eprintln!("{}", format!("{:?}", e).dimmed());
        }
    }
}

/// Print success message
fn print_success(message: &str) {
    println!("{} {}", "✓".green(), message);
}

/// Print info message
fn print_info(message: &str) {
    println!("{} {}", "ℹ".cyan(), message);
}

/// Get the storage instance
fn get_storage() -> SecureStorage {
    let config = get_config();
    create_secure_storage(config.storage_path.as_deref())
}

/// Login command - device authorization flow
async fn login_command() -> Result<()> {
    println!("{}\n", "Starting OAuth login...".bold());

    // Step 1: Authorize device
    print_info("Requesting device authorization...");
    let auth_response = authorize_device(DeviceAuthOptions::default()).await?;

    // Step 2: Display instructions to user
    println!("\n{}", "To complete login:".bold());
    println!(
        "\n  1. Visit: {}",
        auth_response.verification_uri.cyan()
    );
    println!(
        "  2. Enter code: {}",
        auth_response.user_code.yellow().bold()
    );
    println!("\n  {}", "Or open this URL directly:".dimmed());
    println!("  {}\n", auth_response.verification_uri_complete.blue());

    // Auto-open browser
    match open::that(&auth_response.verification_uri_complete) {
        Ok(()) => print_success("Opened browser for authentication"),
        Err(_) => print_info("Could not open browser. Please visit the URL above manually."),
    }

    // Step 3: Poll for tokens
    println!("\n{}\n", "Waiting for authorization...".dimmed());
    let token_response = poll_for_tokens(
        &auth_response.device_code,
        auth_response.interval,
        auth_response.expires_in,
    )
    .await?;

    // Step 4: Save token
    let storage = get_storage();

    // Calculate expiration time
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("System time is before Unix epoch - clock misconfigured")
        .as_millis() as u64;

    let token_data = StoredTokenData {
        access_token: token_response.access_token.clone(),
        refresh_token: token_response.refresh_token.clone(),
        expires_at: token_response.expires_in.map(|e| now_ms + e * 1000),
    };

    storage.set_token_data(&token_data)?;

    // Step 5: Get user info
    let auth_result = get_user(Some(&token_response.access_token)).await?;

    print_success("Login successful!");

    if let Some(user) = auth_result.user {
        println!("\n{}", "Logged in as:".dimmed());
        if let Some(name) = &user.name {
            println!("  {}", name.bold());
        }
        if let Some(email) = &user.email {
            println!("  {}", email.dimmed());
        }
    }

    // Show storage info
    match &storage {
        SecureStorage::File(f) => {
            if let Some(path) = f.get_path().to_str() {
                println!("\n{} {}", "Token stored in:".dimmed(), path.green());
            }
        }
        SecureStorage::Keyring(_) => {
            println!("\n{}", "Token stored in: system keychain".dimmed());
        }
        SecureStorage::Memory(_) => {
            println!("\n{}", "Token stored in: memory (temporary)".dimmed());
        }
    }

    Ok(())
}

/// Logout command
async fn logout_command() -> Result<()> {
    let storage = get_storage();

    // Get current token
    let token = storage.get_token()?;

    if token.is_none() {
        print_info("Not logged in");
        return Ok(());
    }

    // Call logout endpoint
    auth_logout(token.as_deref()).await?;

    // Remove stored token
    storage.remove_token()?;

    print_success("Logged out successfully");
    Ok(())
}

/// Whoami command - show current user
async fn whoami_command() -> Result<()> {
    let storage = get_storage();
    let token = storage.get_token()?;

    if token.is_none() {
        println!("{}", "Not logged in".dimmed());
        println!("\nRun {} to authenticate", "oauth-do login".cyan());
        return Ok(());
    }

    let auth_result = get_user(token.as_deref()).await?;

    match auth_result.user {
        Some(user) => {
            println!("{}", "Authenticated as:".bold());
            if let Some(name) = &user.name {
                println!("  {} {}", "Name:".green(), name);
            }
            if let Some(email) = &user.email {
                println!("  {} {}", "Email:".green(), email);
            }
            println!("  {} {}", "ID:".green(), user.id);
        }
        None => {
            println!("{}", "Not authenticated".dimmed());
            println!("\nRun {} to authenticate", "oauth-do login".cyan());
        }
    }

    Ok(())
}

/// Token command - display current token
async fn token_command() -> Result<()> {
    let storage = get_storage();

    match storage.get_token()? {
        Some(token) => {
            // Just print the token (for piping to other commands)
            println!("{}", token);
        }
        None => {
            println!("{}", "No token found".dimmed());
            println!("\nRun {} to authenticate", "oauth-do login".cyan());
        }
    }

    Ok(())
}

/// Status command - show authentication and storage status
async fn status_command() -> Result<()> {
    println!("{}\n", "OAuth.do Status".bold());

    let storage = get_storage();

    // Storage info
    print!("{} ", "Storage:".cyan());
    match &storage {
        SecureStorage::Keyring(_) => {
            println!("{}", "Keyring".green());
            println!("  {}", "Using system credential manager".dimmed());
        }
        SecureStorage::File(f) => {
            println!("{}", "Secure File".green());
            if let Some(path) = f.get_path().to_str() {
                println!("  {} {}", "Path:".dimmed(), path);
            }
            println!("  {}", "Using 0600 permissions".dimmed());
        }
        SecureStorage::Memory(_) => {
            println!("{}", "Memory".yellow());
            println!("  {}", "Tokens are not persisted".dimmed());
        }
    }

    // Auth status
    let token = storage.get_token()?;
    if token.is_none() {
        println!("\n{} {}", "Auth:".cyan(), "Not authenticated".dimmed());
        println!("\nRun {} to authenticate", "oauth-do login".cyan());
        return Ok(());
    }

    let auth_result = get_user(token.as_deref()).await?;
    if let Some(user) = auth_result.user {
        println!("\n{} {}", "Auth:".cyan(), "Authenticated".green());
        if let Some(email) = &user.email {
            println!("  {}", email.dimmed());
        }
    } else {
        println!(
            "\n{} {}",
            "Auth:".cyan(),
            "Token expired or invalid".yellow()
        );
        println!("\nRun {} to re-authenticate", "oauth-do login".cyan());
    }

    Ok(())
}

/// Auto login or show current user
async fn auto_login_or_show_user() -> Result<()> {
    let storage = get_storage();

    // Check if we have a stored token
    let token = storage.get_token()?;

    if let Some(t) = token {
        // Verify the token is still valid
        let auth_result = get_user(Some(&t)).await?;

        if let Some(user) = auth_result.user {
            // Already logged in - show user info
            println!("{} Already authenticated\n", "✓".green());
            if let Some(name) = &user.name {
                println!("  {}", name.bold());
            }
            if let Some(email) = &user.email {
                println!("  {}", email.dimmed());
            }
            println!("  {}", format!("ID: {}", user.id).dimmed());
            return Ok(());
        }

        // Token exists but is invalid/expired - continue to login
        print_info("Session expired, logging in again...\n");
    }

    // Not logged in - start login flow
    login_command().await
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // Set debug mode
    if cli.debug {
        std::env::set_var("DEBUG", "true");
    }

    let result = match cli.command {
        Some(Commands::Login) => login_command().await,
        Some(Commands::Logout) => logout_command().await,
        Some(Commands::Whoami) => whoami_command().await,
        Some(Commands::Token) => token_command().await,
        Some(Commands::Status) => status_command().await,
        None => auto_login_or_show_user().await,
    };

    if let Err(e) = result {
        print_error("Command failed", Some(&e));
        std::process::exit(1);
    }
}
