# do.rpc/sdk

[![Clojars Project](https://img.shields.io/clojars/v/do.rpc/sdk.svg)](https://clojars.org/do.rpc/sdk)

**The magic proxy that makes any `.do` service feel like idiomatic Clojure.**

```clojure
(require '[com.dotdo.rpc :as rpc])

(def api (rpc/connect "wss://mongo.do"))

;; Call any method - no schema required
@(-> api :$ :users (rpc/call :find {:active true}))

;; Pipeline through results - single round trip
@(-> api :$ :users (rpc/call :find-one {:id 123}) :profile :settings)
```

One require. One connection. Zero boilerplate.

---

## What is do.rpc/sdk?

`do.rpc/sdk` is the managed RPC layer for the `.do` ecosystem in Clojure. It sits between raw [com.dotdo/capnweb](https://clojars.org/com.dotdo/capnweb) (the protocol) and domain-specific SDKs like `do.mongo/sdk`, `do.kafka/sdk`, `do.database/sdk`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `(-> api :$ :anything :you :want (rpc/call :method))` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises idiomatically** - Threading macros compile to pipelined requests
4. **Authenticate seamlessly** - Integrates with `oauth.do`
5. **Stream with core.async** - First-class channel integration

```
Your Code
    |
    v
+------------+     +-----------+     +-------------+
| do.rpc/sdk | --> | capnweb   | --> | *.do Server |
+------------+     +-----------+     +-------------+
    |
    +--- Magic proxy (:$ access)
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining (threading macros)
    +--- Auth integration
    +--- core.async streaming
```

---

## do.rpc/sdk vs capnweb

| Feature | capnweb | do.rpc/sdk |
|---------|---------|------------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with protocols | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| Promise pipelining | Yes | Yes (enhanced) |
| Server-side `.rmap` | Yes | Yes (enhanced) |
| core.async channels | Basic | Full integration |
| Manifold deferred | Yes | Yes |
| Spec validation | No | Yes |
| Connection pooling | No | Yes |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use do.rpc/sdk** when you're calling `.do` services and want maximum flexibility with Clojure idioms.

---

## Installation

### deps.edn

```clojure
{:deps {do.rpc/sdk {:mvn/version "0.1.0"}}}
```

### With core.async Support

```clojure
{:deps {do.rpc/sdk             {:mvn/version "0.1.0"}
        org.clojure/core.async {:mvn/version "1.6.681"}}}
```

### With Full Stack (Recommended)

```clojure
{:deps {do.rpc/sdk             {:mvn/version "0.1.0"}
        org.clojure/core.async {:mvn/version "1.6.681"}
        manifold/manifold      {:mvn/version "0.4.2"}}}
```

### Leiningen

```clojure
[do.rpc/sdk "0.1.0"]
```

### Babashka

```clojure
{:deps {do.rpc/sdk {:mvn/version "0.1.0"}}}
```

See [Babashka Support](#babashka-support) for scripting examples.

---

## Quick Start

```clojure
(ns myapp.core
  (:require [com.dotdo.rpc :as rpc]))

;; Connect to any .do service
(def client (rpc/connect "wss://api.example.do"))

;; Get the magic proxy - your entry point to the remote API
(def api (:$ client))

;; Make calls with threading macros
@(-> api (rpc/call :greet "World"))
;; => "Hello, World!"

;; Access namespaces with keywords
@(-> api :users (rpc/call :get 123))
;; => {:id 123 :name "Alice" :email "alice@example.com"}

;; Chain through the result - still one round trip!
@(-> api :users (rpc/call :get 123) :profile :display-name)
;; => "Alice"

;; Clean up when done
(rpc/close! client)
```

---

## The Magic Proxy

The `:$` key returns a magic proxy that intercepts all property access and method calls, sending them as RPC requests.

### How It Works

```clojure
(def client (rpc/connect "wss://api.example.do"))

;; Every property access is recorded
(:$ client)                        ;; proxy
(-> (:$ client) :users)            ;; proxy with path [:users]
(-> (:$ client) :users :admin)     ;; proxy with path [:users :admin]
(-> (:$ client) :users (rpc/call :get 123))  ;; RPC call
```

The proxy doesn't know what methods exist on the server. It records the path and sends it when you dereference.

### Nested Access

Access deeply nested APIs naturally:

```clojure
;; All of these work
@(-> api :users (rpc/call :get 123))
@(-> api :users :profiles :settings :theme (rpc/call :get))
@(-> api :api :v2 :admin :users (rpc/call :deactivate user-id))
```

### Dynamic Keys

Use `get` for dynamic property names:

```clojure
(let [table-name "users"]
  @(-> api (get table-name) (rpc/call :find {:active true})))

;; Equivalent to
@(-> api :users (rpc/call :find {:active true}))
```

### Keyword and String Methods

Both keywords and strings work for method names:

```clojure
;; Keywords (idiomatic)
@(-> api :users (rpc/call :get 123))

;; Strings (for dynamic method names)
(let [method "get"]
  @(-> api :users (rpc/call method 123)))
```

---

## Promise Pipelining with Threading Macros

The killer feature: Clojure's threading macros *are* the pipelining syntax. Every step before `@` is batched into a single request.

### The Problem: Network Latency

Without pipelining, each deref waits for a response:

```clojure
;; BAD: 3 round trips (150ms on a 50ms connection)
(let [user    @(-> api :users (rpc/call :get 123))
      profile @(-> user :profile)
      name    @(-> profile :name)]
  name)
```

### The Solution: Don't Deref Until the End

```clojure
;; GOOD: 1 round trip (50ms)
@(-> api :users (rpc/call :get 123) :profile :name)
```

The magic: each step returns an `RpcPromise` that knows how to pipeline the next operation. The entire chain compiles to a single network request.

### Using the Thread-First Macro

```clojure
;; Build up a pipeline
(-> api
    (rpc/call :authenticate token)
    (rpc/call :get-user-id)
    :profile
    :settings
    :theme)
;; Returns an RpcPromise - no network yet

;; Deref triggers the request
@(-> api
     (rpc/call :authenticate token)
     (rpc/call :get-user-id)
     :profile
     :settings
     :theme)
;; => "dark"  ; All in one round trip
```

### Using the Thread-Last Macro

For functions that take the collection last:

```clojure
@(->> (rpc/call api :list-user-ids)
      (rpc/rmap #(-> api :profiles (rpc/call :get %)))
      (rpc/rfilter :active?)
      (rpc/take 10))
```

### Forking Pipelines

Branch from a common stem - still one round trip:

```clojure
(let [auth    (-> api (rpc/call :authenticate token))
      ;; Both fork from auth
      profile (-> auth (rpc/call :get-profile))
      notifs  (-> auth (rpc/call :get-notifications))]
  {:profile       @profile
   :notifications @notifs})
```

### Gathering Independent Pipelines

When pipelines don't share a stem, use `rpc/gather`:

```clojure
@(rpc/gather
   (-> api :users (rpc/call :get 1))
   (-> api :users (rpc/call :get 2))
   (-> api :config (rpc/call :get-all)))
;; => [{:id 1 ...} {:id 2 ...} {:theme "dark" ...}]
```

### The `rpc/let->` Macro

For complex pipelines with named intermediate values:

```clojure
@(rpc/let-> [user    (-> api :users (rpc/call :get 123))
             profile (-> user :profile)
             posts   (-> user :posts (rpc/call :recent 5))
             friends (-> user :friends (rpc/call :online))]
   {:name    (:display-name profile)
    :bio     (:bio profile)
    :posts   posts
    :friends (count friends)})
```

All bindings in `rpc/let->` are pipelined together - one round trip for the entire let block.

### Using `as->` for Non-Linear Flows

When later steps need to reference earlier values by name:

```clojure
@(as-> api $
   (rpc/call $ :authenticate token)
   (rpc/call $ :get-user-id)
   (-> api :profiles (rpc/call :get $) :avatar-url))
```

### Pipeline Introspection

Inspect pipelines before execution:

```clojure
(def p (-> api :users (rpc/call :get 123) :profile :name))

(rpc/pipeline-data p)
;; => [{:op :get :key :users}
;;     {:op :call :method :get :args [123]}
;;     {:op :get :key :profile}
;;     {:op :get :key :name}]

(rpc/explain p)
;; => "api -> :users -> call(:get, 123) -> :profile -> :name"

(rpc/dry-run p)
;; => {:operations           4
;;     :estimated-roundtrips 1
;;     :pipeline-depth       4
;;     :captures             []}
```

---

## Remote Collections with `rmap`

Transform remote collections without multiple round trips using `rpc/rmap`. This compiles to the protocol's `remap` operation - a server-side map that can reference captured stubs.

### Basic Mapping

```clojure
;; Get user IDs, then fetch each user's profile
@(-> api
     (rpc/call :list-user-ids)
     (rpc/rmap #(-> api :profiles (rpc/call :get %))))
;; => [{:id 1 :name "Alice"} {:id 2 :name "Bob"} ...]
```

### How `rmap` Works (Protocol Deep-Dive)

When you call `rpc/rmap`, the library:

1. **Captures** any stubs referenced in your mapping function (e.g., `api`)
2. **Compiles** your function body into a sequence of RPC instructions
3. **Sends** both captures and instructions to the server
4. **Server executes** the map function for each element, using the captured stubs

```clojure
;; This Clojure code:
(-> api
    (rpc/call :list-user-ids)
    (rpc/rmap (fn [id]
                {:id      id
                 :profile (-> api :profiles (rpc/call :get id))
                 :posts   (-> api :posts (rpc/call :by-user id))})))

;; Compiles to a single "remap" expression in the protocol
;; The captured `api` reference is sent along with instructions
```

The key insight: your function body becomes server-side instructions. Captures (like `api`) are passed by reference, so the server can use them to make further RPC calls - all in a single round trip.

### Building Composite Objects

```clojure
@(-> api
     (rpc/call :list-user-ids)
     (rpc/rmap (fn [id]
                 {:id      id
                  :profile (-> api :profiles (rpc/call :get id))
                  :posts   (-> api :posts (rpc/call :by-user id))})))
```

### Filtering with `rfilter`

```clojure
@(-> api
     (rpc/call :list-users)
     (rpc/rfilter :active?)
     (rpc/rmap :email))
;; => ["alice@example.com" "bob@example.com"]
```

### Chaining Remote Operations

```clojure
@(-> api
     (rpc/call :list-users)
     (rpc/rfilter :active?)
     (rpc/rfilter #(> (:posts-count %) 10))
     (rpc/rmap #(select-keys % [:id :name :email]))
     (rpc/take 20))
```

### Transducers

Compose transformations idiomatically:

```clojure
@(-> api
     (rpc/call :list-users)
     (rpc/transduce
       (comp
         (filter :active?)
         (filter #(> (:posts-count %) 10))
         (map #(select-keys % [:id :name :email]))
         (take 20))
       conj []))
```

### `rmap-indexed`

When you need the index:

```clojure
@(-> api
     (rpc/call :list-items)
     (rpc/rmap-indexed (fn [item idx]
                          {:item item
                           :position idx
                           :ordinal (inc idx)})))
```

---

## Capabilities

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object.

### Creating Capabilities

```clojure
;; Server returns a capability reference
(def counter @(-> api (rpc/call :make-counter 10)))

;; counter is now a proxy to the remote Counter object
(rpc/capability-id counter)  ;; => 1

;; Call methods on the capability
@(rpc/call counter :value)       ;; => 10
@(rpc/call counter :increment 5) ;; => 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```clojure
;; Create two counters
(def counter1 @(-> api (rpc/call :make-counter 10)))
(def counter2 @(-> api (rpc/call :make-counter 20)))

;; Pass counter1 to a method
@(-> api (rpc/call :add-counters counter1 counter2))
;; => 30
```

### Capability Lifecycle

Capabilities are automatically serialized when passed over RPC:

```clojure
;; When you pass a capability...
@(-> api (rpc/call :do-something counter))

;; rpc.do converts it to: {:$ref (capability-id counter)}
;; The server looks up the capability and uses that object
```

### Local Capability Export

Expose local Clojure functions as capabilities the server can call back:

```clojure
;; Create a callback capability
(def on-event (rpc/callback (fn [event]
                               (println "Received:" event))))

;; Pass to server for callbacks
@(-> api (rpc/call :subscribe "user-events" on-event))
;; Server will invoke on-event when events occur
```

---

## core.async Integration

For channel-based async operations, require the async namespace:

```clojure
(require '[com.dotdo.rpc.async :as rpc-async]
         '[clojure.core.async :as async :refer [go go-loop <! >! chan]])
```

### Channel-Returning Calls

```clojure
(go
  (let [user (<! (rpc-async/call> api :users :get 123))]
    (println "User:" (:name user))))
```

### Parallel Calls with `alts!`

```clojure
(go
  (let [user-ch   (rpc-async/call> api :users :get 123)
        config-ch (rpc-async/call> api :config :get-all)
        [result ch] (async/alts! [user-ch config-ch])]
    (if (= ch user-ch)
      (println "User loaded first:" result)
      (println "Config loaded first:" result))))
```

### Timeout Handling

```clojure
(go
  (let [result-ch  (rpc-async/call> api :slow-operation)
        timeout-ch (async/timeout 5000)
        [result ch] (async/alts! [result-ch timeout-ch])]
    (if (= ch timeout-ch)
      (println "Operation timed out!")
      (println "Result:" result))))
```

### Streaming Results

Subscribe to server events and receive them as a channel:

```clojure
(go
  (let [events-ch (<! (rpc-async/subscribe> api :events "user.*"))]
    (go-loop []
      (when-let [event (<! events-ch)]
        (println "Event:" (:type event) (:data event))
        (recur)))))
```

### Batch Multiple Pipelines

```clojure
(go
  (let [[profile settings notifications]
        (<! (rpc-async/gather>
              (-> api :users (rpc/call :get 123) :profile)
              (-> api :users (rpc/call :get 123) :settings)
              (-> api :users (rpc/call :get 123) :notifications)))]
    {:profile       profile
     :settings      settings
     :notifications notifications}))
```

### Pipeline Builder for Channels

```clojure
(go
  (let [name (<! (rpc-async/pipeline>
                   api
                   [:users (rpc/call :get 123)]
                   [:profile]
                   [:display-name]))]
    (println "Name:" name)))
```

### Pub/Sub with core.async

```clojure
(let [event-ch (chan 100)
      pub (async/pub event-ch :type)]

  ;; Subscribe to different event types
  (let [user-events (chan)]
    (async/sub pub :user user-events)
    (go-loop []
      (when-let [event (<! user-events)]
        (println "User event:" (:data event))
        (recur))))

  (let [system-events (chan)]
    (async/sub pub :system system-events)
    (go-loop []
      (when-let [event (<! system-events)]
        (println "System event:" (:data event))
        (recur))))

  ;; Connect RPC stream to the channel
  @(-> api (rpc/call :subscribe-all event-ch)))
```

### Async Transducers

Apply transducers to streaming channels:

```clojure
(go
  (let [xf (comp
             (filter :important?)
             (map :data)
             (take 100))
        events-ch (<! (rpc-async/subscribe> api :events "*"))
        filtered-ch (async/chan 10 xf)]
    (async/pipe events-ch filtered-ch)
    (loop []
      (when-let [data (<! filtered-ch)]
        (process-important-data data)
        (recur)))))
```

---

## Manifold Integration

For deferred-based async operations:

```clojure
(require '[com.dotdo.rpc.manifold :as rpc-m]
         '[manifold.deferred :as d])

;; Returns a deferred instead of requiring @
(-> (rpc-m/call api :users :get 123)
    (d/chain :profile)
    (d/chain :name)
    (d/chain println))

;; Error handling with d/catch
(-> (rpc-m/call api :users :get 999)
    (d/chain :name)
    (d/catch (fn [e]
               (println "Error:" (ex-message e))
               "Unknown")))

;; Combine multiple deferreds
@(d/zip
   (rpc-m/call api :users :get 1)
   (rpc-m/call api :users :get 2)
   (rpc-m/call api :config :get-all))
;; => [{:id 1 ...} {:id 2 ...} {:theme "dark" ...}]
```

### Manifold Streams for Real-Time Data

```clojure
(require '[manifold.stream :as s])

;; Get a manifold stream of events
(let [events (rpc-m/stream> api :events "user.*")]
  (s/consume println events)

  ;; Or transform the stream
  (-> events
      (s/filter :important?)
      (s/map :data)
      (s/consume process-event)))
```

---

## Error Handling

### Exceptions with ex-info

All RPC errors are `ExceptionInfo` with structured data:

```clojure
(try
  @(-> api :users (rpc/call :get 999))
  (catch clojure.lang.ExceptionInfo e
    (let [{:keys [type message path]} (ex-data e)]
      (case type
        :rpc/not-found     (println "User not found:" message)
        :rpc/unauthorized  (println "Auth required")
        :rpc/network-error (println "Connection lost")
        :rpc/timeout       (println "Request timed out")
        (throw e)))))
```

### Error Data Structure

```clojure
(ex-data e)
;; => {:type    :rpc/not-found
;;     :message "User 999 does not exist"
;;     :path    [:users :get]
;;     :args    [999]
;;     :remote  {:type "NotFoundError"
;;               :code 404
;;               :stack "..."}}
```

### Error Types

| Type | Description |
|------|-------------|
| `:rpc/not-found` | Requested resource doesn't exist |
| `:rpc/unauthorized` | Authentication required |
| `:rpc/forbidden` | Insufficient permissions |
| `:rpc/validation-error` | Invalid input data |
| `:rpc/network-error` | Connection lost |
| `:rpc/timeout` | Request timed out |
| `:rpc/capability-error` | Invalid capability reference |
| `:rpc/server-error` | Internal server error |

### Result Tuples

For explicit error handling without exceptions:

```clojure
(let [[result err] (rpc/try-deref (-> api :users (rpc/call :get 123)))]
  (if err
    (println "Error:" (:message err))
    (println "User:" (:name result))))
```

### Pipeline Recovery

Provide fallback values:

```clojure
;; Static fallback
@(-> api :users (rpc/call :get 123)
     (rpc/recover {:name "Unknown" :id 0})
     :name)

;; Dynamic recovery based on error type
@(-> api :users (rpc/call :get 123)
     (rpc/recover-with
       (fn [{:keys [type]}]
         (when (= type :rpc/not-found)
           {:name "Guest" :id 0})))
     :name)
```

### Retry with Exponential Backoff

```clojure
(defn with-retry
  "Retries an RPC call with exponential backoff."
  [f & {:keys [max-attempts delay-ms]
        :or {max-attempts 3 delay-ms 100}}]
  (loop [attempt 1]
    (let [[result err] (rpc/try-deref (f))]
      (cond
        (nil? err) result

        (>= attempt max-attempts)
        (throw (ex-info "Max retries exceeded"
                 {:attempts attempt} err))

        (#{:rpc/network-error :rpc/timeout} (:type err))
        (do
          (Thread/sleep (long (* delay-ms (Math/pow 2 (dec attempt)))))
          (recur (inc attempt)))

        :else
        (throw (ex-info (:message err) err))))))

(with-retry
  #(-> api :users (rpc/call :get 123))
  :max-attempts 5
  :delay-ms 200)
```

---

## Spec Integration

Validate calls with `clojure.spec.alpha`.

### Define Specs

```clojure
(require '[clojure.spec.alpha :as s])

(s/def ::user-id pos-int?)
(s/def ::user-name (s/and string? #(<= 1 (count %) 100)))
(s/def ::user-email (s/and string? #(re-matches #".+@.+\..+" %)))

(s/def ::user
  (s/keys :req-un [::user-id ::user-name]
          :opt-un [::user-email]))

(s/def ::create-user-args
  (s/keys :req-un [::user-name]
          :opt-un [::user-email]))
```

### Register with Client

```clojure
(rpc/register-specs! client
  {[:users :get]    {:args (s/cat :id ::user-id)
                     :ret  ::user}
   [:users :create] {:args (s/cat :data ::create-user-args)
                     :ret  ::user}
   [:users :search] {:args (s/cat :query string?
                                  :opts (s/? (s/keys :opt-un [::limit ::offset])))
                     :ret  (s/coll-of ::user)}})
```

### Validation in Action

```clojure
@(-> api :users (rpc/call :get "not-a-number"))
;; => ExceptionInfo: Spec validation failed for [:users :get]
;;    In: [0]
;;    val: "not-a-number"
;;    fails spec: :myapp.core/user-id
;;    predicate: pos-int?
```

### Spec Instrumentation

```clojure
;; Enable globally
(rpc/instrument-specs! client)

;; Or per-call
(rpc/with-spec-validation client
  @(-> api :users (rpc/call :create {:name ""})))
```

### Generative Testing

Use specs to generate test data:

```clojure
(require '[clojure.spec.gen.alpha :as gen])

(deftest test-user-creation
  (doseq [user-data (gen/sample (s/gen ::create-user-args) 10)]
    (let [result @(-> test-api :users (rpc/call :create user-data))]
      (is (s/valid? ::user result)))))
```

---

## Protocols for Type Safety

Define protocols for strongly-typed interactions:

### Defining Service Protocols

```clojure
(defprotocol IUserService
  (get-user [this id])
  (create-user [this data])
  (update-user [this id data])
  (delete-user [this id]))

(defprotocol IProfileService
  (get-profile [this user-id])
  (update-profile [this user-id data]))
```

### Implementing with RPC

```clojure
(defrecord RemoteUserService [api]
  IUserService
  (get-user [_ id]
    @(-> api :users (rpc/call :get id)))

  (create-user [_ data]
    @(-> api :users (rpc/call :create data)))

  (update-user [_ id data]
    @(-> api :users (rpc/call :update id data)))

  (delete-user [_ id]
    @(-> api :users (rpc/call :delete id))))

;; Usage
(def users (->RemoteUserService (:$ client)))
(get-user users 123)
```

### Async Protocols

```clojure
(defprotocol IAsyncUserService
  (get-user> [this id])
  (list-users> [this]))

(defrecord AsyncUserService [api]
  IAsyncUserService
  (get-user> [_ id]
    (rpc-async/call> api :users :get id))

  (list-users> [_]
    (rpc-async/call> api :users :list)))

;; Usage with go blocks
(go
  (let [user (<! (get-user> (->AsyncUserService api) 123))]
    (println "User:" (:name user))))
```

---

## Exposing Local Objects as RPC Targets

Pass Clojure objects to the remote server for callbacks and bidirectional communication.

### Functions as Callbacks

```clojure
(def on-event (rpc/callback (fn [event]
                               (println "Received:" event))))

@(-> api (rpc/call :subscribe "user-events" on-event))
;; Remote will invoke on-event when events occur
```

### Maps as Targets

```clojure
(def event-handler
  (rpc/target
    {:on-message (fn [msg]
                   (println "Message:" msg))
     :on-error   (fn [err]
                   (println "Error:" err))
     :on-close   (fn []
                   (println "Connection closed"))
     :dispose    (fn []
                   (println "Handler disposed"))}))

@(-> api :websocket (rpc/call :register event-handler))
```

### Records as Targets

```clojure
(defrecord Calculator []
  Object
  (add [_ a b] (+ a b))
  (multiply [_ a b] (* a b))
  (divide [_ a b]
    (if (zero? b)
      (throw (ex-info "Division by zero" {:a a :b b}))
      (/ a b))))

;; Export and pass to remote
(def calc-stub (rpc/export client (->Calculator)))
@(-> api (rpc/call :register-calculator calc-stub))
```

### Multimethod Targets

```clojure
(defmulti handle-command :type)

(defmethod handle-command :ping [_]
  {:type :pong :timestamp (System/currentTimeMillis)})

(defmethod handle-command :echo [{:keys [message]}]
  {:type :echo :message message})

(defmethod handle-command :default [{:keys [type]}]
  (throw (ex-info "Unknown command" {:type type})))

(def command-handler (rpc/target-multimethod handle-command))
@(-> api (rpc/call :set-command-handler command-handler))
```

---

## Connection Management

### WebSocket (Default)

```clojure
(def client
  (rpc/connect "wss://api.example.do"
    {:timeout-ms        30000
     :reconnect?        true
     :max-reconnects    5
     :reconnect-delay-ms 1000
     :headers           {"Authorization" "Bearer xxx"
                         "X-Client-Id"   "clojure-client"}}))
```

### HTTP Batch Transport

For environments without WebSocket support:

```clojure
(def client
  (rpc/connect "https://api.example.do/rpc"
    {:transport        :http-batch
     :batch-window-ms  10       ; Collect calls for 10ms before sending
     :max-batch-size   100}))   ; Max calls per batch
```

### Connection Events

```clojure
(rpc/on-connect client
  (fn [] (println "Connected!")))

(rpc/on-disconnect client
  (fn [reason] (println "Disconnected:" reason)))

(rpc/on-error client
  (fn [error] (println "Client error:" error)))

(rpc/on-reconnect client
  (fn [attempt] (println "Reconnecting, attempt:" attempt)))
```

### Resource Management

```clojure
;; with-open ensures cleanup
(with-open [client (rpc/connect "wss://api.example.do")]
  @(-> (:$ client) (rpc/call :greet "World")))
```

### Multiple Connections

Connect to multiple `.do` services simultaneously:

```clojure
(let [mongo (rpc/connect "wss://mongo.do")
      kafka (rpc/connect "wss://kafka.do")
      cache (rpc/connect "wss://cache.do")]
  (try
    ;; Use them together
    (let [users @(-> (:$ mongo) :users (rpc/call :find {:active true}))]
      (doseq [user users]
        @(-> (:$ kafka) :events (rpc/call :publish "user.sync" user))
        @(-> (:$ cache) :users (rpc/call :set (:id user) user))))
    (finally
      (rpc/close! mongo)
      (rpc/close! kafka)
      (rpc/close! cache))))
```

---

## Connection Pooling

### Thread-Safe Pool with core.async

```clojure
(require '[clojure.core.async :as async :refer [chan go >! <! <!!]])

(defn create-pool
  "Creates a thread-safe connection pool using a core.async channel.
   The channel acts as a bounded buffer - no race conditions."
  [url n]
  (let [pool-ch (chan n)]
    ;; Initialize pool with connections
    (dotimes [_ n]
      (async/>!! pool-ch (rpc/connect url)))

    {:acquire (fn []
                ;; Blocks until connection available
                (<!! pool-ch))

     :release (fn [client]
                ;; Return connection to pool
                (async/>!! pool-ch client))

     :close   (fn []
                ;; Drain and close all connections
                (async/close! pool-ch)
                (loop []
                  (when-let [c (async/poll! pool-ch)]
                    (rpc/close! c)
                    (recur))))}))

;; Usage with automatic release
(defmacro with-pooled-client
  "Acquires a client from pool, executes body, releases back to pool."
  [pool client-sym & body]
  `(let [~client-sym ((:acquire ~pool))]
     (try
       ~@body
       (finally
         ((:release ~pool) ~client-sym)))))

;; Example
(let [pool (create-pool "wss://api.example.do" 5)]
  (with-pooled-client pool client
    @(-> (:$ client) :users (rpc/call :get 123)))
  ;; Client automatically returned to pool
  ((:close pool)))
```

### Pool with Health Checks

```clojure
(defn create-healthy-pool
  "Creates a pool that validates connections before returning them."
  [url n]
  (let [pool-ch (chan n)
        make-client #(rpc/connect url)
        healthy? (fn [c]
                   (try
                     @(-> (:$ c) (rpc/call :ping))
                     true
                     (catch Exception _ false)))]
    (dotimes [_ n]
      (async/>!! pool-ch (make-client)))

    {:acquire (fn []
                (loop []
                  (let [c (<!! pool-ch)]
                    (if (healthy? c)
                      c
                      (do
                        (rpc/close! c)
                        (async/>!! pool-ch (make-client))
                        (recur))))))

     :release (fn [c] (async/>!! pool-ch c))

     :close   (fn []
                (async/close! pool-ch)
                (loop []
                  (when-let [c (async/poll! pool-ch)]
                    (rpc/close! c)
                    (recur))))}))
```

---

## REPL-Driven Development

The API is designed for exploration. Everything is inspectable.

### Describe Stubs

```clojure
(rpc/describe api)
;; => {:type    :stub
;;     :path    []
;;     :client  #<Client wss://api.example.com>}

(rpc/describe (-> api :users))
;; => {:type    :stub
;;     :path    [:users]
;;     :client  #<Client ...>}
```

### Inspect Pipelines Before Execution

```clojure
(def p (-> api :users (rpc/call :get 123) :profile :name))

(rpc/pipeline-data p)
;; => [{:op :get :key :users}
;;     {:op :call :method :get :args [123]}
;;     {:op :get :key :profile}
;;     {:op :get :key :name}]

(rpc/explain p)
;; => "api -> :users -> call(:get, 123) -> :profile -> :name"
```

### Analyze Without Executing

```clojure
(rpc/dry-run p)
;; => {:operations           4
;;     :estimated-roundtrips 1
;;     :pipeline-depth       4
;;     :captures             []}
```

### Client Introspection

```clojure
(rpc/client-info client)
;; => {:url         "wss://api.example.do"
;;     :status      :connected
;;     :uptime-ms   45230
;;     :pending     0
;;     :exports     3
;;     :imports     12
;;     :reconnects  0}
```

### Live Method Discovery

```clojure
;; If the remote supports introspection:
@(rpc/methods api)
;; => #{:users :config :authenticate :subscribe}

@(rpc/methods (-> api :users))
;; => #{:get :create :update :delete :search :list}

@(rpc/describe-method api :users :get)
;; => {:args [{:name "id" :type "integer" :required true}]
;;     :returns {:type "object" :schema {...}}}
```

### REPL Helpers

```clojure
;; Pretty-print RPC results
(rpc/pp @(-> api :users (rpc/call :get 123)))

;; Time a call
(rpc/timed
  @(-> api :users (rpc/call :list)))
;; Prints: "RPC call took 45.3ms"
;; Returns the result

;; Watch for changes (if server supports it)
(rpc/watch api [:users 123]
  (fn [old new]
    (println "User changed from" old "to" new)))
```

---

## Component Integration

### Stuart Sierra's Component

```clojure
(require '[com.stuartsierra.component :as component])

(defrecord RpcClient [url client api]
  component/Lifecycle
  (start [this]
    (let [client (rpc/connect url)]
      (assoc this
        :client client
        :api (:$ client))))
  (stop [this]
    (when client
      (rpc/close! client))
    (assoc this :client nil :api nil)))

(defn new-rpc-client [url]
  (map->RpcClient {:url url}))

;; In your system
(def system
  (component/system-map
    :rpc-client (new-rpc-client "wss://api.example.do")
    :user-service (component/using
                    (new-user-service)
                    [:rpc-client])))
```

### Mount Integration

```clojure
(require '[mount.core :refer [defstate]])

(defstate rpc-client
  :start (rpc/connect (get-in config [:rpc :url])
           {:headers {"Authorization" (str "Bearer " (:api-token config))}})
  :stop (rpc/close! rpc-client))

(defstate api
  :start (:$ rpc-client))

;; Usage
(mount/start)
@(-> api :users (rpc/call :get 123))
```

### Integrant

```clojure
(require '[integrant.core :as ig])

(defmethod ig/init-key :rpc/client [_ {:keys [url token]}]
  (rpc/connect url {:headers {"Authorization" (str "Bearer " token)}}))

(defmethod ig/halt-key! :rpc/client [_ client]
  (rpc/close! client))

;; config.edn
{:rpc/client {:url "wss://api.example.do"
              :token #env API_TOKEN}}
```

---

## Middleware Pattern

```clojure
(defn wrap-logging [call-fn]
  (fn [api method args]
    (let [start (System/currentTimeMillis)]
      (try
        (let [result (call-fn api method args)]
          (println "CALL" method args "->"
                   (- (System/currentTimeMillis) start) "ms")
          result)
        (catch Exception e
          (println "ERROR" method args "->" (ex-message e))
          (throw e))))))

(defn wrap-metrics [call-fn metrics-atom]
  (fn [api method args]
    (swap! metrics-atom update :calls inc)
    (try
      (call-fn api method args)
      (catch Exception e
        (swap! metrics-atom update :errors inc)
        (throw e)))))

(defn wrap-cache [call-fn cache-atom ttl-ms]
  (fn [api method args]
    (let [cache-key [method args]
          cached (get @cache-atom cache-key)]
      (if (and cached (< (- (System/currentTimeMillis) (:timestamp cached)) ttl-ms))
        (:value cached)
        (let [result (call-fn api method args)]
          (swap! cache-atom assoc cache-key {:value result
                                              :timestamp (System/currentTimeMillis)})
          result)))))

;; Apply middleware
(def call-with-logging
  (wrap-logging rpc/call))

(def metrics (atom {:calls 0 :errors 0}))
(def cache (atom {}))

(def call-with-everything
  (-> rpc/call
      (wrap-logging)
      (wrap-metrics metrics)
      (wrap-cache cache 60000)))
```

---

## Testing and Mocking

### Mock Stubs for Unit Tests

```clojure
(ns myapp.test.api
  (:require [clojure.test :refer :all]
            [com.dotdo.rpc.test :as rpc-test]
            [myapp.core :as app]))

(deftest test-fetch-dashboard
  (let [;; Create a mock stub that returns canned responses
        mock-api (rpc-test/mock-stub
                   {[:users :get 123]           {:id 123 :name "Alice"}
                    [:users :get 123 :profile]  {:display-name "Alice" :bio "Hacker"}
                    [:users :get 123 :posts :recent 5] [{:id 1 :title "Hello"}]})]

    ;; Your code under test sees a normal stub
    (is (= "Alice"
           (:name @(-> mock-api :users (rpc/call :get 123)))))

    ;; Verify the full pipeline works
    (is (= {:name "Alice" :bio "Hacker" :posts [{:id 1 :title "Hello"}]}
           (app/fetch-dashboard mock-api 123)))))

(deftest test-error-handling
  (let [mock-api (rpc-test/mock-stub
                   {[:users :get 999] (rpc-test/error :rpc/not-found "User not found")})]

    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"User not found"
          @(-> mock-api :users (rpc/call :get 999))))))
```

### Recording and Replaying Calls

```clojure
(deftest test-with-recording
  (let [;; Record all RPC calls for later assertions
        [api recording] (rpc-test/recording-stub real-client)]

    ;; Run your code
    (app/sync-user api 123)

    ;; Assert on what was called
    (is (= [[:users :get 123]
            [:users :update 123 {:synced-at _}]]
           (map :path @recording)))))
```

### Integration Testing with Test Server

```clojure
(use-fixtures :once
  (fn [f]
    (let [server (rpc-test/start-test-server
                   {:users {:get    (fn [id] {:id id :name "Test"})
                            :create (fn [data] (assoc data :id 999))}})]
      (try
        (binding [*test-api* (:$ (rpc/connect (:url server)))]
          (f))
        (finally
          (rpc-test/stop-test-server server))))))
```

### Property-Based Testing

```clojure
(require '[clojure.test.check :as tc]
         '[clojure.test.check.generators :as gen]
         '[clojure.test.check.properties :as prop])

(def user-gen
  (gen/hash-map
    :name gen/string-alphanumeric
    :email (gen/fmap #(str % "@example.com") gen/string-alphanumeric)))

(defspec user-roundtrip 100
  (prop/for-all [user user-gen]
    (let [created @(-> test-api :users (rpc/call :create user))
          fetched @(-> test-api :users (rpc/call :get (:id created)))]
      (= (:name user) (:name fetched)))))
```

---

## ClojureScript Support

The same API works seamlessly in ClojureScript. The library auto-detects the platform and uses native WebSocket and Promise implementations.

### Browser Usage

```clojure
(ns myapp.client
  (:require [com.dotdo.rpc :as rpc]
            [cljs.core.async :refer [go <!]]
            [com.dotdo.rpc.async :as rpc-async]))

;; Connect using browser WebSocket
(def client (rpc/connect "wss://api.example.do"))
(def api (:$ client))

;; Threading macro pipelines work identically
;; Note: Use rpc/then instead of @ in ClojureScript
(-> api :users (rpc/call :get 123) :profile :name
    (rpc/then #(js/console.log "User:" %)))

;; Or with core.async
(go
  (let [user (<! (rpc-async/call> api :users :get 123))]
    (js/console.log "User:" (clj->js user))))
```

### Promise Interop

ClojureScript pipelines return JavaScript Promises for easy interop:

```clojure
;; Use with async/await in JS interop
(defn ^:export fetch-user [id]
  (-> api :users (rpc/call :get id) rpc/promise))

;; Combine with existing Promise-based code
(-> (js/fetch "/config.json")
    (.then #(.json %))
    (.then (fn [config]
             (-> api (rpc/call :configure config) rpc/promise)))
    (.then #(js/console.log "Configured!")))
```

### Reagent Integration

```clojure
(ns myapp.hooks
  (:require [com.dotdo.rpc :as rpc]
            [reagent.core :as r]))

(defonce api (:$ (rpc/connect "wss://api.example.do")))

(defn use-rpc
  "Returns [result loading? error] atom for RPC calls."
  [pipeline]
  (let [state (r/atom {:result nil :loading true :error nil})]
    (-> pipeline
        (rpc/then #(reset! state {:result % :loading false :error nil}))
        (rpc/catch #(reset! state {:result nil :loading false :error %})))
    state))

;; Usage in component
(defn user-profile [id]
  (let [state (use-rpc (-> api :users (rpc/call :get id) :profile))]
    (fn []
      (let [{:keys [result loading error]} @state]
        (cond
          loading [:div.spinner "Loading..."]
          error   [:div.error (str error)]
          :else   [:div.profile
                   [:h1 (:name result)]
                   [:p (:bio result)]])))))
```

### Re-frame Integration

```clojure
(ns myapp.events
  (:require [re-frame.core :as rf]
            [com.dotdo.rpc :as rpc]))

(defonce api (:$ (rpc/connect "wss://api.example.do")))

(rf/reg-fx
 :rpc
 (fn [{:keys [call on-success on-error]}]
   (-> (apply rpc/call api call)
       (rpc/then #(rf/dispatch (conj on-success %)))
       (rpc/catch #(rf/dispatch (conj on-error %))))))

(rf/reg-event-fx
 ::fetch-user
 (fn [_ [_ user-id]]
   {:rpc {:call [:users :get user-id]
          :on-success [::user-loaded]
          :on-error [::user-error]}}))

(rf/reg-event-db
 ::user-loaded
 (fn [db [_ user]]
   (assoc db :current-user user)))
```

### Platform Differences

| Feature | JVM | Browser | Node.js |
|---------|-----|---------|---------|
| Blocking `@` / `deref` | Yes | No (use `rpc/then`) | No (use `rpc/then`) |
| core.async | Full | Full | Full |
| WebSocket | Built-in | Native | Requires `ws` package |
| Manifold | Yes | No | No |
| Thread pools | Yes | N/A | N/A |

### Shared Code (cljc)

Write once, run everywhere:

```clojure
;; src/myapp/api.cljc
(ns myapp.api
  (:require [com.dotdo.rpc :as rpc]
            #?(:clj  [clojure.core.async :refer [go <!]]
               :cljs [cljs.core.async :refer [go <!]])
            [com.dotdo.rpc.async :as rpc-async]))

(defn fetch-user-async
  "Works on JVM, Browser, and Node.js"
  [api id]
  (rpc-async/call> api :users :get id))

(defn fetch-dashboard [api user-id]
  (go
    (let [user (<! (fetch-user-async api user-id))
          profile (<! (rpc-async/call> api :profiles :get (:id user)))]
      {:user user :profile profile})))
```

---

## Babashka Support

`do.rpc/sdk` works with Babashka for fast-starting scripts:

```clojure
#!/usr/bin/env bb

(require '[babashka.deps :as deps])
(deps/add-deps '{:deps {do.rpc/sdk {:mvn/version "0.1.0"}}})

(require '[com.dotdo.rpc :as rpc])

(def client (rpc/connect "wss://api.example.do"
               {:headers {"Authorization" (str "Bearer " (System/getenv "API_TOKEN"))}}))
(def api (:$ client))

;; Quick scripting
(let [users @(-> api :users (rpc/call :list))]
  (doseq [u users]
    (println (:name u) "-" (:email u))))

(rpc/close! client)
```

### CLI Tool Example

```clojure
#!/usr/bin/env bb

(require '[babashka.deps :as deps])
(deps/add-deps '{:deps {do.rpc/sdk {:mvn/version "0.1.0"}}})

(require '[com.dotdo.rpc :as rpc]
         '[babashka.cli :as cli])

(def cli-opts
  {:url     {:default "wss://api.example.do"}
   :token   {:env "API_TOKEN"}
   :command {:required true}
   :args    {:coerce []}})

(defn -main [& args]
  (let [opts (cli/parse-opts args {:spec cli-opts})
        client (rpc/connect (:url opts)
                 {:headers {"Authorization" (str "Bearer " (:token opts))}})]
    (try
      (println (pr-str @(apply rpc/call (:$ client) (keyword (:command opts)) (:args opts))))
      (finally
        (rpc/close! client)))))

(apply -main *command-line-args*)
```

---

## Security Considerations

### Authentication

```clojure
;; Pass auth token in connection headers (recommended)
(def client
  (rpc/connect "wss://api.example.do"
    {:headers {"Authorization" (str "Bearer " token)}}))

;; Or authenticate after connection
(def auth-api
  @(-> api (rpc/call :authenticate token)))
```

### Capability Security Model

Cap'n Web uses capability-based security. A stub IS the permission:

```clojure
;; The server gave us a MutablePosts capability - we can use it
(def my-posts
  @(-> api (rpc/call :authenticate token) :my-posts))

;; We can pass this capability to other parts of our code
;; Only code with the stub can call its methods
(defn add-post [posts-cap title body]
  @(-> posts-cap (rpc/call :create {:title title :body body})))

(add-post my-posts "Hello" "World")
```

### Input Validation

Always validate untrusted input before sending:

```clojure
(defn safe-search [api query]
  (when (> (count query) 1000)
    (throw (ex-info "Query too long" {:length (count query)})))
  @(-> api :users (rpc/call :search {:query query})))
```

### Sensitive Data

```clojure
;; Don't log sensitive data
(defn wrap-safe-logging [call-fn]
  (fn [api method args]
    (let [safe-args (cond-> args
                      (= method :authenticate)
                      (update 0 (constantly "[REDACTED]")))]
      (println "CALL" method safe-args)
      (call-fn api method args))))
```

---

## Complete Example

```clojure
(ns myapp.dashboard
  (:require [com.dotdo.rpc :as rpc]
            [clojure.spec.alpha :as s]))

;; Specs
(s/def ::user-id pos-int?)
(s/def ::user (s/keys :req-un [::id ::name ::email]))

;; Main logic
(defn fetch-dashboard [client user-id]
  (let [api (:$ client)]
    @(rpc/let-> [user         (-> api :users (rpc/call :get user-id))
                 profile      (-> user :profile)
                 recent-posts (-> user :posts (rpc/call :recent 5))
                 unread       (-> user :notifications (rpc/call :unread))
                 friends      (-> user :friends (rpc/call :online))]
       {:user    {:id    (:id user)
                  :name  (:display-name profile)
                  :bio   (:bio profile)
                  :avatar (:avatar-url profile)}
        :posts   (mapv #(select-keys % [:id :title :created-at]) recent-posts)
        :unread  (count unread)
        :friends (mapv :name friends)})))

(defn -main [& args]
  (let [token   (System/getenv "API_TOKEN")
        user-id (Long/parseLong (or (first args) "123"))]
    (with-open [client (rpc/connect "wss://api.example.do"
                         {:headers {"Authorization" (str "Bearer " token)}})]
      ;; Register specs for validation
      (rpc/register-specs! client
        {[:users :get] {:args (s/cat :id ::user-id)
                        :ret  ::user}})

      (let [dashboard (fetch-dashboard client user-id)]
        (println "Welcome," (get-in dashboard [:user :name]))
        (println "You have" (:unread dashboard) "unread notifications")
        (println "Recent posts:")
        (doseq [post (:posts dashboard)]
          (println " -" (:title post)))))))
```

---

## API Reference

### Core

| Function | Description |
|----------|-------------|
| `(rpc/connect url)` | Connect to a Cap'n Web server |
| `(rpc/connect url opts)` | Connect with options map |
| `(:$ client)` | Get magic proxy for making calls |
| `(rpc/call stub method & args)` | Call method on stub |
| `(rpc/close! client)` | Close client and clean up |

### Pipelining

| Function | Description |
|----------|-------------|
| `(rpc/gather & pipelines)` | Execute multiple pipelines, return vector of results |
| `(rpc/let-> bindings body)` | Pipeline-aware let with automatic batching |
| `(rpc/rmap coll f)` | Map function over remote collection (server-side) |
| `(rpc/rmap-indexed coll f)` | Map with index over remote collection |
| `(rpc/rfilter coll pred)` | Filter remote collection |
| `(rpc/rreduce coll f init)` | Reduce over remote collection |
| `(rpc/transduce coll xf f init)` | Transduce over remote collection |

### Error Handling

| Function | Description |
|----------|-------------|
| `(rpc/try-deref pipeline)` | Returns `[result nil]` or `[nil error]` |
| `(rpc/recover pipeline default)` | Return default value on error |
| `(rpc/recover-with pipeline f)` | Call f with error, return result or rethrow |

### Targets

| Function | Description |
|----------|-------------|
| `(rpc/callback f)` | Wrap function as single-method target |
| `(rpc/target method-map)` | Create target from map of method functions |
| `(rpc/export client obj)` | Export object, return stub for remote use |
| `(rpc/target-multimethod mm)` | Create target from multimethod |

### Introspection

| Function | Description |
|----------|-------------|
| `(rpc/describe stub)` | Get stub metadata |
| `(rpc/pipeline-data promise)` | Get pipeline operations as data |
| `(rpc/explain promise)` | Human-readable pipeline description |
| `(rpc/dry-run promise)` | Analyze pipeline without executing |
| `(rpc/client-info client)` | Get client status and stats |

### Specs

| Function | Description |
|----------|-------------|
| `(rpc/register-specs! client spec-map)` | Register specs for call validation |
| `(rpc/instrument-specs! client)` | Enable validation for all registered specs |
| `(rpc/with-spec-validation client & body)` | Enable validation for body |

### core.async

| Function | Description |
|----------|-------------|
| `(rpc-async/call> stub method & args)` | Call returning channel |
| `(rpc-async/gather> & pipelines)` | Execute pipelines, return channel of results |
| `(rpc-async/subscribe> stub event-name)` | Subscribe to events, return channel |
| `(rpc-async/pipeline> stub & steps)` | Build and execute pipeline, return channel |

### Manifold

| Function | Description |
|----------|-------------|
| `(rpc-m/call api method & args)` | Call returning deferred |
| `(rpc-m/stream> api event-name)` | Subscribe to events, return stream |

### ClojureScript-Specific

| Function | Description |
|----------|-------------|
| `(rpc/then pipeline f)` | Attach success handler (returns Promise) |
| `(rpc/catch pipeline f)` | Attach error handler (returns Promise) |
| `(rpc/promise pipeline)` | Convert pipeline to JS Promise |

### Testing

| Function | Description |
|----------|-------------|
| `(rpc-test/mock-stub response-map)` | Create mock stub with canned responses |
| `(rpc-test/recording-stub client)` | Create stub that records all calls |
| `(rpc-test/error type message)` | Create error response for mock |
| `(rpc-test/start-test-server handlers)` | Start in-memory test server |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [com.dotdo/capnweb](https://clojars.org/com.dotdo/capnweb) | The underlying RPC protocol |
| [do.mongo/sdk](https://clojars.org/do.mongo/sdk) | MongoDB client built on do.rpc/sdk |
| [do.kafka/sdk](https://clojars.org/do.kafka/sdk) | Kafka client built on do.rpc/sdk |
| [do.database/sdk](https://clojars.org/do.database/sdk) | Generic database client |
| [do.oauth/sdk](https://clojars.org/do.oauth/sdk) | OAuth integration for `.do` services |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Idiomatic Clojure** | Threading macros, keywords, immutable data |
| **Zero boilerplate** | No schemas, no codegen, no build step |
| **Magic when you want it** | `(-> api :$ :anything (rpc/call :method))` just works |
| **Types when you need them** | Specs, protocols, full type safety |
| **One round trip** | Pipelining by default with threading macros |
| **REPL-first** | Everything is inspectable and explorable |
| **Functional core** | Immutable results, pure transformations |
| **Async options** | core.async channels, Manifold deferreds, or blocking |

---

## License

Copyright 2024 Dot Do Inc.

Distributed under the MIT License.

---

*Built for Clojure developers who believe that data is the API, the REPL is the IDE, and threading macros are the way.*
