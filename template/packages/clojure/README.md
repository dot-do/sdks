# {{name}}-do

[![Clojars Project](https://img.shields.io/clojars/v/com.dotdo/{{name}}-do.svg)](https://clojars.org/com.dotdo/{{name}}-do)

{{Name}}.do SDK for Clojure - {{description}}

## Installation

### deps.edn

```clojure
{:deps {com.dotdo/{{name}}-do {:mvn/version "0.1.0"}}}
```

### Leiningen

```clojure
[com.dotdo/{{name}}-do "0.1.0"]
```

## Quick Start

```clojure
(require '[{{name}}-do.core :as {{name}}])

;; Create client with API key
(def client ({{name}}/create-client {:api-key (System/getenv "DOTDO_KEY")}))

;; Connect to the service
@({{name}}/connect! client)

;; Make RPC calls
@({{name}}/call! client :greet "World")
;; => "Hello, World!"

;; Disconnect when done
@({{name}}/disconnect! client)
```

## Configuration

```clojure
(def client
  ({{name}}/create-client
    {:api-key "your-api-key"
     :base-url "https://{{name}}.do"   ; Custom endpoint
     :timeout-ms 30000}))                ; Connection timeout
```

## Error Handling

```clojure
(try
  @({{name}}/call! client :get-user 123)
  (catch clojure.lang.ExceptionInfo e
    (let [{:keys [type message]} (ex-data e)]
      (case type
        :{{name}}-do/not-connected (println "Not connected")
        :{{name}}-do/auth-failed   (println "Auth failed:" message)
        :{{name}}-do/not-found     (println "Not found:" message)
        (throw e)))))
```

## With Threading Macros

```clojure
;; Chain operations
(-> client
    ({{name}}/call! :authenticate token)
    deref
    :user-id
    (#({{name}}/call! client :get-profile %))
    deref
    :name)
```

## License

MIT
