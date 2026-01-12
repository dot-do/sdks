# Cap'n Web Clojure Client: Syntax Exploration

This document explores four divergent approaches to designing an idiomatic Clojure client for Cap'n Web RPC (package: `com.dotdo/capnweb` on Clojars). Each approach leverages different aspects of Clojure's unique philosophy and features.

---

## Background: What Makes Clojure Unique

Clojure brings distinctive features that fundamentally shape API design:

- **Homoiconicity**: Code is data; macros can transform API syntax at compile time
- **Threading Macros**: `->`, `->>`, `as->`, `cond->` enable elegant data flow pipelines
- **core.async**: CSP-style channels for asynchronous programming without callbacks
- **Persistent Data Structures**: Immutable by default; maps as the universal data structure
- **Protocols & Multimethods**: Polymorphism through data rather than inheritance
- **REPL-Driven Development**: Interactive exploration is paramount; APIs must be REPL-friendly
- **Data > Functions > Macros**: Prefer plain data, then functions, then macros
- **Spec & Schema**: Data validation and documentation through specifications

The challenge: Cap'n Web's pipelining model (calling methods on unresolved promises) maps naturally to Clojure's threading macros, but we must balance macro magic with data transparency.

---

## Approach 1: Threading Macro Native (The "Pedestal" Way)

**Inspiration**: Pedestal interceptors, Reitit routing, transducers

This approach treats RPC pipelines as data transformations, using Clojure's threading macros as the primary syntax. The key insight: an RPC pipeline *is* a thread of data transformations.

### Philosophy

Threading macros already express "do this, then this, then this" - which is exactly what pipelining represents. Make the threading macro the core API; let pipelining emerge naturally.

### Connection/Session Creation

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]
            [capnweb.transport :as transport]))

;; Connect with WebSocket transport
(def session
  (rpc/connect "wss://api.example.com"))

;; With options map (data-driven configuration)
(def session
  (rpc/connect "wss://api.example.com"
               {:timeout-ms 30000
                :reconnect? true
                :headers {"Authorization" "Bearer xxx"}}))

;; HTTP batch transport
(def batch-session
  (rpc/connect "https://api.example.com"
               {:transport :http-batch}))

;; Multiple transports
(def session
  (rpc/connect {:transport (transport/websocket "wss://api.example.com")}))

;; Session lifecycle with `with-open`
(with-open [session (rpc/connect "wss://api.example.com")]
  (-> session
      (rpc/stub)
      (rpc/call :greet "World")
      (deref)))
