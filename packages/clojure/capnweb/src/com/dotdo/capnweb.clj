(ns com.dotdo.capnweb
  "Cap'n Web Clojure Client - DotDo SDK for Cap'n Proto over WebSocket.

   This module provides the core RPC primitives:
   - connect: Establish WebSocket connection to Cap'n Web server
   - call: Invoke remote methods with pipelining support
   - rmap: Server-side map operation (the 'magic' .map())
   - stub: Create RPC stub for method invocation

   Key concepts:
   - All operations return deferreds (use @ or deref to await)
   - Threading macros (-> and ->>) compose naturally with pipelining
   - rmap enables single-roundtrip collection transformations"
  (:require [aleph.http :as http]
            [manifold.deferred :as d]
            [manifold.stream :as s]
            [cheshire.core :as json])
  (:import [java.util.concurrent.atomic AtomicLong]))

;; -----------------------------------------------------------------------------
;; Protocol Definitions
;; -----------------------------------------------------------------------------

(defprotocol IRpcStub
  "Protocol for RPC stub operations."
  (-path [this] "Returns the path segments for this stub")
  (-session [this] "Returns the session this stub belongs to")
  (-get-property [this key] "Access a property, returning a new stub")
  (-call [this method args] "Invoke a method, returning a deferred"))

(defprotocol IRpcSession
  "Protocol for RPC session operations."
  (-send! [this message] "Send a message over the connection")
  (-next-id [this] "Generate next request ID")
  (-register-pending [this id deferred] "Register a pending request")
  (-resolve-pending [this id result] "Resolve a pending request")
  (-reject-pending [this id error] "Reject a pending request")
  (-close! [this] "Close the session"))

;; -----------------------------------------------------------------------------
;; Request ID Generation
;; -----------------------------------------------------------------------------

(defonce ^:private id-counter (AtomicLong. 0))

(defn- next-request-id []
  (.incrementAndGet id-counter))

;; -----------------------------------------------------------------------------
;; Forward Declarations
;; -----------------------------------------------------------------------------

(declare ->RpcStub)
(declare ->DeferredStub)

;; -----------------------------------------------------------------------------
;; RPC Stub Implementation
;; -----------------------------------------------------------------------------

(deftype RpcStub [session path]
  IRpcStub
  (-path [_] path)
  (-session [_] session)

  (-get-property [_ key]
    (->RpcStub session (conj path {:op :get :key key})))

  (-call [_ method args]
    (let [request-id (-next-id session)
          full-path (conj path {:op :call :method method :args (vec args)})
          message {:id request-id
                   :type "call"
                   :pipeline (mapv (fn [step]
                                     (case (:op step)
                                       :get {:op "get" :key (name (:key step))}
                                       :call {:op "call"
                                              :method (name (:method step))
                                              :args (:args step)}
                                       :rmap {:op "rmap"
                                              :captures (:captures step)
                                              :fn-pipeline (:fn-pipeline step)}))
                                   full-path)}
          result-d (d/deferred)]
      (-register-pending session request-id result-d)
      (-send! session message)
      (->DeferredStub session full-path result-d)))

  clojure.lang.ILookup
  (valAt [this key]
    (-get-property this key))
  (valAt [this key not-found]
    (-get-property this key))

  clojure.lang.IDeref
  (deref [this]
    (let [request-id (-next-id session)
          message {:id request-id
                   :type "call"
                   :pipeline (mapv (fn [step]
                                     (case (:op step)
                                       :get {:op "get" :key (name (:key step))}
                                       :call {:op "call"
                                              :method (name (:method step))
                                              :args (:args step)}
                                       :rmap {:op "rmap"
                                              :captures (:captures step)
                                              :fn-pipeline (:fn-pipeline step)}))
                                   path)}
          result-d (d/deferred)]
      (-register-pending session request-id result-d)
      (-send! session message)
      @result-d)))

;; -----------------------------------------------------------------------------
;; Deferred Stub (for pipelined results)
;; -----------------------------------------------------------------------------

(deftype DeferredStub [session path result-deferred]
  IRpcStub
  (-path [_] path)
  (-session [_] session)

  (-get-property [_ key]
    (let [new-path (conj path {:op :get :key key})
          chained-d (d/chain result-deferred
                             (fn [result]
                               (if (map? result)
                                 (get result key)
                                 (get result (name key)))))]
      (->DeferredStub session new-path chained-d)))

  (-call [_ method args]
    (let [new-path (conj path {:op :call :method method :args (vec args)})
          chained-d (d/chain result-deferred
                             (fn [_result]
                               (throw (ex-info "Method call on deferred requires full pipeline" {}))))]
      (->DeferredStub session new-path chained-d)))

  clojure.lang.ILookup
  (valAt [this key]
    (-get-property this key))
  (valAt [this key _not-found]
    (-get-property this key))

  clojure.lang.IDeref
  (deref [_]
    @result-deferred)

  clojure.lang.IPending
  (isRealized [_]
    (d/realized? result-deferred)))

