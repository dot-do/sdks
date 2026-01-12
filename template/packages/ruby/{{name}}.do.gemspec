# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = '{{name}}.do'
  spec.version       = '0.1.0'
  spec.authors       = ['DotDo Team']
  spec.email         = ['team@dotdo.dev']

  spec.summary       = '{{Name}}.do SDK - {{description}}'
  spec.description   = '{{description}}'
  spec.homepage      = 'https://github.com/dot-do/{{name}}'
  spec.license       = 'MIT'
  spec.required_ruby_version = '>= 3.1.0'

  spec.metadata['homepage_uri'] = 'https://{{name}}.do'
  spec.metadata['source_code_uri'] = 'https://github.com/dot-do/{{name}}'
  spec.metadata['changelog_uri'] = 'https://github.com/dot-do/{{name}}/blob/main/CHANGELOG.md'

  spec.files = Dir.chdir(__dir__) do
    `git ls-files -z`.split("\x0").reject do |f|
      (f == __FILE__) || f.match(%r{\A(?:(?:bin|test|spec|features)/|\.(?:git|travis|circleci)|appveyor)})
    end
  end
  spec.bindir = 'exe'
  spec.executables = spec.files.grep(%r{\Aexe/}) { |f| File.basename(f) }
  spec.require_paths = ['lib']

  spec.add_dependency 'rpc.do', '~> 0.1'
  spec.add_dependency 'websocket-client-simple', '~> 0.8'

  spec.add_development_dependency 'rspec', '~> 3.12'
  spec.add_development_dependency 'rubocop', '~> 1.50'
end
