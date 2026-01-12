# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = 'platform.do'
  spec.version       = '0.1.0'
  spec.authors       = ['DotDo Team']
  spec.email         = ['team@dotdo.dev']

  spec.summary       = 'DotDo - Ruby client for the DotDo platform'
  spec.description   = 'Official Ruby SDK for the DotDo platform. Includes authentication, ' \
                       'connection pooling, retry logic, and a high-level client API.'
  spec.homepage      = 'https://github.com/dotdo/dotdo-ruby'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 3.1.0'

  spec.metadata['homepage_uri'] = spec.homepage
  spec.metadata['source_code_uri'] = 'https://github.com/dotdo/dotdo-ruby'
  spec.metadata['changelog_uri'] = 'https://github.com/dotdo/dotdo-ruby/blob/main/CHANGELOG.md'

  spec.files = Dir.chdir(__dir__) do
    `git ls-files -z`.split("\x0").reject do |f|
      (f == __FILE__) || f.match(%r{\A(?:(?:bin|test|spec|features)/|\.(?:git|travis|circleci)|appveyor)})
    end
  end
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']

  # Runtime dependencies
  spec.add_dependency 'rpc.do', '~> 0.1'
  spec.add_dependency 'capnweb.do', '~> 0.1'
  spec.add_dependency 'connection_pool', '~> 2.4'
end