```

### Making RPC Calls

```clojure
(require '[capnweb.core :as rpc])

(def api (rpc/stub session))

;; Simple call - returns a promise (deref to await)
@(rpc/call api :greet "World")
;; => "Hello, World!"

;; Threading macro style - this is the primary API
@(-> api
     (rpc/call :users :get 123))
;; => {:id 123 :name "Alice" :email "alice@example.com"}

;; Property access via keywords
@(-> api :users (rpc/call :get 123) :profile :name)
;; => "Alice"

;; Method calls with keyword-first syntax
@(-> api
     (rpc/call :authenticate token)
     (rpc/call :get-profile)
     :display-name)

;; Keyword arguments as maps (Clojure idiom)
@(-> api
     :users
     (rpc/call :create {:name "Bob"
                        :email "bob@example.com"
                        :roles [:admin :user]}))
```

### Pipelining Syntax

The threading macro *is* the pipelining syntax. Not awaiting (not using `@`/`deref`) until the end causes all operations to be batched.

```clojure
;; WITHOUT pipelining (3 round trips)
(let [user @(-> api :users (rpc/call :get 123))
      profile @(-> user :profile)
      name @(-> profile :name)]
  name)

;; WITH pipelining (1 round trip!)
;; Simply don't deref until the very end
@(-> api
     :users
     (rpc/call :get 123)
     :profile
     :name)

;; Multiple values from same pipeline stem
(let [auth (-> api (rpc/call :authenticate token))
      ;; Both pipeline through `auth`
      profile (-> auth (rpc/call :get-profile))
      notifs (-> auth (rpc/call :get-notifications))]
  ;; Deref triggers batch execution
  {:profile @profile
   :notifications @notifs})

;; Using `rpc/gather` for parallel pipelines
(let [[profile notifs]
      @(rpc/gather
         (-> api (rpc/call :authenticate token) (rpc/call :get-profile))
         (-> api (rpc/call :authenticate token) (rpc/call :get-notifications)))]
  {:profile profile :notifications notifs})

;; as-> for complex pipelines where you need to reference intermediate values
@(as-> api $
   (rpc/call $ :authenticate token)
   (rpc/call $ :get-user-id)
   (-> api :profiles (rpc/call :get $) :display-name))
```

### The `map` Operation

```clojure
;; Map over remote collection - single round trip!
@(-> api
     (rpc/call :list-user-ids)
     (rpc/rmap (fn [id]
                 {:id id
                  :profile (-> api :profiles (rpc/call :get id))})))

;; Using partial for cleaner syntax
@(-> api
     (rpc/call :list-user-ids)
     (rpc/rmap #(-> api :users (rpc/call :get %))))

;; Filter + map
@(->> api
      (rpc/call :list-users)
      (rpc/rfilter #(-> % :active?))
      (rpc/rmap #(-> % :email)))
```

### Error Handling

```clojure
(require '[capnweb.error :as err])

;; Exceptions (Clojure style)
(try
  @(-> api :users (rpc/call :get 999))
  (catch clojure.lang.ExceptionInfo e
    (let [data (ex-data e)]
      (case (:type data)
        :rpc/not-found (println "User not found")
        :rpc/unauthorized (println "Auth required")
        :rpc/transport-error (println "Connection lost")
        (throw e)))))

;; Or use error monad style (returns [:ok value] or [:error err])
(let [result (-> api :users (rpc/call :get 123) rpc/try-deref)]
  (match result
    [:ok user] (println "Found:" (:name user))
    [:error e] (println "Error:" (:message e))))

;; Pipeline with error recovery
@(-> api
     :users
     (rpc/call :get 123)
     (rpc/recover (fn [e] {:name "Unknown"}))
     :name)

;; Session error callbacks
(rpc/on-error session
  (fn [error]
    (println "Session error:" error)))
```

### Exposing Local Objects as RPC Targets

```clojure
(require '[capnweb.target :as target])

;; Define a target with defrecord + protocol
(defprotocol ICalculator
  (add [this a b])
  (multiply [this a b]))

(defrecord Calculator []
  ICalculator
  (add [_ a b] (+ a b))
  (multiply [_ a b] (* a b))

  target/IRpcTarget
  (dispose [this] (println "Calculator disposed")))

;; Register target with session
(def calc (->Calculator))
(def calc-stub (rpc/export session calc))

;; Pass to remote
@(-> api (rpc/call :register-calculator calc-stub))

;; Simpler: maps as targets (data-driven)
(def handler
  (target/from-map
    {:on-message (fn [msg] (println "Got:" msg))
     :on-error (fn [err] (println "Error:" err))
     :dispose (fn [] (println "Handler disposed"))}))

@(-> api (rpc/call :subscribe handler))

;; Functions as single-method targets
(def callback (target/from-fn (fn [event] (println "Event:" event))))
@(-> api (rpc/call :on-event callback))
```

### Pros & Cons

**Pros:**
- Threading macros are core Clojure; no new syntax to learn
- Pipelining is invisible - just don't deref
- REPL-friendly: each step returns a value you can inspect
- Composes with existing Clojure tools (transducers, spec, etc.)

**Cons:**
- Keywords as method names loses some discoverability
- Error handling with try/catch can be verbose
- No compile-time type checking (but that's Clojure)

---

## Approach 2: core.async Channels (The "CSP" Way)

**Inspiration**: core.async, manifold, aleph

This approach embraces Clojure's core.async for all asynchronous operations. RPC results are delivered through channels, enabling sophisticated flow control with `go` blocks.

### Philosophy

Channels are Clojure's answer to async complexity. They compose, they're first-class, and they work seamlessly with `go` blocks. Make channels the native return type.

### Connection/Session Creation

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]
            [capnweb.async :as rpc-async]
            [clojure.core.async :as async :refer [go <! >! chan]]))

;; Connect returns a channel that delivers the session
(go
  (let [session (<! (rpc/connect-async "wss://api.example.com"))]
    (when session
      ;; Use session
      )))

;; Or use blocking connect in a regular thread
(def session
  (async/<!! (rpc/connect-async "wss://api.example.com")))

;; Session with reconnection channel
(let [{:keys [session events]} (rpc/connect-with-events "wss://api.example.com")]
  (go-loop []
    (when-let [event (<! events)]
      (case (:type event)
        :connected (println "Connected!")
        :disconnected (println "Lost connection:" (:error event))
        :reconnecting (println "Reconnecting..."))
      (recur))))
```

### Making RPC Calls

```clojure
(def api (rpc/stub session))

;; Every call returns a channel
(go
  (let [greeting (<! (rpc/call> api :greet "World"))]
    (println greeting)))
;; => "Hello, World!"

;; Chain with go blocks
(go
  (let [user (<! (rpc/call> api :users :get 123))
        profile (<! (rpc/call> user :profile))
        name (<! (rpc/call> profile :name))]
    (println "Name:" name)))

;; Using the |> macro for cleaner async chaining
(go
  (|> api
      (rpc/call> :users :get 123)
      (rpc/call> :profile)
      (rpc/call> :name)
      println))

;; Multiple parallel calls with `async/merge` or `alts!`
(go
  (let [users-ch (rpc/call> api :list-users)
        config-ch (rpc/call> api :get-config)
        [users config] (<! (async/map vector [users-ch config-ch]))]
    {:users users :config config}))
```

### Pipelining Syntax

Pipelining builds a "lazy channel" that only executes when taken from.

```clojure
;; Build pipeline without executing
(def name-pipeline
  (rpc/pipeline api
    [:users :get 123]
    [:profile]
    [:name]))

;; Execute by taking from it
(go
  (println "Name:" (<! name-pipeline)))

;; Pipeline builder DSL
(go
  (let [name (<! (-> api
                     (rpc/|> :users :get 123)  ; Returns pipeline, not channel
                     (rpc/|> :profile)
                     (rpc/|> :name)
                     (rpc/execute!)))]         ; Execute returns channel
    (println name)))

;; Fork pipelines from common stem
(go
  (let [auth (rpc/|> api :authenticate token)
        profile-ch (rpc/execute! (rpc/|> auth :get-profile))
        notifs-ch (rpc/execute! (rpc/|> auth :get-notifications))
        [profile notifs] (<! (async/map vector [profile-ch notifs-ch]))]
    {:profile profile :notifications notifs}))

;; The magic: `rpc/batch!` groups pipelines into one request
(go
  (let [[profile notifs]
        (<! (rpc/batch!
              (rpc/|> api :authenticate token :get-profile)
              (rpc/|> api :authenticate token :get-notifications)))]
    {:profile profile :notifications notifs}))
```

### The `map` Operation

```clojure
;; Map returns a channel of mapped results
(go
  (let [profiles (<! (rpc/map>
                       (rpc/call> api :list-user-ids)
                       (fn [id] (rpc/call> api :profiles :get id))))]
    (println "Profiles:" profiles)))

;; With transducers
(go
  (let [active-emails
        (<! (rpc/transduce>
              (rpc/call> api :list-users)
              (comp
                (filter :active?)
                (map :email))
              conj
              []))]
    (println "Emails:" active-emails)))

;; Parallel map with concurrency limit
(go
  (let [profiles (<! (rpc/pmap>
                       (rpc/call> api :list-user-ids)
                       #(rpc/call> api :profiles :get %)
                       {:concurrency 10}))]
    (println profiles)))
```

### Error Handling

```clojure
;; Channels can carry errors (wrapped in ex-info)
(go
  (let [result (<! (rpc/call> api :risky-operation))]
    (if (instance? Throwable result)
      (println "Error:" (ex-message result))
      (println "Success:" result))))

;; Use `rpc/try>` for [result error] tuples
(go
  (let [[result error] (<! (rpc/try> (rpc/call> api :risky-operation)))]
    (if error
      (println "Error:" (:message error))
      (println "Success:" result))))

;; Error channel pattern
(let [results (chan)
      errors (chan)]
  (rpc/call-with-errors api :risky-operation
                         {:on-result #(>!! results %)
                          :on-error #(>!! errors %)})
  (async/alts!! [results errors]))

;; Timeout with alts!
(go
  (let [timeout-ch (async/timeout 5000)
        result-ch (rpc/call> api :slow-operation)
        [result ch] (async/alts! [result-ch timeout-ch])]
    (if (= ch timeout-ch)
      (println "Timed out!")
      (println "Result:" result))))
```

### Exposing Local Objects as RPC Targets

```clojure
(require '[capnweb.target :as target])

;; Channel-based target: receives calls on a channel
(let [calls (chan)]
  (def handler (target/channel-target calls))

  ;; Process calls in a go block
  (go-loop []
    (when-let [{:keys [method args reply-ch]} (<! calls)]
      (case method
        :on-message (>! reply-ch (println "Got:" (first args)))
        :on-error (>! reply-ch (println "Error:" (first args))))
      (recur)))

  ;; Register with remote
  (rpc/call> api :subscribe handler))

;; Multimethod-based target
(defmulti handle-call :method)

(defmethod handle-call :on-message [{:keys [args]}]
  (println "Message:" (first args)))

(defmethod handle-call :on-error [{:keys [args]}]
  (println "Error:" (first args)))

(def handler (target/multi-target handle-call))
@(rpc/call> api :subscribe handler)
```

### Pros & Cons

**Pros:**
- Full power of core.async (select, timeout, buffering)
- Backpressure is built-in
- Composes with existing async code
- Natural for event streams and subscriptions

**Cons:**
- core.async learning curve
- `go` blocks everywhere can be noisy
- Harder to debug than synchronous code
- Potential for deadlocks if not careful

---

## Approach 3: Data-Oriented with Specs (The "Datomic" Way)

**Inspiration**: Datomic, DataScript, malli, spec

This approach treats RPC calls as data. Requests are maps, responses are maps, pipelines are vectors of maps. Everything is inspectable, serializable, and spec-able.

### Philosophy

"Data > Functions > Macros." RPC calls should be plain Clojure data that can be built, inspected, transformed, and validated before execution.

### Connection/Session Creation

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]
            [capnweb.spec :as rpc-spec]
            [clojure.spec.alpha :as s]))

;; Session configuration is data
(def config
  {:url "wss://api.example.com"
   :timeout-ms 30000
   :transport :websocket
   :headers {"Authorization" "Bearer xxx"}})

;; Connect with config map
(def session (rpc/connect config))

;; Session is also just data you can inspect
(rpc/session-info session)
;; => {:url "wss://api.example.com"
;;     :status :connected
;;     :imports {...}
;;     :exports {...}}
```

### Making RPC Calls

```clojure
;; Calls are data - build them, inspect them, then execute
(def get-user-call
  {:op :call
   :path [:users :get]
   :args [123]})

;; Inspect it
get-user-call
;; => {:op :call, :path [:users :get], :args [123]}

;; Execute it
@(rpc/execute session get-user-call)
;; => {:id 123, :name "Alice", :email "alice@example.com"}

;; Helper to build calls (returns data, not a promise)
(rpc/call-data :users :get 123)
;; => {:op :call, :path [:users :get], :args [123]}

;; Property access
(rpc/prop-data :profile :name)
;; => {:op :get, :path [:profile :name]}

;; Build and execute in one step
@(rpc/exec session [:users :get 123])
```

### Pipelining Syntax

Pipelines are vectors of operations - pure data!

```clojure
;; Pipeline is a vector of operations
(def user-name-pipeline
  [{:op :call, :path [:users :get], :args [123]}
   {:op :get, :path [:profile]}
   {:op :get, :path [:name]}])

;; Execute pipeline
@(rpc/execute session user-name-pipeline)
;; => "Alice"

;; Build pipelines with helpers
(def pipeline
  (rpc/pipeline
    (rpc/call-data :authenticate token)
    (rpc/call-data :get-profile)
    (rpc/prop-data :display-name)))

;; Pipelines can be stored, transmitted, analyzed
(pr-str pipeline)
;; => "[{:op :call, :path [:authenticate], :args [\"token\"]} ...]"

;; Fork pipelines
(def auth-pipeline
  [(rpc/call-data :authenticate token)])

(def profile-pipeline
  (into auth-pipeline [(rpc/call-data :get-profile)]))

(def notifs-pipeline
  (into auth-pipeline [(rpc/call-data :get-notifications)]))

;; Execute multiple pipelines in batch
@(rpc/batch session
   {:profile profile-pipeline
    :notifs notifs-pipeline})
;; => {:profile {...}, :notifs [...]}

;; The `q` macro for terser pipeline syntax
@(rpc/q session
   [[:authenticate token]
    [:get-profile]
    :display-name])
```

### The `map` Operation

```clojure
;; Map is just another operation in the pipeline
(def enriched-users-pipeline
  [{:op :call, :path [:list-user-ids]}
   {:op :map
    :mapper [{:op :call, :path [:profiles :get], :args [:$input]}]}])

;; With helper
(def pipeline
  (rpc/pipeline
    (rpc/call-data :list-user-ids)
    (rpc/map-data
      (fn [id]
        {:id id
         :profile (rpc/call-data :profiles :get id)}))))

@(rpc/execute session pipeline)
;; => [{:id 1, :profile {...}} {:id 2, :profile {...}} ...]

;; Transducer-style (data!)
(def pipeline
  [{:op :call, :path [:list-users]}
   {:op :filter, :pred {:op :get, :path [:active?]}}
   {:op :map, :mapper {:op :get, :path [:email]}}])
```

### Error Handling

```clojure
(require '[capnweb.spec :as rpc-spec])

;; Errors are data too
(try
  @(rpc/execute session [{:op :call, :path [:bad-method]}])
  (catch clojure.lang.ExceptionInfo e
    (ex-data e)))
;; => {:type :rpc/method-not-found
;;     :path [:bad-method]
;;     :remote-type "TypeError"
;;     :message "bad-method is not a function"}

;; Validate pipeline before execution
(s/valid? ::rpc-spec/pipeline user-name-pipeline)
;; => true

(s/explain ::rpc-spec/pipeline [{:op :invalid}])
;; Spec explanation of what's wrong

;; Error recovery is data
(def pipeline-with-recovery
  [{:op :call, :path [:risky-operation]}
   {:op :recover
    :on-error {:op :const, :value {:status "failed"}}}])

;; Result type as data
@(rpc/execute-safe session pipeline)
;; => {:ok {:name "Alice"}}
;; or
;; => {:error {:type :rpc/timeout, :message "..."}}
```

### Exposing Local Objects as RPC Targets

```clojure
(require '[capnweb.target :as target])

;; Target is a map of method implementations
(def calculator-target
  {:add (fn [a b] (+ a b))
   :multiply (fn [a b] (* a b))
   :divide (fn [a b]
             (if (zero? b)
               (throw (ex-info "Division by zero" {:a a :b b}))
               (/ a b)))
   :dispose (fn [] (println "Calculator disposed"))})

(def calc-stub (rpc/export session calculator-target))

;; With spec validation
(s/def ::add-args (s/cat :a number? :b number?))
(s/def ::calculator-target
  (s/keys :req-un [::add ::multiply]))

(def validated-target
  (target/with-spec calculator-target
    {:add ::add-args
     :multiply ::add-args}))

;; Multimethod target
(defmulti calculator-dispatch :method)
(defmethod calculator-dispatch :add [{:keys [args]}] (apply + args))
(defmethod calculator-dispatch :multiply [{:keys [args]}] (apply * args))

(def calc-stub (rpc/export session (target/from-multimethod calculator-dispatch)))
```

### Specs for Full API

```clojure
(require '[clojure.spec.alpha :as s])

;; Define your API schema as specs
(s/def ::user-id pos-int?)
(s/def ::user-name string?)
(s/def ::user-email (s/and string? #(re-matches #".+@.+\..+" %)))

(s/def ::user
  (s/keys :req-un [::user-id ::user-name]
          :opt-un [::user-email]))

(s/def ::get-user-args (s/cat :id ::user-id))
(s/def ::get-user-ret ::user)

;; Register specs with session for validation
(rpc/register-spec! session
  {:users/get {:args ::get-user-args
               :ret ::get-user-ret}})

;; Calls are now validated
@(rpc/exec session [:users :get "not-a-number"])
;; => ExceptionInfo: Invalid args for :users/get
```

### Pros & Cons

**Pros:**
- Everything is inspectable data
- Pipelines can be stored, transmitted, analyzed
- Full spec integration for validation
- Easy to test (just check data)
- Tool-friendly (data viewers, debuggers)

**Cons:**
- More verbose for simple calls
- Less "natural" syntax
- Requires discipline to use helpers
- May feel less Clojure-y to some

---

## Approach 4: Protocol-Based with Reified Stubs (The "Component" Way)

**Inspiration**: Component, Integrant, Mount, Ring

This approach uses Clojure protocols to define strongly-typed interfaces to remote services. Stubs are reified objects implementing these protocols.

### Philosophy

Protocols provide clear contracts. Remote services should implement known protocols, enabling polymorphism, testing with mocks, and clear API boundaries.

### Connection/Session Creation

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]
            [capnweb.protocols :as proto]))

;; Session implements Lifecycle protocol
(defprotocol ISession
  (stub [this])
  (close! [this]))

(def session
  (rpc/connect "wss://api.example.com"))

;; Session as a Component
(defrecord RpcSession [url conn stub-cache]
  component/Lifecycle
  (start [this]
    (assoc this :conn (rpc/connect! url)))
  (stop [this]
    (rpc/close! conn)
    (assoc this :conn nil)))

;; With Integrant
(defmethod ig/init-key :rpc/session [_ {:keys [url]}]
  (rpc/connect url))

(defmethod ig/halt-key! :rpc/session [_ session]
  (rpc/close! session))
```

### Defining Remote Interfaces

```clojure
(require '[capnweb.protocols :as proto])

;; Define protocols for remote services
(defprotocol IUserService
  (get-user [this id])
  (list-users [this])
  (create-user [this user-data]))

(defprotocol IProfileService
  (get-profile [this user-id])
  (update-profile [this user-id changes]))

(defprotocol IAuthService
  (authenticate [this token])
  (refresh-token [this]))

;; Generate stub implementations
(proto/defstub UserServiceStub IUserService
  {:get-user [:users :get]
   :list-users [:users :list]
   :create-user [:users :create]})

(proto/defstub ProfileServiceStub IProfileService
  {:get-profile [:profiles :get]
   :update-profile [:profiles :update]})
```

### Making RPC Calls

```clojure
;; Get typed stub
(def users (rpc/service session IUserService))

;; Calls look like normal protocol calls
@(get-user users 123)
;; => {:id 123 :name "Alice" :email "alice@example.com"}

@(list-users users)
;; => [{:id 1 ...} {:id 2 ...}]

;; Chain services
(let [auth (rpc/service session IAuthService)
      profiles (rpc/service session IProfileService)]
  (let [auth-result @(authenticate auth token)
        profile @(get-profile profiles (:user-id auth-result))]
    profile))

;; Polymorphism: mock in tests
(defrecord MockUserService []
  IUserService
  (get-user [_ id] (delay {:id id :name "Mock User"}))
  (list-users [_] (delay []))
  (create-user [_ data] (delay (assoc data :id 999))))

(def mock-users (->MockUserService))
@(get-user mock-users 123)
;; => {:id 123 :name "Mock User"}
```

### Pipelining Syntax

Pipelining works through a special `pipeline` protocol method or wrapper.

```clojure
(require '[capnweb.pipeline :as pipe])

;; Wrap service to enable pipelining
(def users-pipe (pipe/pipelined users))
(def profiles-pipe (pipe/pipelined profiles))

;; Build pipeline using protocols
(defn get-user-name [users-pipe profiles-pipe user-id]
  (pipe/->
    (get-user users-pipe user-id)
    (fn [user] (get-profile profiles-pipe (:id user)))
    (fn [profile] (:display-name profile))))

@(get-user-name users-pipe profiles-pipe 123)
;; => "Alice" (single round trip)

;; Or use pipe/let for clearer multi-step pipelines
@(pipe/let [user (get-user users-pipe 123)
            profile (get-profile profiles-pipe (:id user))
            name (:display-name profile)]
   name)

;; Parallel pipelines
@(pipe/all
   (get-user users-pipe 1)
   (get-user users-pipe 2)
   (get-user users-pipe 3))
;; => [{:id 1 ...} {:id 2 ...} {:id 3 ...}]
```

### The `map` Operation

```clojure
;; Map through protocol
(defprotocol IRemoteSeq
  (rmap [this f])
  (rfilter [this pred]))

;; Extend stubs to support mapping
@(-> (list-users users-pipe)
     (pipe/rmap (fn [user] (get-profile profiles-pipe (:id user))))
     (pipe/rmap :display-name))
;; => ["Alice" "Bob" "Charlie"]

;; With protocol extension
(extend-protocol IRemoteSeq
  UserServiceStub
  (rmap [this f]
    (pipe/map-over (list-users this) f)))

@(rmap users-pipe #(get-user users-pipe %))
```

### Error Handling

```clojure
(require '[capnweb.error :as err])

;; Protocols can define error types
(defprotocol IUserServiceErrors
  (user-not-found? [e])
  (invalid-user-data? [e]))

;; Errors implement the protocol
(extend-protocol IUserServiceErrors
  clojure.lang.ExceptionInfo
  (user-not-found? [e]
    (= :user-not-found (-> e ex-data :type)))
  (invalid-user-data? [e]
    (= :invalid-user-data (-> e ex-data :type))))

;; Error handling with protocols
(try
  @(get-user users 999)
  (catch Exception e
    (cond
      (user-not-found? e) (println "User not found")
      (invalid-user-data? e) (println "Bad data")
      :else (throw e))))

;; Or use error-handling protocol
(defprotocol IErrorHandler
  (on-error [this error])
  (recover [this error]))

@(-> (get-user users 999)
     (err/with-handler
       (reify IErrorHandler
         (on-error [_ e] (println "Error:" e))
         (recover [_ e] {:id 0 :name "Unknown"}))))
```

### Exposing Local Objects as RPC Targets

```clojure
(require '[capnweb.target :as target])

;; Implement protocol to expose as target
(defprotocol ICalculator
  (add [this a b])
  (multiply [this a b]))

(defrecord Calculator [state]
  ICalculator
  (add [_ a b] (+ a b))
  (multiply [_ a b] (* a b))

  target/IRpcTarget
  (rpc-methods [_] #{:add :multiply})
  (rpc-invoke [this method args]
    (case method
      :add (apply add this args)
      :multiply (apply multiply this args)))
  (rpc-dispose [this]
    (println "Calculator disposed")))

;; Export
(def calc (->Calculator (atom {})))
(def calc-stub (rpc/export session calc))

@(-> api (rpc/call :register-calculator calc-stub))

;; Auto-generate target from protocol
(def calc-target
  (target/from-protocol ICalculator (->Calculator (atom {}))))
```

### Pros & Cons

**Pros:**
- Clear API contracts via protocols
- Excellent for testing (mock implementations)
- Familiar to Component/Integrant users
- Polymorphism enables flexibility
- IDE support for protocol methods

**Cons:**
- More upfront definition work
- Protocol dispatch overhead (minimal)
- Can't call arbitrary methods
- Less dynamic than other approaches

---

## Comparison Matrix

| Feature | Approach 1 (Threading) | Approach 2 (core.async) | Approach 3 (Data) | Approach 4 (Protocols) |
|---------|------------------------|-------------------------|-------------------|------------------------|
| **Learning Curve** | Low | Medium-High | Medium | Medium |
| **Pipelining** | Natural (don't deref) | Explicit (batch!) | Data vectors | pipe/let macro |
| **REPL Experience** | Excellent | Good | Excellent | Good |
| **Type Safety** | None | None | Via Spec | Via Protocols |
| **Testability** | Good | Fair | Excellent | Excellent |
| **Verbosity** | Low | Medium | Medium-High | Medium |
| **Discoverability** | Low (keywords) | Low | Medium (specs) | High (protocols) |
| **Async Model** | Promises | Channels | Promises | Promises |
| **Data Transparency** | Medium | Low | High | Medium |
| **Tool Support** | Standard | core.async tools | Data viewers | IDE protocol support |

### Feature Details

| Capability | Approach 1 | Approach 2 | Approach 3 | Approach 4 |
|------------|------------|------------|------------|------------|
| **Batch multiple pipelines** | `rpc/gather` | `rpc/batch!` | `rpc/batch` | `pipe/all` |
| **Error recovery** | `rpc/recover` | `rpc/try>` | `:recover` op | Protocol handlers |
| **Remote map** | `rpc/rmap` | `rpc/map>` | `:map` op | `pipe/rmap` |
| **Timeout** | Option map | `async/timeout` | Pipeline option | Option map |
| **Streaming** | Not native | Native (chans) | Not native | Not native |
| **Serializable calls** | No | No | Yes | No |

---

## Recommended Hybrid Approach

After analyzing all four approaches, a practical `capnweb` library should provide multiple entry points, letting users choose based on their needs.

### Default API: Threading Macros + Data Core

```clojure
(ns myapp.core
  (:require [capnweb.core :as rpc]))

;; Connect
(def session (rpc/connect "wss://api.example.com"))
(def api (rpc/stub session))

;; Simple threading macro usage (Approach 1)
@(-> api :users (rpc/call :get 123) :profile :name)

;; Data inspection when needed (Approach 3)
(def call (rpc/->call [:users :get 123]))
(rpc/inspect call)
;; => {:op :call, :path [:users :get], :args [123]}

;; Pipelining is natural
(let [auth (-> api (rpc/call :authenticate token))
      ;; Both pipeline through auth
      profile (-> auth (rpc/call :get-profile))
      notifs (-> auth (rpc/call :get-notifications))]
  @(rpc/gather profile notifs))
```

### Optional: core.async Integration

```clojure
(require '[capnweb.async :as rpc-async])

;; When you need channels
(go
  (let [result (<! (rpc-async/call> api :slow-operation))]
    (println result)))

;; Mix and match
(go
  (let [user (<! (rpc-async/exec> session
                   (-> api :users (rpc/call :get 123))))]
    (println user)))
```

### Optional: Protocol Layer

```clojure
(require '[capnweb.protocols :as proto])

;; Define typed service interface
(defprotocol IMyApi
  (get-user [this id])
  (list-users [this]))

(proto/defstub MyApiStub IMyApi
  {:get-user [:users :get]
   :list-users [:users :list]})

;; Use with full protocol support
(def users (rpc/service session IMyApi))
@(get-user users 123)
```

### Key Design Principles

1. **Threading macros are the default** - `->` and `->>` are core Clojure
2. **Pipelining is invisible** - Don't `deref` until you need the value
3. **Everything is data underneath** - Inspect with `rpc/inspect`
4. **core.async is optional** - Available but not required
5. **Protocols for typed contracts** - When you want them
6. **REPL-first** - Every intermediate value is inspectable

### The "Wow" Features for Clojure Developers

```clojure
;; 1. Pipelining through threading macros
@(-> api :users (rpc/call :get 123) :profile :name)
;; Single round trip!

;; 2. Destructuring pipelines
@(rpc/let-> [{:keys [profile notifications]}
             (-> api (rpc/call :authenticate token)
                 (rpc/call :get-user-data))]
   {:profile profile :count (count notifications)})

;; 3. Pipeline as data (for tooling)
(rpc/explain (-> api :users (rpc/call :get 123) :profile))
;; => "Pipeline: api -> :users -> call(:get, 123) -> :profile"

;; 4. Transducer integration
@(-> api
     (rpc/call :list-users)
     (rpc/transduce (comp (filter :active?) (map :email)) conj []))

;; 5. Spec-validated calls
(rpc/with-spec session {:users/get {:args (s/cat :id pos-int?)}})
@(-> api :users (rpc/call :get "not-an-id"))
;; => ExceptionInfo: Spec validation failed

;; 6. REPL exploration
(rpc/methods api)
;; => #{:users :authenticate :config ...}

(rpc/describe (-> api :users))
;; => {:type :stub, :path [:users], :methods #{:get :list :create}}
```

---

## Implementation Notes

### Project Structure

```
capnweb-clj/
  src/
    capnweb/
      core.clj          ; Main API, threading macro support
      async.clj         ; core.async integration
      protocols.clj     ; Protocol definitions and defstub macro
      target.clj        ; RpcTarget implementation
      transport.clj     ; WebSocket, HTTP transports
      pipeline.clj      ; Pipeline building and execution
      spec.clj          ; Spec definitions and validation
      error.clj         ; Error types and handling
  test/
    capnweb/
      core_test.clj
      pipeline_test.clj
      ...
```

### Core Types

```clojure
;; Session - manages connection and import/export tables
(defrecord Session [transport imports exports options])

;; RpcPromise - derefable, supports pipelining
(deftype RpcPromise [session pipeline-data resolved?]
  clojure.lang.IDeref
  (deref [this] ...)

  clojure.lang.ILookup
  (valAt [this key]
    (->RpcPromise session (conj pipeline-data {:op :get :key key}) false)))

;; RpcStub - entry point for calls
(deftype RpcStub [session path]
  clojure.lang.ILookup
  (valAt [this key]
    (->RpcStub session (conj path key)))

  clojure.lang.IFn
  (invoke [this & args]
    (->RpcPromise session [{:op :call :path path :args (vec args)}] false)))
```

### deps.edn

```clojure
{:paths ["src"]
 :deps {org.clojure/clojure {:mvn/version "1.11.1"}
        org.clojure/core.async {:mvn/version "1.6.681"}
        org.clojure/data.json {:mvn/version "2.4.0"}
        com.taoensso/timbre {:mvn/version "6.3.1"}
        http-kit/http-kit {:mvn/version "2.7.0"}}
 :aliases
 {:test {:extra-paths ["test"]
         :extra-deps {io.github.cognitect-labs/test-runner {:git/tag "v0.5.1"}}}
  :build {:deps {io.github.clojure/tools.build {:git/tag "v0.9.6"}}
          :ns-default build}}}
```

---

## Open Questions

1. **Promise vs Delay**: Should `RpcPromise` be more like a delay (memoized) or allow re-execution?

2. **Thread safety**: How to handle concurrent access to session state?

3. **ClojureScript support**: Should the API be CLJC-compatible? What transport for browser?

4. **Streaming**: How to handle long-running subscriptions? core.async channels seem natural.

5. **Interop with Java Cap'n Web**: Should there be Java interop for the JVM version?

6. **Namespace convention**: `capnweb.core` or `capn-web.core`? (hyphens in ns names have tradeoffs)

---

## Next Steps

1. Implement core threading macro API (Approach 1)
2. Add data inspection layer (Approach 3)
3. Build WebSocket transport
4. Add core.async integration as optional module
5. Implement protocol-based stubs as optional module
6. Write comprehensive tests
7. Publish to Clojars as `com.dotdo/capnweb`

---

*This document is a living exploration. Syntax choices will evolve based on implementation experience and community feedback.*
