# Cap'n Web Clojure Client API

**Package:** `com.dotdo/capnweb`

A Clojure client for Cap'n Web RPC that feels like Clojure, not like an RPC library with Clojure bindings.

---

## Design Philosophy

```clojure
;; This should feel natural to any Clojure developer:
@(-> api :users (rpc/call :get 123) :profile :name)
```

Three principles guide this API:

1. **Threading macros are the syntax** - `->` and `->>` express pipelines naturally
2. **Pipelining is invisible** - Just don't `deref` until you need the value
3. **Data is always accessible** - Inspect, serialize, and spec any operation

---

## Quick Start

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]))

;; Connect to a Cap'n Web server
(def session (rpc/connect "wss://api.example.com"))
(def api (rpc/stub session))

;; Make a call - simple as that
@(rpc/call api :greet "World")
;; => "Hello, World!"

;; Pipeline through properties and methods
@(-> api :users (rpc/call :get 123) :profile :name)
;; => "Alice"

;; Clean up
(rpc/close! session)
```

---

## Connecting

### Basic Connection

```clojure
(def session (rpc/connect "wss://api.example.com"))
```

### With Options

```clojure
(def session
  (rpc/connect "wss://api.example.com"
    {:timeout-ms     30000
     :reconnect?     true
     :max-reconnects 5
     :headers        {"Authorization" "Bearer xxx"}}))
```

### HTTP Batch Transport

```clojure
(def session
  (rpc/connect "https://api.example.com/rpc"
    {:transport :http-batch
     :batch-window-ms 10}))
```

### Resource Management

```clojure
;; with-open ensures cleanup
(with-open [session (rpc/connect "wss://api.example.com")]
  @(-> (rpc/stub session)
       (rpc/call :greet "World")))
```

---

## Making Calls

### The Threading Macro Way

This is the primary API. It should feel like you're threading data through transformations, because you are.

```clojure
(def api (rpc/stub session))

;; Property access with keywords
@(-> api :users)
;; => <RpcStub :users>

;; Method calls with rpc/call
@(-> api :users (rpc/call :get 123))
;; => {:id 123 :name "Alice" :email "alice@example.com"}

;; Chain them together
@(-> api
     :users
     (rpc/call :get 123)
     :profile
     :display-name)
;; => "Alice"
```

### Arguments

```clojure
;; Positional arguments
@(-> api (rpc/call :add 1 2))
;; => 3

;; Map arguments (Clojure idiom for named parameters)
@(-> api :users (rpc/call :create {:name "Bob" :email "bob@example.com"}))
;; => {:id 456 :name "Bob" :email "bob@example.com"}

;; Mixed - map is always last
@(-> api :search (rpc/call :query "clojure" {:limit 10 :offset 0}))
```

### Alternative: Direct Call

For simple one-off calls without threading:

```clojure
@(rpc/call api :greet "World")
;; => "Hello, World!"

@(rpc/call api :users :get 123)
;; => {:id 123 ...}
```

---

## Pipelining

The magic of Cap'n Web is promise pipelining - calling methods on values that haven't resolved yet. In this API, pipelining happens automatically when you don't `deref`.

### Without Pipelining (3 round trips)

```clojure
(let [user    @(-> api :users (rpc/call :get 123))
      profile @(-> user :profile)
      name    @(-> profile :name)]
  name)
```

### With Pipelining (1 round trip)

```clojure
@(-> api
     :users
     (rpc/call :get 123)
     :profile
     :name)
```

The difference is simply when you `deref`. Every step before the `@` is pipelined into a single network request.

### Forking Pipelines

Build multiple pipelines from a common stem:

```clojure
(let [auth    (-> api (rpc/call :authenticate token))
      profile (-> auth (rpc/call :get-profile))
      notifs  (-> auth (rpc/call :get-notifications))]
  ;; Both fork from auth - still just 1 round trip
  {:profile       @profile
   :notifications @notifs})
```

### Gathering Multiple Pipelines

When you have independent pipelines, gather them:

```clojure
@(rpc/gather
   (-> api :users (rpc/call :get 1))
   (-> api :users (rpc/call :get 2))
   (-> api :users (rpc/call :get 3)))
;; => [{:id 1 ...} {:id 2 ...} {:id 3 ...}]
```

### The `rpc/let->` Macro

For complex pipelines with named intermediate values:

```clojure
@(rpc/let-> [user    (-> api :users (rpc/call :get 123))
             profile (-> user :profile)
             posts   (-> user :posts (rpc/call :recent 10))]
   {:name  (:display-name profile)
    :posts posts})
```

### Using `as->` for Non-Linear Pipelines

When you need to reference earlier values:

```clojure
@(as-> api $
   (rpc/call $ :authenticate token)
   (rpc/call $ :get-user-id)
   (-> api :profiles (rpc/call :get $) :display-name))
