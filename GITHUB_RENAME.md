# GitHub Repository Rename: capnweb -> sdks

This document outlines the manual steps required to complete the repository rename on GitHub.

## Pre-Rename Checklist (Completed)

The following changes have been made to the codebase to prepare for the rename:

- [x] Updated `package.json` name from `capnweb` to `@dotdo/sdks`
- [x] Updated `package.json` repository URLs to `github.com/dot-do/sdks`
- [x] Updated `.changeset/config.json` repo reference
- [x] Updated `README.md` with new repository context
- [x] Updated `packages/python/capnweb/pyproject.toml` URLs
- [x] Updated `packages/go/capnweb/README.md` import paths
- [x] Updated `packages/go/capnweb/SYNTAX.md` import paths
- [x] Updated `packages/go/capnweb/API.md` import paths
- [x] Updated `packages/swift/capnweb/README.md` package URL
- [x] Updated `packages/dart/capnweb/SYNTAX.md` repository URL
- [x] Updated `DESIGN.md` Go package reference
- [x] Updated `ARCHITECTURE.md` repo references
- [x] Updated `DISTRIBUTION.md` repo references

## Manual Steps Required on GitHub

### 1. Rename the Repository

1. Go to https://github.com/dot-do/capnweb/settings
2. Scroll to "Repository name" section
3. Change from `capnweb` to `sdks`
4. Click "Rename"

### 2. Update GitHub Redirect (Automatic)

GitHub automatically creates a redirect from the old URL to the new URL. This redirect will remain active unless:
- A new repository with the old name is created
- The redirect is manually removed

### 3. Update CI/CD Workflows

After the rename, verify all GitHub Actions workflows still work correctly:
- Check workflow triggers
- Verify any hardcoded repository references in workflows
- Update any external CI/CD systems that reference the old URL

### 4. Update External References

Search for and update references in:
- Other repositories that depend on this one
- Documentation sites
- Package registry metadata (npm, PyPI, etc.)
- Any external links or bookmarks

### 5. Notify Collaborators

Inform team members and collaborators about the rename so they can:
- Update their local git remotes: `git remote set-url origin https://github.com/dot-do/sdks.git`
- Update any IDE integrations or tools

### 6. Update Go Module Path (If Published)

If the Go package is published, users will need to update their imports:
```go
// Old
import "github.com/dot-do/capnweb"

// New
import "github.com/dot-do/sdks/packages/go/capnweb"
```

## Post-Rename Verification

After completing the rename:

1. Verify the redirect works: https://github.com/dot-do/capnweb should redirect to https://github.com/dot-do/sdks
2. Test cloning: `git clone https://github.com/dot-do/sdks.git`
3. Verify CI/CD runs successfully
4. Check package publishing still works

## Notes

- The CHANGELOG.md still references `cloudflare/capnweb` in historical entries. These should remain as-is to preserve accurate history.
- The `.gitmodules` file references other repositories (`dot-do/mongo`, `dot-do/kafka`) - these do not need updating as they are separate repos.
- The Go vanity import domain may need to be updated if using `go.dotdo.dev/capnweb` style imports.
