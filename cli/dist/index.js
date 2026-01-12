#!/usr/bin/env node
/**
 * dotdo CLI - Scaffold new .do domain repos
 *
 * Usage:
 *   npx dotdo init <name>         Create a new .do repo
 *   npx dotdo init mongo          Creates mongo.do/
 *   npx dotdo init mongo --github Create and push to GitHub
 */
import { init } from './commands/init.js';
const VERSION = '0.1.0';
function printHelp() {
    console.log(`
dotdo v${VERSION} - Scaffold new .do domain repos

Usage:
  dotdo init <name> [options]    Create a new .do domain repo
  dotdo list                     Show supported languages
  dotdo help                     Show this help message
  dotdo version                  Show version

Commands:
  init <name>                    Scaffold a new repo from the template
  list                           Show all supported SDK languages

Options for init:
  --dir <path>                   Target directory (default: ./<name>.do)
  --description <text>           Project description
  --github                       Create a GitHub repository
  --org <name>                   GitHub organization (default: dot-do)
  --private                      Make GitHub repo private

Examples:
  dotdo init mongo               Create mongo.do/ directory
  dotdo init kafka --github      Create kafka.do/ and GitHub repo
  dotdo init db --dir ./my-db    Create in custom directory

Template placeholders:
  {{name}}     -> lowercase (mongo)
  {{Name}}     -> capitalized (Mongo)
  {{NAME}}     -> uppercase (MONGO)
  {{name-do}}  -> hyphenated (mongo-do)
  {{name_do}}  -> underscored (mongo_do)
  {{name.do}}  -> dotted (mongo.do)
  {{description}} -> project description
`);
}
function printVersion() {
    console.log(`dotdo v${VERSION}`);
}
function printLanguages() {
    console.log(`
Supported SDK languages in the .do template:

  Language      | Package Manager  | Directory
  --------------|------------------|------------------
  TypeScript    | npm              | packages/typescript
  Python        | PyPI             | packages/python
  Go            | Go modules       | packages/go
  Rust          | Cargo            | packages/rust
  Java          | Maven/Gradle     | packages/java
  Kotlin        | Gradle           | packages/kotlin
  Ruby          | RubyGems         | packages/ruby
  PHP           | Composer         | packages/php
  C# (.NET)     | NuGet            | packages/dotnet
  F#            | NuGet            | packages/fsharp
  Swift         | SwiftPM          | packages/swift
  Dart          | pub.dev          | packages/dart
  Scala         | sbt              | packages/scala
  Elixir        | Hex              | packages/elixir
  Clojure       | Clojars          | packages/clojure
  Crystal       | Shards           | packages/crystal
  Nim           | Nimble           | packages/nim

Each language SDK includes:
  - Client class with connect/disconnect
  - Error/exception handling
  - Tests
  - README with usage examples
`);
}
function parseArgs(args) {
    const options = {};
    let command = '';
    let name;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            return { command: 'help', options };
        }
        if (arg === '--version' || arg === '-v') {
            return { command: 'version', options };
        }
        if (arg === '--dir' && args[i + 1]) {
            options.dir = args[++i];
            continue;
        }
        if (arg === '--description' && args[i + 1]) {
            options.description = args[++i];
            continue;
        }
        if (arg === '--github') {
            options.github = true;
            continue;
        }
        if (arg === '--org' && args[i + 1]) {
            options.org = args[++i];
            continue;
        }
        if (arg === '--private') {
            options.private = true;
            continue;
        }
        if (!command) {
            command = arg;
            continue;
        }
        if (!name) {
            name = arg;
            continue;
        }
    }
    return { command, name, options };
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        printHelp();
        process.exit(0);
    }
    const { command, name, options } = parseArgs(args);
    switch (command) {
        case 'help':
        case '--help':
        case '-h':
            printHelp();
            break;
        case 'version':
        case '--version':
        case '-v':
            printVersion();
            break;
        case 'init':
            if (!name) {
                console.error('Error: Name is required for init command');
                console.error('Usage: dotdo init <name>');
                process.exit(1);
            }
            await init(name, options);
            break;
        case 'list':
        case 'languages':
        case 'langs':
            printLanguages();
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.error('Run "dotdo help" for usage information.');
            process.exit(1);
    }
}
main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
});
//# sourceMappingURL=index.js.map