# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = 'rpc.do'
  spec.version = '0.4.0'
  spec.authors       = ['DotDo Team']
  spec.email         = ['team@dotdo.dev']

  spec.summary       = 'DotDo RPC - Remote Procedure Call primitives for Ruby'
  spec.description   = 'Core RPC primitives for the DotDo platform, including promises, ' \
                       'pipelining, server-side mapping (remap), and result types.'
  spec.homepage      = 'https://github.com/dotdo/rpc'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 3.1.0'

  spec.metadata['homepage_uri'] = spec.homepage
  spec.metadata['source_code_uri'] = 'https://github.com/dotdo/rpc'
  spec.metadata['changelog_uri'] = 'https://github.com/dotdo/rpc/blob/main/CHANGELOG.md'

  spec.files = Dir.chdir(__dir__) do
    `git ls-files -z`.split("\x0").reject do |f|
      (f == __FILE__) || f.match(%r{\A(?:(?:bin|test|spec|features)/|\.(?:git|travis|circleci)|appveyor)})
    end
  end
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']
end
