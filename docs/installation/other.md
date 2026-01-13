# Other Languages

This page covers languages that are in earlier stages of development.

## Scala

### Installation

```scala
// build.sbt
libraryDependencies += "dev.capnweb" %% "capnweb" % "0.1.0"
```

### Basic Usage

```scala
import dev.capnweb._
import scala.concurrent.ExecutionContext.Implicits.global

object Example extends App {
  val session = CapnWeb.connect("wss://api.example.com")

  for {
    greeting <- session.call[String]("greet", "World")
    _ = println(greeting)
  } yield ()
}
```

**Status**: Alpha - Core features implemented, API may change.

---

## PHP

### Installation

```bash
composer require capnweb/capnweb
```

### Basic Usage

```php
<?php
require 'vendor/autoload.php';

use CapnWeb\Client;

$client = new Client('wss://api.example.com');

$greeting = $client->call('greet', ['World']);
echo $greeting; // "Hello, World!"

$client->close();
```

**Status**: Planned - Structure exists, implementation pending.

---

## Dart

### Installation

```yaml
# pubspec.yaml
dependencies:
  capnweb: ^0.1.0
```

### Basic Usage

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  final api = await CapnWeb.connect('wss://api.example.com');

  final greeting = await api.call<String>('greet', ['World']);
  print(greeting); // "Hello, World!"

  await api.close();
}
```

**Status**: Planned - Structure exists, implementation pending.

---

## Clojure

### Installation

```clojure
;; deps.edn
{:deps {dev.capnweb/capnweb {:mvn/version "0.1.0"}}}
```

### Basic Usage

```clojure
(require '[capnweb.core :as cw])

(def api (cw/connect "wss://api.example.com"))

(let [greeting (cw/call api :greet "World")]
  (println greeting)) ; "Hello, World!"

(cw/close api)
```

**Status**: Planned - Structure exists, implementation pending.

---

## Crystal

### Installation

```yaml
# shard.yml
dependencies:
  capnweb:
    github: dot-do/capnweb-crystal
    version: ~> 0.1.0
```

### Basic Usage

```crystal
require "capnweb"

api = CapnWeb.connect("wss://api.example.com")

greeting = api.call(String, "greet", "World")
puts greeting # "Hello, World!"

api.close
```

**Status**: Alpha - Scaffolded, expect major changes.

---

## Nim

### Installation

```bash
nimble install capnweb
```

### Basic Usage

```nim
import capnweb

let api = connect("wss://api.example.com")

let greeting = api.call(string, "greet", "World")
echo greeting # "Hello, World!"

api.close()
```

**Status**: Planned - Structure exists, implementation pending.

---

## Deno

### Installation

```typescript
import { connect } from "https://deno.land/x/capnweb@v0.1.0/mod.ts";
```

### Basic Usage

```typescript
import { connect, RpcTarget, newWebSocketRpcSession } from "https://deno.land/x/capnweb@v0.1.0/mod.ts";

// Client
const api = await connect("wss://api.example.com");
const greeting = await api.greet("World");
console.log(greeting); // "Hello, World!"

// Server
Deno.serve(async (req) => {
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => {
      newWebSocketRpcSession(socket, new MyApi());
    });
    return response;
  }
  return new Response("Not Found", { status: 404 });
});
```

**Status**: Beta - Works with npm:capnweb, native module in progress.

---

## Contributing

Want to help improve support for these languages? We welcome contributions:

1. Check the [GitHub Issues](https://github.com/dot-do/sdks/issues) for open tasks
2. Look at the `packages/` directory for the language you want to improve
3. Follow the patterns established in the TypeScript reference implementation
4. Add tests following the conformance test suite

### Conformance Tests

All language implementations should pass the conformance test suite:

```bash
# Run conformance tests for all languages
npm run test:all

# Run for specific language
npm run test:lang -- --lang=python
npm run test:lang -- --lang=go
```

### Documentation

When adding or improving a language SDK:

1. Update the installation guide in `docs/installation/`
2. Add language-specific examples
3. Update the README.md language matrix
4. Add to the conformance test suite
