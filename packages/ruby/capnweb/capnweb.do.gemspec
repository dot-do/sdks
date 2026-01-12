# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = 'capnweb.do'
  spec.version = '0.4.0'
  spec.authors       = ['DotDo Team']
  spec.email         = ['team@dotdo.dev']

  spec.summary       = 'CapnWeb - Capability-based RPC for Ruby'
  spec.description   = 'A Ruby SDK for CapnWeb capability-based RPC protocol, ' \
                       'providing promise-based async calls, pipelining, and server-side mapping.'
  spec.homepage      = 'https://github.com/dotdo/capnweb'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 3.1.0'

  spec.metadata['homepage_uri'] = spec.homepage
  spec.metadata['source_code_uri'] = 'https://github.com/dotdo/capnweb'
  spec.metadata['changelog_uri'] = 'https://github.com/dotdo/capnweb/blob/main/CHANGELOG.md'

  spec.files = Dir.chdir(__dir__) do
    `git ls-files -z`.split("\x0").reject do |f|
      (f == __FILE__) || f.match(%r{\A(?:(?:bin|test|spec|features)/|\.(?:git|travis|circleci)|appveyor)})
    end
  end
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']

  # Runtime dependencies
  spec.add_dependency 'async', '~> 2.6'
  spec.add_dependency 'async-websocket', '~> 0.26'
end