```

---

## Remote Collections

### Mapping Over Remote Lists

```clojure
;; Get all user IDs, then fetch each profile - single round trip!
@(-> api
     (rpc/call :list-user-ids)
     (rpc/rmap #(-> api :profiles (rpc/call :get %))))
;; => [{:id 1 :name "Alice" ...} {:id 2 :name "Bob" ...}]
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

Clojure's transducers compose naturally:

```clojure
@(-> api
     (rpc/call :list-users)
     (rpc/transduce
       (comp
         (filter :active?)
         (map :email)
         (take 10))
       conj []))
```

---

## Error Handling

### Exceptions (Clojure Style)

```clojure
(try
  @(-> api :users (rpc/call :get 999))
  (catch clojure.lang.ExceptionInfo e
    (case (-> e ex-data :type)
      :rpc/not-found     {:error "User not found"}
      :rpc/unauthorized  {:error "Auth required"}
      :rpc/network-error {:error "Connection lost"}
      (throw e))))
```

### Error Data

All RPC errors are `ExceptionInfo` with structured `ex-data`:

```clojure
(ex-data e)
;; => {:type     :rpc/not-found
;;     :message  "User 999 not found"
;;     :path     [:users :get]
;;     :args     [999]
;;     :remote   {:type "NotFoundError" :code 404}}
```

### Result Tuples

For monadic style:

```clojure
(let [[ok err] (rpc/try-deref (-> api :users (rpc/call :get 123)))]
  (if err
    (println "Error:" (:message err))
    (println "User:" (:name ok))))
```

### Pipeline Recovery

```clojure
@(-> api
     :users
     (rpc/call :get 123)
     (rpc/recover {:name "Unknown" :id 0})
     :name)
;; Returns "Unknown" if the call fails
```

### Conditional Recovery

```clojure
@(-> api
     :users
     (rpc/call :get 123)
     (rpc/recover-with
       (fn [err]
         (when (= :rpc/not-found (:type err))
           {:name "Guest" :id 0}))))
```

---

## Exposing Local Objects

Pass Clojure functions and objects to the remote server.

### Functions as Callbacks

```clojure
(def handler (rpc/callback (fn [event] (println "Event:" event))))

@(-> api (rpc/call :subscribe "events" handler))
;; Remote will call handler when events occur
```

### Maps as Targets

```clojure
(def listener
  (rpc/target
    {:on-message (fn [msg] (println "Got:" msg))
     :on-error   (fn [err] (println "Error:" err))
     :dispose    (fn [] (println "Listener disposed"))}))

@(-> api (rpc/call :register-listener listener))
```

### Records and Protocols

```clojure
(defprotocol ICalculator
  (add [this a b])
  (multiply [this a b]))

(defrecord Calculator []
  ICalculator
  (add [_ a b] (+ a b))
  (multiply [_ a b] (* a b)))

(def calc-stub (rpc/export session (->Calculator)))

@(-> api (rpc/call :use-calculator calc-stub))
```

---

## REPL-Driven Development

The API is designed for exploration at the REPL.

### Inspecting Stubs

```clojure
(rpc/describe api)
;; => {:type :stub
;;     :path []
;;     :session #<Session wss://api.example.com>}

(rpc/describe (-> api :users))
;; => {:type :stub
;;     :path [:users]
;;     :session #<Session ...>}
```

### Inspecting Pipelines

```clojure
(def p (-> api :users (rpc/call :get 123) :profile :name))

(rpc/pipeline-data p)
;; => [{:op :get :key :users}
;;     {:op :call :method :get :args [123]}
;;     {:op :get :key :profile}
;;     {:op :get :key :name}]

(rpc/explain p)
;; => "api -> :users -> call(:get 123) -> :profile -> :name"
```

### Testing Pipelines Without Execution

```clojure
(rpc/dry-run p)
;; => {:operations 4
;;     :estimated-round-trips 1
;;     :pipeline-depth 4}
```

### Session Introspection

```clojure
(rpc/session-info session)
;; => {:url "wss://api.example.com"
;;     :status :connected
;;     :uptime-ms 45230
;;     :pending-calls 0
;;     :exports 2
;;     :imports 5}
```

---

## Data as API

Everything is data underneath. When you need it, access it.

### Calls as Data

```clojure
(def call-data
  {:op   :call
   :path [:users :get]
   :args [123]})

@(rpc/execute session call-data)
;; => {:id 123 :name "Alice" ...}
```

### Pipelines as Data

```clojure
(def pipeline-data
  [{:op :get :key :users}
   {:op :call :method :get :args [123]}
   {:op :get :key :profile}
   {:op :get :key :name}])

@(rpc/execute session pipeline-data)
;; => "Alice"
```

### Serializable Pipelines

```clojure
;; Save a pipeline
(spit "query.edn" (pr-str (rpc/pipeline-data p)))

;; Load and execute
(def loaded (read-string (slurp "query.edn")))
@(rpc/execute session loaded)
```

---

## Spec Integration

Validate calls with clojure.spec.

### Define Specs

```clojure
(require '[clojure.spec.alpha :as s])

(s/def ::user-id pos-int?)
(s/def ::user-name (s/and string? #(< 0 (count %) 100)))
(s/def ::user-email (s/and string? #(re-matches #".+@.+\..+" %)))

(s/def ::user
  (s/keys :req-un [::user-id ::user-name]
          :opt-un [::user-email]))
```

### Register with Session

```clojure
(rpc/register-specs! session
  {[:users :get]    {:args (s/cat :id ::user-id)
                     :ret  ::user}
   [:users :create] {:args (s/cat :data (s/keys :req-un [::user-name]))
                     :ret  ::user}})
```

### Validation in Action

```clojure
@(-> api :users (rpc/call :get "not-a-number"))
;; => ExceptionInfo: Spec validation failed for [:users :get]
;;    args: "not-a-number" fails spec: ::user-id
```

---

## core.async Integration

Optional module for channel-based async.

```clojure
(require '[capnweb.async :as rpc-async]
         '[clojure.core.async :as async :refer [go <! >!]])
```

### Channel-Returning Calls

```clojure
(go
  (let [user (<! (rpc-async/call> api :users :get 123))]
    (println "User:" (:name user))))
```

### Timeout with alts!

```clojure
(go
  (let [result-ch  (rpc-async/call> api :slow-operation)
        timeout-ch (async/timeout 5000)
        [result ch] (async/alts! [result-ch timeout-ch])]
    (if (= ch timeout-ch)
      (println "Timed out!")
      (println "Result:" result))))
```

### Streaming Results

```clojure
(go
  (let [events-ch (rpc-async/subscribe> api :events)]
    (loop []
      (when-let [event (<! events-ch)]
        (println "Event:" event)
        (recur)))))
```

---

## Complete Example

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]))

