#!/usr/bin/env python3
"""
OAuth.do CLI

Authenticate with .do Platform using OAuth device flow.

Usage:
    oauth-do login     - Login using device authorization flow
    oauth-do logout    - Logout and remove stored credentials
    oauth-do whoami    - Show current authenticated user
    oauth-do token     - Display current authentication token
    oauth-do status    - Show authentication and storage status
"""

from __future__ import annotations

import asyncio
import sys
import webbrowser
from typing import Any

import click

from .auth import get_user, logout as logout_fn, get_token
from .config import configure_from_env, get_config
from .device import authorize_device, poll_for_tokens
from .storage import create_secure_storage, FileStorage


# Color codes for terminal output
class Colors:
    RESET = "\x1b[0m"
    BRIGHT = "\x1b[1m"
    DIM = "\x1b[2m"
    GREEN = "\x1b[32m"
    YELLOW = "\x1b[33m"
    RED = "\x1b[31m"
    CYAN = "\x1b[36m"
    GRAY = "\x1b[90m"
    BLUE = "\x1b[34m"


def print_error(message: str, error: Exception | None = None) -> None:
    """Print error message."""
    click.echo(f"{Colors.RED}Error:{Colors.RESET} {message}", err=True)
    if error and str(error):
        click.echo(str(error), err=True)


def print_success(message: str) -> None:
    """Print success message."""
    click.echo(f"{Colors.GREEN}[ok]{Colors.RESET} {message}")


def print_info(message: str) -> None:
    """Print info message."""
    click.echo(f"{Colors.CYAN}[i]{Colors.RESET} {message}")


def run_async(coro: Any) -> Any:
    """Run an async function synchronously."""
    return asyncio.run(coro)


@click.group(invoke_without_command=True)
@click.option("--debug", is_flag=True, help="Show debug information")
@click.pass_context
def cli(ctx: click.Context, debug: bool) -> None:
    """
    OAuth.do CLI - Authenticate with .do Platform

    Use 'oauth-do login' to authenticate or run without arguments to
    check if logged in and login if not.
    """
    if debug:
        import os
        os.environ["DEBUG"] = "true"

    configure_from_env()

    # If no subcommand, run auto login or show user
    if ctx.invoked_subcommand is None:
        run_async(auto_login_or_show_user())


@cli.command()
def login() -> None:
    """Login using device authorization flow."""
    run_async(login_command())


@cli.command()
def logout() -> None:
    """Logout and remove stored credentials."""
    run_async(logout_command())


@cli.command()
def whoami() -> None:
    """Show current authenticated user."""
    run_async(whoami_command())


@cli.command()
def token() -> None:
    """Display current authentication token."""
    run_async(token_command())


@cli.command()
def status() -> None:
    """Show authentication and storage status."""
    run_async(status_command())


async def login_command() -> None:
    """Login command - device authorization flow."""
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        click.echo(f"{Colors.BRIGHT}Starting OAuth login...{Colors.RESET}\n")

        # Step 1: Authorize device
        print_info("Requesting device authorization...")
        auth_response = await authorize_device()

        # Step 2: Display instructions to user
        click.echo(f"\n{Colors.BRIGHT}To complete login:{Colors.RESET}")
        click.echo(f"\n  1. Visit: {Colors.CYAN}{auth_response.verification_uri}{Colors.RESET}")
        click.echo(f"  2. Enter code: {Colors.BRIGHT}{Colors.YELLOW}{auth_response.user_code}{Colors.RESET}")

        if auth_response.verification_uri_complete:
            click.echo(f"\n  {Colors.DIM}Or open this URL directly:{Colors.RESET}")
            click.echo(f"  {Colors.BLUE}{auth_response.verification_uri_complete}{Colors.RESET}\n")

        # Auto-open browser
        try:
            url = auth_response.verification_uri_complete or auth_response.verification_uri
            webbrowser.open(url)
            print_success("Opened browser for authentication")
        except Exception:
            print_info("Could not open browser. Please visit the URL above manually.")

        # Step 3: Poll for tokens
        click.echo(f"\n{Colors.DIM}Waiting for authorization...{Colors.RESET}\n")
        token_response = await poll_for_tokens(
            auth_response.device_code,
            auth_response.interval,
            auth_response.expires_in,
        )

        # Step 4: Save token
        from .types import StoredTokenData
        import time

        expires_at = None
        if token_response.expires_in:
            expires_at = int(time.time() * 1000) + token_response.expires_in * 1000

        token_data = StoredTokenData(
            access_token=token_response.access_token,
            refresh_token=token_response.refresh_token,
            expires_at=expires_at,
        )
        await storage.set_token_data(token_data)

        # Step 5: Get user info
        auth_result = await get_user(token_response.access_token)

        print_success("Login successful!")
        if auth_result.user:
            click.echo(f"\n{Colors.DIM}Logged in as:{Colors.RESET}")
            if auth_result.user.name:
                click.echo(f"  {Colors.BRIGHT}{auth_result.user.name}{Colors.RESET}")
            if auth_result.user.email:
                click.echo(f"  {Colors.GRAY}{auth_result.user.email}{Colors.RESET}")

        # Show storage info
        if isinstance(storage, FileStorage):
            storage_info = await storage.get_storage_info()
            if storage_info.get("path"):
                click.echo(f"\n{Colors.DIM}Token stored in: {Colors.GREEN}~/.oauth.do/token{Colors.RESET}{Colors.RESET}")

    except Exception as e:
        print_error("Login failed", e)
        sys.exit(1)