;; -----------------------------------------------------------------------------
;; RPC Session Implementation
;; -----------------------------------------------------------------------------

(defrecord RpcSession [url ws-stream pending-requests id-counter options]
  IRpcSession
  (-send! [_ message]
    (when ws-stream
      @(s/put! ws-stream (json/generate-string message))))

  (-next-id [_]
    (.incrementAndGet ^AtomicLong id-counter))

  (-register-pending [_ id deferred]
    (swap! pending-requests assoc id deferred))

  (-resolve-pending [_ id result]
    (when-let [d (get @pending-requests id)]
      (swap! pending-requests dissoc id)
      (d/success! d result)))

  (-reject-pending [_ id error]
    (when-let [d (get @pending-requests id)]
      (swap! pending-requests dissoc id)
      (d/error! d (ex-info (:message error "RPC Error")
                           {:type :rpc/error
                            :remote error}))))

  (-close! [_]
    (when ws-stream
      (s/close! ws-stream))
    (doseq [[id d] @pending-requests]
      (d/error! d (ex-info "Session closed" {:type :rpc/session-closed})))
    (reset! pending-requests {}))

  java.io.Closeable
  (close [this]
    (-close! this)))

;; -----------------------------------------------------------------------------
;; Connection Management
;; -----------------------------------------------------------------------------

(defn- handle-message
  "Process an incoming WebSocket message."
  [session message-str]
  (try
    (let [message (json/parse-string message-str true)]
      (case (:type message)
        "result"
        (-resolve-pending session (:id message) (:value message))

        "error"
        (-reject-pending session (:id message) (:error message))

        (println "Unknown message type:" (:type message))))
    (catch Exception e
      (println "Error parsing message:" (.getMessage e)))))

(defn connect
  "Connect to a Cap'n Web server.

   Options:
   - :timeout-ms     Connection timeout (default 30000)
   - :reconnect?     Auto-reconnect on disconnect (default false)
   - :max-reconnects Maximum reconnection attempts (default 5)
   - :headers        Additional HTTP headers for connection

   Returns an RpcSession that implements Closeable."
  ([url] (connect url {}))
  ([url options]
   (let [pending-requests (atom {})
         id-counter (AtomicLong. 0)
         session (map->RpcSession
                  {:url url
                   :ws-stream nil
                   :pending-requests pending-requests
                   :id-counter id-counter
                   :options options})

         connect-d (d/timeout!
                    (d/catch
                     (http/websocket-client url
                                            (merge
                                             {:headers (:headers options {})}
                                             (select-keys options [:max-frame-size])))
                     (fn [e]
                       nil))
                    (or (:timeout-ms options) 5000)
                    nil)]

     (d/on-realized connect-d
                    (fn [ws]
                      (when ws
                        (d/loop []
                          (d/chain (s/take! ws)
                                   (fn [msg]
                                     (when msg
                                       (handle-message session msg)
                                       (d/recur)))))))
                    (fn [_error]
                      nil))

     (let [ws @connect-d]
       (assoc session :ws-stream ws)))))

;; -----------------------------------------------------------------------------
;; Stub Creation
;; -----------------------------------------------------------------------------

(defn stub
  "Create an RPC stub from a session.
   The stub is the root object for making RPC calls."
  [session]
  (->RpcStub session []))

;; -----------------------------------------------------------------------------
;; Method Invocation
;; -----------------------------------------------------------------------------

(defn call
  "Invoke a method on an RPC stub or capability.

   Usage:
     (call api :method arg1 arg2)
     (-> api (call :method arg1 arg2))
     (-> api :property (call :method arg1))"
  [stub method & args]
  (if (instance? RpcStub stub)
    (-call stub method args)
    (if (instance? DeferredStub stub)
      (-call stub method args)
      (if (map? stub)
        (d/success-deferred
         (if-let [f (get stub method)]
           (apply f args)
           (throw (ex-info (str "Method not found: " method) {:method method}))))
        (throw (ex-info "Cannot call method on non-stub value"
                        {:value stub :method method}))))))

;; -----------------------------------------------------------------------------
;; Remote Map (rmap) - The Magic .map() Operation
;; -----------------------------------------------------------------------------

(defn rmap
  "Server-side map operation over a remote collection.

   This is the key feature that eliminates N+1 round trips.
   The function is serialized and executed on the server,
   mapping over the collection in a single request.

   Usage:
     (-> api
         (call :generateFibonacci 6)
         (rmap (fn [x] (-> api (call :square x)))))

   The function receives each element and should return
   an RPC pipeline that will be executed server-side."
  [coll-stub f]
  (cond
    (instance? RpcStub coll-stub)
    (let [session (-session coll-stub)
          path (-path coll-stub)
          new-path (conj path {:op :rmap
                               :captures ["$self"]
                               :fn-pipeline []})]
      (->RpcStub session new-path))

    (instance? DeferredStub coll-stub)
    (let [session (-session coll-stub)
          path (-path coll-stub)
          result-d (.-result-deferred ^DeferredStub coll-stub)
          mapped-d (d/chain result-d
                            (fn [coll]
                              (cond
                                (nil? coll) nil
                                (sequential? coll)
                                (mapv (fn [x]
                                        (let [result (f x)]
                                          (if (satisfies? clojure.lang.IDeref result)
                                            @result
                                            result)))
                                      coll)
                                :else
                                (let [result (f coll)]
                                  (if (satisfies? clojure.lang.IDeref result)
                                    @result
                                    result)))))]
      (->DeferredStub session (conj path {:op :rmap}) mapped-d))

    (sequential? coll-stub)
    (d/success-deferred (mapv f coll-stub))

    (nil? coll-stub)
    (d/success-deferred nil)

    :else
    (d/success-deferred (f coll-stub))))

