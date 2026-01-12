# capnweb

[![Clojars Project](https://img.shields.io/clojars/v/com.dotdo/capnweb.svg)](https://clojars.org/com.dotdo/capnweb)

**Capability-based RPC that speaks Clojure.**

```clojure
@(-> api :users (rpc/call :get 123) :profile :name)
;; => "Alice"  ; Single round trip, thanks to promise pipelining
```

Threading macros *are* the pipelining syntax. Don't deref until you need the value.

---

## Why This Library?

Cap'n Web brings **promise pipelining** to RPC - the ability to call methods on values that haven't resolved yet. In most languages, this requires special syntax or builder patterns. In Clojure, we already have it: **threading macros**.

When you write:

```clojure
(-> api :users (rpc/call :get 123) :profile :name)
```

You're not just threading data - you're building a pipeline of operations that execute in a single network round trip. The `@` at the front is the only moment anything touches the wire.

**Key insight**: Clojure's threading macros are isomorphic to promise pipelining. The language feature *is* the optimization.

| Clojure Idiom | RPC Behavior |
|---------------|--------------|
| `->` threading | Builds pipelined request |
| Keywords (`:users`) | Property access on remote objects |
| `rpc/call` | Method invocation |
| `@` / `deref` | Execute pipeline, await result |

---

## Installation

### deps.edn

```clojure
{:deps {com.dotdo/capnweb {:mvn/version "0.1.0"}}}
```

### With core.async Support

```clojure
{:deps {com.dotdo/capnweb      {:mvn/version "0.1.0"}
        org.clojure/core.async {:mvn/version "1.6.681"}}}
```

### ClojureScript (Browser/Node)

```clojure
{:deps {com.dotdo/capnweb {:mvn/version "0.1.0"}}}
```

The same API works in ClojureScript. See [ClojureScript Support](#clojurescript-support) for platform-specific details.

### Leiningen

```clojure
[com.dotdo/capnweb "0.1.0"]
```

### Babashka

```clojure
{:deps {com.dotdo/capnweb {:mvn/version "0.1.0"}}}
```

See [Babashka Support](#babashka-support) for scripting examples.

---

## Quick Start

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]))

;; Connect to a Cap'n Web server
(def session (rpc/connect "wss://api.example.com"))

;; Get the root stub - your entry point to the remote API
(def api (rpc/stub session))

;; Make calls with threading macros
@(-> api (rpc/call :greet "World"))
;; => "Hello, World!"

;; Access properties with keywords
@(-> api :users (rpc/call :get 123))
;; => {:id 123 :name "Alice" :email "alice@example.com"}

;; Chain through the result - still one round trip!
@(-> api :users (rpc/call :get 123) :profile :display-name)
;; => "Alice"

;; Clean up when done
(rpc/close! session)
```

---

## Threading Macro Pipelines

The threading macro *is* the pipelining syntax. Every step before `@` is batched into a single request.

### Property Access

Keywords access properties on stubs and promises:

```clojure
;; Navigate into nested objects
@(-> api :users :admin :permissions)

;; Chain through call results
@(-> api :database (rpc/call :query "SELECT * FROM users") :rows)
```

### Method Calls

Use `rpc/call` anywhere in the thread:

```clojure
;; Simple call
@(-> api (rpc/call :authenticate token))

;; Call on a property
@(-> api :users (rpc/call :get 123))

;; Chain calls
@(-> api
     (rpc/call :authenticate token)
     (rpc/call :get-profile)
     :display-name)
```

### Arguments

```clojure
;; Positional arguments
@(-> api (rpc/call :add 1 2 3))
;; => 6

;; Map as final argument (named parameters)
@(-> api :users (rpc/call :search {:query "alice" :limit 10}))

;; Vectors and nested data just work
@(-> api :batch (rpc/call :process [{:id 1} {:id 2}]))
```

---

## Promise Pipelining in Depth

### The Problem: Network Latency

Without pipelining, each `deref` waits for a response:

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

### Using `as->` for Non-Linear Flows

When later steps need to reference earlier values by name:

```clojure
@(as-> api $
   (rpc/call $ :authenticate token)
   (rpc/call $ :get-user-id)
   (-> api :profiles (rpc/call :get $) :avatar-url))
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

;; Compiles to a single "remap" expression in the protocol:
;; ["remap", import-id, [], [["import", -1]], [
;;   ... instructions referencing captured stubs (-1 = api)
;;   ... and the input value (0 = current element)
;; ]]
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

### Filtering

```clojure
@(-> api
     (rpc/call :list-users)
     (rpc/rfilter :active?)
     (rpc/rmap :email))
;; => ["alice@example.com" "bob@example.com"]
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

;; Dynamic recovery
@(-> api :users (rpc/call :get 123)
     (rpc/recover-with
       (fn [{:keys [type]}]
         (when (= type :rpc/not-found)
           {:name "Guest" :id 0})))
     :name)
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

### Register with Session

```clojure
(rpc/register-specs! session
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
(rpc/instrument-specs! session)

;; Or per-call
(rpc/with-spec-validation session
  @(-> api :users (rpc/call :create {:name ""})))
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

### Protocols for Complex Targets

```clojure
(defprotocol ICalculator
  (add [this a b])
  (multiply [this a b])
  (divide [this a b]))

(defrecord Calculator []
  ICalculator
  (add [_ a b] (+ a b))
  (multiply [_ a b] (* a b))
  (divide [_ a b]
    (if (zero? b)
      (throw (ex-info "Division by zero" {:a a :b b}))
      (/ a b))))

;; Export and pass to remote
(def calc-stub (rpc/export session (->Calculator)))
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

## core.async Integration

For channel-based async operations, require the async namespace:

```clojure
(require '[capnweb.async :as rpc-async]
         '[clojure.core.async :as async :refer [go go-loop <! >! chan]])
```

### Channel-Returning Calls

```clojure
(go
  (let [user (<! (rpc-async/call> api :users :get 123))]
    (println "User:" (:name user))))
```

### Parallel Calls with alts!

```clojure
(go
  (let [user-ch   (rpc-async/call> api :users :get 123)
        config-ch (rpc-async/call> api :config :get-all)
        [result ch] (async/alts! [user-ch config-ch])]
    (println "First result:" result)))
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

---

## REPL-Driven Development

The API is designed for exploration. Everything is inspectable.

### Describe Stubs

```clojure
(rpc/describe api)
;; => {:type    :stub
;;     :path    []
;;     :session #<Session wss://api.example.com>}

(rpc/describe (-> api :users))
;; => {:type    :stub
;;     :path    [:users]
;;     :session #<Session ...>}
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

### Session Introspection

```clojure
(rpc/session-info session)
;; => {:url         "wss://api.example.com"
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
```

---

## Connection Options

### WebSocket (Default)

```clojure
(def session
  (rpc/connect "wss://api.example.com"
    {:timeout-ms      30000
     :reconnect?      true
     :max-reconnects  5
     :reconnect-delay-ms 1000
     :headers         {"Authorization" "Bearer xxx"
                       "X-Client-Id"   "clojure-client"}}))
```

### HTTP Batch Transport

For environments without WebSocket support:

```clojure
(def session
  (rpc/connect "https://api.example.com/rpc"
    {:transport        :http-batch
     :batch-window-ms  10       ; Collect calls for 10ms before sending
     :max-batch-size   100}))   ; Max calls per batch
```

### Connection Events

```clojure
(rpc/on-connect session
  (fn [] (println "Connected!")))

(rpc/on-disconnect session
  (fn [reason] (println "Disconnected:" reason)))

(rpc/on-error session
  (fn [error] (println "Session error:" error)))
```

### Resource Management

```clojure
;; with-open ensures cleanup
(with-open [session (rpc/connect "wss://api.example.com")]
  @(-> (rpc/stub session) (rpc/call :greet "World")))
```

---

## ClojureScript Support

The same API works seamlessly in ClojureScript. The library auto-detects the platform and uses native WebSocket and Promise implementations.

### Browser Usage

```clojure
(ns myapp.client
  (:require [capnweb.core :as rpc]
            [cljs.core.async :refer [go <!]]
            [capnweb.async :as rpc-async]))

;; Connect using browser WebSocket
(def session (rpc/connect "wss://api.example.com"))
(def api (rpc/stub session))

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

### React Integration

```clojure
(ns myapp.hooks
  (:require [capnweb.core :as rpc]
            [reagent.core :as r]))

(defonce api (rpc/stub (rpc/connect "wss://api.example.com")))

(defn use-rpc
  "React hook for RPC calls. Returns [result loading? error]."
  [pipeline]
  (let [state (r/atom {:result nil :loading true :error nil})]
    (-> pipeline
        (rpc/then #(reset! state {:result % :loading false :error nil}))
        (rpc/catch #(reset! state {:result nil :loading false :error %})))
    [@state]))

;; Usage in component
(defn user-profile [id]
  (let [[{:keys [result loading? error]}]
        (use-rpc (-> api :users (rpc/call :get id) :profile))]
    (cond
      loading? [:div.spinner "Loading..."]
      error    [:div.error (str error)]
      :else    [:div.profile
                [:h1 (:name result)]
                [:p (:bio result)]])))
```

### Node.js Usage

```clojure
(ns myapp.server
  (:require [capnweb.core :as rpc]
            ["ws" :as WebSocket]))

;; capnweb auto-detects Node.js and uses the ws package
(def session (rpc/connect "wss://api.example.com"))
(def api (rpc/stub session))

;; Same API as browser
(-> api :users (rpc/call :list)
    (rpc/then #(println "Users:" %))
    (rpc/catch #(js/console.error "Error:" %)))
```

### Platform Differences

| Feature | JVM | Browser | Node.js |
|---------|-----|---------|---------|
| Blocking `@` / `deref` | Yes | No (use `rpc/then`) | No (use `rpc/then`) |
| core.async | Full | Full | Full |
| WebSocket | Built-in | Native | Requires `ws` package |
| `System/currentTimeMillis` | Yes | Use `js/Date.now` | Use `js/Date.now` |
| Thread pools | Yes | N/A | N/A |

### Shared Code (cljc)

Write once, run everywhere:

```clojure
;; src/myapp/api.cljc
(ns myapp.api
  (:require [capnweb.core :as rpc]
            #?(:clj  [clojure.core.async :refer [go <!]]
               :cljs [cljs.core.async :refer [go <!]])
            [capnweb.async :as rpc-async]))

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

capnweb works with Babashka for fast-starting scripts:

```clojure
#!/usr/bin/env bb

(require '[babashka.deps :as deps])
(deps/add-deps '{:deps {com.dotdo/capnweb {:mvn/version "0.1.0"}}})

(require '[capnweb.core :as rpc])

(def session (rpc/connect "wss://api.example.com"
               {:headers {"Authorization" (str "Bearer " (System/getenv "API_TOKEN"))}}))
(def api (rpc/stub session))

;; Quick scripting
(let [users @(-> api :users (rpc/call :list))]
  (doseq [u users]
    (println (:name u) "-" (:email u))))

(rpc/close! session)
```

---

## Testing and Mocking

### Mock Stubs for Unit Tests

```clojure
(ns myapp.test.api
  (:require [clojure.test :refer :all]
            [capnweb.test :as rpc-test]
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
        [api recording] (rpc-test/recording-stub real-session)]

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
        (binding [*test-api* (rpc/stub (rpc/connect (:url server)))]
          (f))
        (finally
          (rpc-test/stop-test-server server))))))
```

---

## Advanced Patterns

### Retry with Exponential Backoff

```clojure
(defn with-retry
  "Retries an RPC call with exponential backoff.
   Note: Math/pow returns double, cast to long for Thread/sleep."
  [f & {:keys [max-attempts delay-ms]
        :or {max-attempts 3 delay-ms 100}}]
  (loop [attempt 1]
    (let [[result err] (rpc/try-deref (f))]
      (cond
        (nil? err) result
        (>= attempt max-attempts)
        (throw (ex-info "Max retries exceeded"
                 {:attempts attempt} err))
        :else
        (do
          (Thread/sleep (long (* delay-ms (Math/pow 2 (dec attempt)))))
          (recur (inc attempt)))))))

(with-retry
  #(-> api :users (rpc/call :get 123))
  :max-attempts 5
  :delay-ms 200)
```

### Connection Pool (Thread-Safe with core.async)

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

     :release (fn [session]
                ;; Return connection to pool
                (async/>!! pool-ch session))

     :close   (fn []
                ;; Drain and close all connections
                (async/close! pool-ch)
                (loop []
                  (when-let [s (async/poll! pool-ch)]
                    (rpc/close! s)
                    (recur))))}))

;; Usage with automatic release
(defmacro with-pooled-session
  "Acquires a session from pool, executes body, releases back to pool."
  [pool session-sym & body]
  `(let [~session-sym ((:acquire ~pool))]
     (try
       ~@body
       (finally
         ((:release ~pool) ~session-sym)))))

;; Example
(let [pool (create-pool "wss://api.example.com" 5)]
  (with-pooled-session pool session
    @(-> (rpc/stub session) :users (rpc/call :get 123)))
  ;; Session automatically returned to pool
  ((:close pool)))
```

### Middleware Pattern

```clojure
(defn wrap-logging [call-fn]
  (fn [stub method args]
    (let [start (System/currentTimeMillis)]
      (try
        (let [result (call-fn stub method args)]
          (println "CALL" method args "->"
                   (- (System/currentTimeMillis) start) "ms")
          result)
        (catch Exception e
          (println "ERROR" method args "->" (ex-message e))
          (throw e))))))

(defn wrap-metrics [call-fn metrics-atom]
  (fn [stub method args]
    (swap! metrics-atom update :calls inc)
    (try
      (call-fn stub method args)
      (catch Exception e
        (swap! metrics-atom update :errors inc)
        (throw e)))))

;; Apply middleware
(def call-with-logging
  (wrap-logging rpc/call))

(def metrics (atom {:calls 0 :errors 0}))
(def call-with-everything
  (-> rpc/call
      (wrap-logging)
      (wrap-metrics metrics)))
```

### Component Integration

```clojure
(require '[com.stuartsierra.component :as component])

(defrecord RpcClient [url session api]
  component/Lifecycle
  (start [this]
    (let [session (rpc/connect url)]
      (assoc this
        :session session
        :api (rpc/stub session))))
  (stop [this]
    (when session
      (rpc/close! session))
    (assoc this :session nil :api nil)))

(defn new-rpc-client [url]
  (map->RpcClient {:url url}))

;; In your system
(def system
  (component/system-map
    :rpc-client (new-rpc-client "wss://api.example.com")
    :user-service (component/using
                    (new-user-service)
                    [:rpc-client])))
```

### Mount Integration

```clojure
(require '[mount.core :refer [defstate]])

(defstate rpc-session
  :start (rpc/connect (get-in config [:rpc :url])
           {:headers {"Authorization" (str "Bearer " (:api-token config))}})
  :stop (rpc/close! rpc-session))

(defstate api
  :start (rpc/stub rpc-session))

;; Usage
(mount/start)
@(-> api :users (rpc/call :get 123))
```

---

## Security Considerations

### Authentication

```clojure
;; Pass auth token in connection headers (recommended)
(def session
  (rpc/connect "wss://api.example.com"
    {:headers {"Authorization" (str "Bearer " token)}}))

;; Or authenticate after connection
(def auth-api
  (-> api (rpc/call :authenticate token)))
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
  (fn [stub method args]
    (let [safe-args (cond-> args
                      (= method :authenticate)
                      (assoc 0 "[REDACTED]"))]
      (println "CALL" method safe-args)
      (call-fn stub method args))))
```

---

## Complete Example

```clojure
(ns myapp.dashboard
  (:require [capnweb.core :as rpc]
            [clojure.spec.alpha :as s]))

;; Specs
(s/def ::user-id pos-int?)
(s/def ::user (s/keys :req-un [::id ::name ::email]))

;; Main logic
(defn fetch-dashboard [session user-id]
  (let [api (rpc/stub session)]
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
    (with-open [session (rpc/connect "wss://api.example.com"
                          {:headers {"Authorization" (str "Bearer " token)}})]
      ;; Register specs for validation
      (rpc/register-specs! session
        {[:users :get] {:args (s/cat :id ::user-id)
                        :ret  ::user}})

      (let [dashboard (fetch-dashboard session user-id)]
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
| `(rpc/stub session)` | Get root stub for making calls |
| `(rpc/call stub method & args)` | Call method on stub |
| `(rpc/close! session)` | Close session and clean up |

### Pipelining

| Function | Description |
|----------|-------------|
| `(rpc/gather & pipelines)` | Execute multiple pipelines, return vector of results |
| `(rpc/let-> bindings body)` | Pipeline-aware let with automatic batching |
| `(rpc/rmap coll f)` | Map function over remote collection (server-side) |
| `(rpc/rfilter coll pred)` | Filter remote collection |
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
| `(rpc/export session obj)` | Export object, return stub for remote use |
| `(rpc/target-multimethod mm)` | Create target from multimethod |

### Introspection

| Function | Description |
|----------|-------------|
| `(rpc/describe stub)` | Get stub metadata |
| `(rpc/pipeline-data promise)` | Get pipeline operations as data |
| `(rpc/explain promise)` | Human-readable pipeline description |
| `(rpc/dry-run promise)` | Analyze pipeline without executing |
| `(rpc/session-info session)` | Get session status and stats |

### Specs

| Function | Description |
|----------|-------------|
| `(rpc/register-specs! session spec-map)` | Register specs for call validation |
| `(rpc/instrument-specs! session)` | Enable validation for all registered specs |
| `(rpc/with-spec-validation session & body)` | Enable validation for body |

### core.async

| Function | Description |
|----------|-------------|
| `(rpc-async/call> stub method & args)` | Call returning channel |
| `(rpc-async/gather> & pipelines)` | Execute pipelines, return channel of results |
| `(rpc-async/subscribe> stub event-name)` | Subscribe to events, return channel |
| `(rpc-async/pipeline> stub & steps)` | Build and execute pipeline, return channel |

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
| `(rpc-test/recording-stub session)` | Create stub that records all calls |
| `(rpc-test/error type message)` | Create error response for mock |
| `(rpc-test/start-test-server handlers)` | Start in-memory test server |

---

## License

Copyright 2024 Dot Do Inc.

Distributed under the MIT License.

---

*Built for Clojure developers who believe that data is the API, the REPL is the IDE, and threading macros are just right.*
