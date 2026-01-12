# frozen_string_literal: true

require_relative "lib/oauth_do/version"

Gem::Specification.new do |spec|
  spec.name = "oauth-do"
  spec.version = '0.4.0'
  spec.authors = ["OAuth.do"]
  spec.email = ["support@oauth.do"]

  spec.summary = "OAuth.do CLI for device authorization flow"
  spec.description = "A Ruby CLI gem for OAuth 2.0 device authorization flow (RFC 8628). " \
                     "Provides secure authentication for CLI applications with the oauth-do command."
  spec.homepage = "https://oauth.do"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 2.7.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/dotdo/oauth-do-ruby"
  spec.metadata["changelog_uri"] = "https://github.com/dotdo/oauth-do-ruby/blob/main/CHANGELOG.md"
  spec.metadata["rubygems_mfa_required"] = "true"

  # Specify which files should be added to the gem
  spec.files = Dir.chdir(__dir__) do
    `git ls-files -z`.split("\x0").reject do |f|
      (f == __FILE__) ||
        f.match(%r{\A(?:(?:bin|test|spec|features)/|\.(?:git|circleci)|appveyor)})
    end
  end

  # Fallback for when not in a git repo
  if spec.files.empty?
    spec.files = Dir[
      "lib/**/*",
      "exe/*",
      "LICENSE*",
      "README*",
      "CHANGELOG*"
    ]
  end

  spec.bindir = "exe"
  spec.executables = ["oauth-do"]
  spec.require_paths = ["lib"]

  # No runtime dependencies - uses Ruby stdlib only
  # Net::HTTP, JSON, FileUtils are all stdlib

  # Development dependencies
  spec.add_development_dependency "bundler", "~> 2.0"
  spec.add_development_dependency "rake", "~> 13.0"
  spec.add_development_dependency "rspec", "~> 3.0"
  spec.add_development_dependency "rubocop", "~> 1.0"
  spec.add_development_dependency "webmock", "~> 3.0"
end