async def logout_command() -> None:
    """Logout command."""
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        # Get current token
        token = await storage.get_token()

        if not token:
            print_info("Not logged in")
            return

        # Call logout endpoint
        await logout_fn(token)

        # Remove stored token
        await storage.remove_token()

        print_success("Logged out successfully")

    except Exception as e:
        print_error("Logout failed", e)
        sys.exit(1)


async def whoami_command() -> None:
    """Whoami command - show current user."""
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        token = await storage.get_token()

        if not token:
            click.echo(f"{Colors.DIM}Not logged in{Colors.RESET}")
            click.echo(f"\nRun {Colors.CYAN}oauth-do login{Colors.RESET} to authenticate")
            return

        auth_result = await get_user(token)

        if not auth_result.user:
            click.echo(f"{Colors.DIM}Not authenticated{Colors.RESET}")
            click.echo(f"\nRun {Colors.CYAN}oauth-do login{Colors.RESET} to authenticate")
            return

        click.echo(f"{Colors.BRIGHT}Authenticated as:{Colors.RESET}")
        if auth_result.user.name:
            click.echo(f"  {Colors.GREEN}Name:{Colors.RESET} {auth_result.user.name}")
        if auth_result.user.email:
            click.echo(f"  {Colors.GREEN}Email:{Colors.RESET} {auth_result.user.email}")
        if auth_result.user.id:
            click.echo(f"  {Colors.GREEN}ID:{Colors.RESET} {auth_result.user.id}")

    except Exception as e:
        print_error("Failed to get user info", e)
        sys.exit(1)


async def token_command() -> None:
    """Token command - display current token."""
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        token = await storage.get_token()

        if not token:
            click.echo(f"{Colors.DIM}No token found{Colors.RESET}")
            click.echo(f"\nRun {Colors.CYAN}oauth-do login{Colors.RESET} to authenticate")
            return

        click.echo(token)

    except Exception as e:
        print_error("Failed to get token", e)
        sys.exit(1)


async def status_command() -> None:
    """Status command - show authentication and storage status."""
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        click.echo(f"{Colors.BRIGHT}OAuth.do Status{Colors.RESET}\n")

        # Get storage info
        if isinstance(storage, FileStorage):
            storage_info = await storage.get_storage_info()
            click.echo(f"{Colors.CYAN}Storage:{Colors.RESET} {Colors.GREEN}Secure File{Colors.RESET}")
            click.echo(f"  {Colors.DIM}Using ~/.oauth.do/token with 0600 permissions{Colors.RESET}")
        else:
            click.echo(f"{Colors.CYAN}Storage:{Colors.RESET} {Colors.GREEN}Keyring{Colors.RESET}")

        # Get auth status
        token = await storage.get_token()
        if not token:
            click.echo(f"\n{Colors.CYAN}Auth:{Colors.RESET} {Colors.DIM}Not authenticated{Colors.RESET}")
            click.echo(f"\nRun {Colors.CYAN}oauth-do login{Colors.RESET} to authenticate")
            return

        auth_result = await get_user(token)
        if auth_result.user:
            click.echo(f"\n{Colors.CYAN}Auth:{Colors.RESET} {Colors.GREEN}Authenticated{Colors.RESET}")
            if auth_result.user.email:
                click.echo(f"  {Colors.DIM}{auth_result.user.email}{Colors.RESET}")
        else:
            click.echo(f"\n{Colors.CYAN}Auth:{Colors.RESET} {Colors.YELLOW}Token expired or invalid{Colors.RESET}")
            click.echo(f"\nRun {Colors.CYAN}oauth-do login{Colors.RESET} to re-authenticate")

    except Exception as e:
        print_error("Failed to get status", e)
        sys.exit(1)


async def auto_login_or_show_user() -> None:
    """
    Auto login or show current user.

    If already logged in with valid token, show user info.
    If not logged in or token expired, start login flow.
    """
    config = get_config()
    storage = create_secure_storage(config.storage_path)

    try:
        # Check if we have a stored token
        token = await storage.get_token()

        if token:
            # Verify the token is still valid
            auth_result = await get_user(token)

            if auth_result.user:
                # Already logged in - show user info
                click.echo(f"{Colors.GREEN}[ok]{Colors.RESET} Already authenticated\n")
                if auth_result.user.name:
                    click.echo(f"  {Colors.BRIGHT}{auth_result.user.name}{Colors.RESET}")
                if auth_result.user.email:
                    click.echo(f"  {Colors.GRAY}{auth_result.user.email}{Colors.RESET}")
                if auth_result.user.id:
                    click.echo(f"  {Colors.DIM}ID: {auth_result.user.id}{Colors.RESET}")
                return

            # Token exists but is invalid/expired - continue to login
            print_info("Session expired, logging in again...\n")

        # Not logged in - start login flow
        await login_command()

    except Exception:
        # If auth check fails, try to login
        await login_command()


def main() -> None:
    """Main entry point for the CLI."""
    cli()


if __name__ == "__main__":
    main()
