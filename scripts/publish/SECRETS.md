# Required Secrets for Multi-Platform Publishing

This document lists all the secrets required for publishing to various package registries.

## GitHub Repository Secrets

Add these secrets to your GitHub repository at:
`Settings > Secrets and variables > Actions > Repository secrets`

### Required Secrets

| Secret Name | Registry | How to Get |
|-------------|----------|------------|
| `NPM_TOKEN` | npm | [npmjs.com](https://www.npmjs.com/) > Access Tokens > Generate New Token (Automation) |
| `PYPI_API_TOKEN` | PyPI | [pypi.org](https://pypi.org/) > Account Settings > API tokens |
| `CARGO_TOKEN` | crates.io | [crates.io](https://crates.io/) > Account Settings > API Tokens |
| `NUGET_API_KEY` | NuGet | [nuget.org](https://www.nuget.org/) > API Keys > Create |
| `RUBYGEMS_API_KEY` | RubyGems | [rubygems.org](https://rubygems.org/) > Edit Profile > API Keys |
| `HEX_API_KEY` | Hex.pm | `mix hex.user auth` then copy from `~/.hex/hex.config` |
| `PUB_CREDENTIALS` | pub.dev | JSON from `~/.config/dart/pub-credentials.json` after `dart pub login` |
| `OSSRH_USERNAME` | Maven Central | Sonatype OSSRH account username |
| `OSSRH_PASSWORD` | Maven Central | Sonatype OSSRH account password |
| `GPG_PRIVATE_KEY` | Maven Central | GPG key for signing (base64 encoded) |
| `GPG_PASSPHRASE` | Maven Central | GPG key passphrase |

## Detailed Setup Instructions

### npm (NPM_TOKEN)

1. Go to https://www.npmjs.com/
2. Log in to your account
3. Click your profile picture > Access Tokens
4. Generate New Token > Automation (for CI/CD)
5. Copy the token immediately (shown only once)

```bash
# Test locally:
npm login
npm config get //registry.npmjs.org/:_authToken
```

### PyPI (PYPI_API_TOKEN)

1. Go to https://pypi.org/manage/account/
2. Scroll to "API tokens"
3. Add API token > Scope: Entire account (or specific project)
4. Copy token (starts with `pypi-`)

```bash
# Test locally:
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-...
python -m twine upload dist/*
```

### crates.io (CARGO_TOKEN)

1. Go to https://crates.io/settings/tokens
2. New Token > give it a name
3. Copy the token

```bash
# Test locally:
cargo login <token>
# or
export CARGO_REGISTRY_TOKEN=...
cargo publish
```

### NuGet (NUGET_API_KEY)

1. Go to https://www.nuget.org/account/apikeys
2. Create > Name it, set expiry, select packages
3. Copy the key

```bash
# Test locally:
dotnet nuget push pkg.nupkg --api-key YOUR_KEY --source https://api.nuget.org/v3/index.json
```

### RubyGems (RUBYGEMS_API_KEY)

1. Go to https://rubygems.org/profile/edit
2. API Keys section > Add a new key
3. Select "Push rubygems"
4. Copy the key

```bash
# Test locally:
mkdir -p ~/.gem
echo ":rubygems_api_key: YOUR_KEY" > ~/.gem/credentials
chmod 0600 ~/.gem/credentials
gem push your-gem-0.1.0.gem
```

### Hex.pm (HEX_API_KEY)

```bash
# Generate key locally:
mix hex.user auth

# Find the key:
cat ~/.hex/hex.config
# Look for {:api_key, "..."}

# Test:
HEX_API_KEY=... mix hex.publish --yes
```

### pub.dev (PUB_CREDENTIALS)

```bash
# First, authenticate interactively:
dart pub login

# Then copy the credentials file:
cat ~/.config/dart/pub-credentials.json

# The entire JSON content is your secret
```

### Maven Central (OSSRH_USERNAME, OSSRH_PASSWORD, GPG_PRIVATE_KEY, GPG_PASSPHRASE)

Maven Central is the most complex. You need:

1. **Sonatype OSSRH Account**
   - Create account at https://issues.sonatype.org/
   - Create JIRA ticket to claim your groupId (e.g., `dev.dotdo`)
   - Wait for approval (usually < 24 hours)

2. **GPG Key for Signing**
   ```bash
   # Generate key:
   gpg --full-generate-key
   # Choose RSA 4096, no expiration

   # List keys:
   gpg --list-secret-keys --keyid-format LONG

   # Export public key to keyserver:
   gpg --keyserver keyserver.ubuntu.com --send-keys YOUR_KEY_ID

   # Export private key (base64 for GitHub secret):
   gpg --export-secret-keys YOUR_KEY_ID | base64
   ```

3. **gradle.properties** (for local testing):
   ```properties
   signing.gnupg.keyName=YOUR_KEY_ID
   signing.gnupg.passphrase=YOUR_PASSPHRASE
   mavenCentralUsername=YOUR_USERNAME
   mavenCentralPassword=YOUR_PASSWORD
   ```

## Auto-Sync Registries (No Secrets Needed)

These registries sync automatically from GitHub:

| Registry | Mechanism |
|----------|-----------|
| **Go** (pkg.go.dev) | Auto-indexed from git tags |
| **PHP** (Packagist) | GitHub webhook (configure at packagist.org) |
| **Deno** (deno.land/x) | GitHub webhook (configure at deno.land) |
| **Swift** (SPM) | Uses git tags directly |
| **Crystal** (shards) | Uses GitHub releases |
| **Nim** (Nimble) | Uses GitHub tags |

## Environment Variables for Local Publishing

Create a `.env.publish` file (DO NOT commit):

```bash
# npm
NPM_TOKEN=npm_...

# PyPI
TWINE_USERNAME=__token__
TWINE_PASSWORD=pypi-...

# Rust
CARGO_REGISTRY_TOKEN=...

# NuGet
NUGET_API_KEY=...

# Ruby
GEM_HOST_API_KEY=...

# Elixir
HEX_API_KEY=...

# Maven
OSSRH_USERNAME=...
OSSRH_PASSWORD=...
GPG_PASSPHRASE=...
```

Then source it:
```bash
source .env.publish
./scripts/publish/publish-all.sh 0.1.0
```

## Troubleshooting

### "Package name already taken"
Some package names like `rpc.do`, `dotdo` may already be taken on npm. Use scoped packages:
- `@dotdo/capnweb` instead of `capnweb`
- `@dotdo/rpc` instead of `rpc.do`

### "401 Unauthorized"
- Token expired or revoked
- Wrong token for the registry
- Token doesn't have publish permissions

### "Version already exists"
The scripts automatically skip already-published versions. This is intentional for idempotent runs.

### Maven "403 Forbidden"
- GroupId not claimed in OSSRH
- GPG key not uploaded to keyserver
- Signing issues

### pub.dev "Unauthorized"
- Credentials file format wrong
- Google account not linked to pub.dev
- Package name reserved