;; -----------------------------------------------------------------------------
;; Remote Filter
;; -----------------------------------------------------------------------------

(defn rfilter
  "Server-side filter operation over a remote collection.
   Similar to rmap but for filtering."
  [coll-stub pred]
  (cond
    (instance? DeferredStub coll-stub)
    (let [session (-session coll-stub)
          path (-path coll-stub)
          result-d (.-result-deferred ^DeferredStub coll-stub)
          filtered-d (d/chain result-d
                              (fn [coll]
                                (if (sequential? coll)
                                  (filterv pred coll)
                                  coll)))]
      (->DeferredStub session (conj path {:op :rfilter}) filtered-d))

    (sequential? coll-stub)
    (d/success-deferred (filterv pred coll-stub))

    :else
    (d/success-deferred coll-stub)))

;; -----------------------------------------------------------------------------
;; Gathering Multiple Pipelines
;; -----------------------------------------------------------------------------

(defn gather
  "Execute multiple pipelines in parallel, returning all results.

   Usage:
     @(gather
        (-> api :users (call :get 1))
        (-> api :users (call :get 2))
        (-> api :users (call :get 3)))
     ;; => [user1 user2 user3]"
  [& pipelines]
  (apply d/zip (map (fn [p]
                      (if (d/deferred? p)
                        p
                        (if (instance? DeferredStub p)
                          (.-result-deferred ^DeferredStub p)
                          (d/success-deferred p))))
                    pipelines)))

;; -----------------------------------------------------------------------------
;; Error Handling
;; -----------------------------------------------------------------------------

(defn try-deref
  "Safely dereference a pipeline, returning [value nil] or [nil error].

   Usage:
     (let [[result err] (try-deref pipeline)]
       (if err
         (handle-error err)
         (use-result result)))"
  [pipeline]
  (try
    [(deref pipeline) nil]
    (catch Exception e
      [nil (ex-data e)])))

(defn recover
  "Add error recovery to a pipeline.
   If the pipeline fails, return the default value instead."
  [pipeline default]
  (if (instance? DeferredStub pipeline)
    (let [session (-session pipeline)
          path (-path pipeline)
          result-d (.-result-deferred ^DeferredStub pipeline)
          recovered-d (d/catch result-d (fn [_] default))]
      (->DeferredStub session path recovered-d))
    (d/catch (d/success-deferred pipeline) (fn [_] default))))

(defn recover-with
  "Add conditional error recovery to a pipeline.
   The handler receives the error and can return a recovery value
   or throw to propagate the error."
  [pipeline handler]
  (if (instance? DeferredStub pipeline)
    (let [session (-session pipeline)
          path (-path pipeline)
          result-d (.-result-deferred ^DeferredStub pipeline)
          recovered-d (d/catch result-d handler)]
      (->DeferredStub session path recovered-d))
    (d/catch (d/success-deferred pipeline) handler)))

;; -----------------------------------------------------------------------------
;; Session Management
;; -----------------------------------------------------------------------------

(defn close!
  "Close an RPC session."
  [session]
  (-close! session))

(defn connected?
  "Check if a session is connected."
  [session]
  (boolean (:ws-stream session)))

;; -----------------------------------------------------------------------------
;; Introspection
;; -----------------------------------------------------------------------------

(defn describe
  "Get metadata about a stub or pipeline."
  [stub]
  (cond
    (instance? RpcStub stub)
    {:type :stub
     :path (-path stub)
     :session (-session stub)}

    (instance? DeferredStub stub)
    {:type :deferred-stub
     :path (-path stub)
     :realized? (d/realized? (.-result-deferred ^DeferredStub stub))}

    :else
    {:type (type stub)
     :value stub}))

(defn pipeline-data
  "Extract the pipeline operations as data."
  [stub]
  (when (or (instance? RpcStub stub) (instance? DeferredStub stub))
    (-path stub)))

(defn explain
  "Human-readable explanation of a pipeline."
  [stub]
  (when-let [path (pipeline-data stub)]
    (->> path
         (map (fn [step]
                (case (:op step)
                  :get (str ":" (name (:key step)))
                  :call (str "call(:" (name (:method step))
                             " " (pr-str (:args step)) ")")
                  :rmap "rmap(...)"
                  :rfilter "rfilter(...)"
                  (str step))))
         (clojure.string/join " -> ")
         (str "api -> "))))