(defn fetch-user-dashboard [session user-id]
  (let [api (rpc/stub session)]
    @(rpc/let-> [user    (-> api :users (rpc/call :get user-id))
                 profile (-> user :profile)
                 posts   (-> user :posts (rpc/call :recent 5))
                 notifs  (-> user :notifications (rpc/call :unread))]
       {:user         {:id   (:id user)
                       :name (:display-name profile)
                       :bio  (:bio profile)}
        :recent-posts posts
        :unread-count (count notifs)})))

(defn -main []
  (with-open [session (rpc/connect "wss://api.example.com"
                        {:headers {"Authorization" (str "Bearer " (System/getenv "API_TOKEN"))}})]
    (let [dashboard (fetch-user-dashboard session 123)]
      (println "Welcome," (get-in dashboard [:user :name]))
      (println "You have" (:unread-count dashboard) "unread notifications"))))
```

---

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `(rpc/connect url)` | Connect to a Cap'n Web server |
| `(rpc/connect url opts)` | Connect with options |
| `(rpc/stub session)` | Get the root stub for making calls |
| `(rpc/call stub method & args)` | Call a method on a stub |
| `(rpc/close! session)` | Close a session |

### Pipelining

| Function | Description |
|----------|-------------|
| `(rpc/gather & pipelines)` | Execute multiple pipelines in parallel |
| `(rpc/let-> bindings body)` | Bind pipeline results with pipelining |
| `(rpc/rmap pipeline f)` | Map function over remote collection |
| `(rpc/rfilter pipeline pred)` | Filter remote collection |
| `(rpc/transduce pipeline xf f init)` | Transduce over remote collection |

### Error Handling

| Function | Description |
|----------|-------------|
| `(rpc/try-deref pipeline)` | Returns `[result nil]` or `[nil error]` |
| `(rpc/recover pipeline default)` | Return default on error |
| `(rpc/recover-with pipeline f)` | Call f with error, return result or rethrow |

### Local Targets

| Function | Description |
|----------|-------------|
| `(rpc/callback f)` | Wrap function as RPC callback |
| `(rpc/target method-map)` | Create target from map of methods |
| `(rpc/export session obj)` | Export object to remote |

### Introspection

| Function | Description |
|----------|-------------|
| `(rpc/describe stub)` | Get stub metadata |
| `(rpc/pipeline-data pipeline)` | Get pipeline as data |
| `(rpc/explain pipeline)` | Human-readable pipeline description |
| `(rpc/session-info session)` | Get session status |

### Data Execution

| Function | Description |
|----------|-------------|
| `(rpc/execute session data)` | Execute call/pipeline data |
| `(rpc/dry-run pipeline)` | Analyze without executing |

### Specs

| Function | Description |
|----------|-------------|
| `(rpc/register-specs! session spec-map)` | Register specs for validation |
| `(rpc/with-spec session spec-map body)` | Temporarily enable specs |

---

## Installation

### deps.edn

```clojure
{:deps {com.dotdo/capnweb {:mvn/version "0.1.0"}}}
```

### With core.async

```clojure
{:deps {com.dotdo/capnweb       {:mvn/version "0.1.0"}
        org.clojure/core.async  {:mvn/version "1.6.681"}}}
```

### Leiningen

```clojure
[com.dotdo/capnweb "0.1.0"]
```

---

*Built for Clojure developers who believe in data, simplicity, and the REPL.*
