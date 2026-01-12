(ns com.dotdo.rpc
  "DotDo RPC - Server-side RPC handler and mapping utilities.

   This module provides server-side RPC functionality:
   - rmap: Server-side map operation for handling remote collections
   - handler: Ring-compatible request handler for RPC endpoints
   - middleware: Composable middleware for authentication, logging, etc.

   Key concepts:
   - Handlers process incoming RPC requests and return responses
   - rmap enables efficient batch processing of collections server-side
   - Middleware provides cross-cutting concerns like auth, rate limiting"
  (:require [com.dotdo.capnweb :as capnweb]
            [manifold.deferred :as d]
            [cheshire.core :as json])
  (:import [java.util UUID]))

;; -----------------------------------------------------------------------------
;; Server-side RMap Implementation
;; -----------------------------------------------------------------------------

(defn rmap
  "Server-side map operation over a collection.

   Unlike client-side rmap which builds a pipeline, this executes
   the mapping function immediately on the server.

   Usage:
     (rmap [1 2 3 4 5] (fn [x] (* x x)))
     ;; => [1 4 9 16 25]

     (rmap users (fn [user]
                   {:id (:id user)
                    :display-name (str (:first-name user) \" \" (:last-name user))}))

   Supports:
   - Sequential collections (vectors, lists, sequences)
   - Deferred collections (waits for resolution, then maps)
   - Nil (returns nil)
   - Single values (applies function to value)"
  [coll f]
  (cond
    ;; Handle deferred collections
    (d/deferred? coll)
    (d/chain coll (fn [resolved-coll] (rmap resolved-coll f)))

    ;; Handle nil
    (nil? coll)
    nil

    ;; Handle sequential collections
    (sequential? coll)
    (mapv f coll)

    ;; Handle maps as collections of entries
    (map? coll)
    (into {} (map (fn [[k v]] [k (f v)]) coll))

    ;; Handle sets
    (set? coll)
    (into #{} (map f coll))

    ;; Single value - apply function directly
    :else
    (f coll)))

(defn rmap-indexed
  "Like rmap but passes index as second argument to function.

   Usage:
     (rmap-indexed [\"a\" \"b\" \"c\"] (fn [item idx] {:item item :position idx}))
     ;; => [{:item \"a\" :position 0} {:item \"b\" :position 1} {:item \"c\" :position 2}]"
  [coll f]
  (cond
    (d/deferred? coll)
    (d/chain coll (fn [resolved-coll] (rmap-indexed resolved-coll f)))

    (nil? coll)
    nil

    (sequential? coll)
    (vec (map-indexed (fn [idx item] (f item idx)) coll))

    :else
    (f coll 0)))

(defn rfilter
  "Server-side filter operation over a collection.

   Usage:
     (rfilter [1 2 3 4 5] even?)
     ;; => [2 4]"
  [coll pred]
  (cond
    (d/deferred? coll)
    (d/chain coll (fn [resolved-coll] (rfilter resolved-coll pred)))

    (nil? coll)
    nil

    (sequential? coll)
    (filterv pred coll)

    (set? coll)
    (into #{} (filter pred coll))

    :else
    (if (pred coll) coll nil)))

(defn rreduce
  "Server-side reduce operation over a collection.

   Usage:
     (rreduce [1 2 3 4 5] + 0)
     ;; => 15"
  [coll f init]
  (cond
    (d/deferred? coll)
    (d/chain coll (fn [resolved-coll] (rreduce resolved-coll f init)))

    (nil? coll)
    init

    (sequential? coll)
    (reduce f init coll)

    :else
    (f init coll)))

;; -----------------------------------------------------------------------------
;; Parallel Mapping
;; -----------------------------------------------------------------------------

(defn rmap-parallel
  "Like rmap but executes mapping function in parallel.

   Useful when the mapping function performs I/O or expensive computation.

   Options:
   - :concurrency  Maximum parallel operations (default: 10)
   - :ordered?     Preserve input order in output (default: true)

   Usage:
     (rmap-parallel user-ids
                    (fn [id] (fetch-user-from-db id))
                    {:concurrency 5})"
  ([coll f] (rmap-parallel coll f {}))
  ([coll f {:keys [concurrency ordered?] :or {concurrency 10 ordered? true}}]
   (cond
     (d/deferred? coll)
     (d/chain coll (fn [resolved-coll] (rmap-parallel resolved-coll f {:concurrency concurrency :ordered? ordered?})))

     (nil? coll)
     (d/success-deferred nil)

     (sequential? coll)
     (if ordered?
       ;; Use d/zip to preserve order
       (let [deferreds (mapv (fn [item]
                               (d/future (f item)))
                             coll)]
         (apply d/zip deferreds))
       ;; Just collect results as they complete
       (let [results (atom [])
             deferreds (mapv (fn [item]
                               (d/chain (d/future (f item))
                                        (fn [result]
                                          (swap! results conj result)
                                          result)))
                             coll)]
         (d/chain (apply d/zip deferreds)
                  (fn [_] @results))))

     :else
     (d/future (f coll)))))

;; -----------------------------------------------------------------------------
;; RPC Handler
;; -----------------------------------------------------------------------------

(defprotocol IRpcHandler
  "Protocol for RPC request handlers."
  (-handle [this request] "Handle an RPC request, returning a deferred response"))

(defrecord RpcHandler [methods middleware]
  IRpcHandler
  (-handle [this request]
    (let [method-name (keyword (:method request))
          method-fn (get methods method-name)]
      (if method-fn
        (try
          (let [result (apply method-fn (:args request []))]
            (if (d/deferred? result)
              (d/chain result (fn [v] {:ok true :value v}))
              (d/success-deferred {:ok true :value result})))
          (catch Exception e
            (d/success-deferred {:ok false
                                 :error {:message (.getMessage e)
                                         :type (str (type e))}})))
        (d/success-deferred {:ok false
                             :error {:message (str "Unknown method: " (name method-name))
                                     :type "MethodNotFound"}})))))

(defn handler
  "Create an RPC handler with the given methods.

   Usage:
     (def my-handler
       (handler
         {:add (fn [a b] (+ a b))
          :multiply (fn [a b] (* a b))
          :async-fetch (fn [id] (fetch-from-db id))}))

     (-handle my-handler {:method \"add\" :args [1 2]})"
  [methods]
  (->RpcHandler methods []))

(defn with-middleware
  "Add middleware to an RPC handler.

   Middleware is a function that receives [handler request] and returns
   a deferred response.

   Usage:
     (-> (handler {:add +})
         (with-middleware logging-middleware)
         (with-middleware auth-middleware))"
  [rpc-handler middleware-fn]
  (update rpc-handler :middleware conj middleware-fn))

;; -----------------------------------------------------------------------------
;; Pipeline Execution
;; -----------------------------------------------------------------------------

(defn- execute-step
  "Execute a single pipeline step."
  [context step]
  (case (:op step)
    "get"
    (let [key (keyword (:key step))
          target (:target context)]
      (assoc context :target (get target key)))

    "call"
    (let [method (keyword (:method step))
          args (:args step [])
          handler (:handler context)
          result @(-handle handler {:method method :args args})]
      (if (:ok result)
        (assoc context :target (:value result))
        (throw (ex-info (:message (:error result) "RPC Error")
                        {:type :rpc/error
                         :error (:error result)}))))

    "rmap"
    (let [target (:target context)
          fn-pipeline (:fn-pipeline step)
          captures (:captures step)]
      (assoc context :target
             (rmap target
                   (fn [item]
                     ;; Execute the sub-pipeline on each item
                     (reduce execute-step
                             (assoc context :target item)
                             fn-pipeline)
                     (:target (reduce execute-step
                                      (assoc context :target item)
                                      fn-pipeline))))))

    ;; Unknown operation
    (throw (ex-info (str "Unknown pipeline operation: " (:op step))
                    {:op (:op step)}))))

(defn execute-pipeline
  "Execute a full RPC pipeline.

   Usage:
     (execute-pipeline handler [{:op \"call\" :method \"getUsers\" :args []}
                                {:op \"rmap\" :fn-pipeline [...]}])"
  [handler pipeline]
  (let [initial-context {:handler handler :target nil}
        final-context (reduce execute-step initial-context pipeline)]
    (:target final-context)))

;; -----------------------------------------------------------------------------
;; Ring Handler
;; -----------------------------------------------------------------------------

(defn ring-handler
  "Create a Ring-compatible handler from an RPC handler.

   Usage:
     (def app
       (ring-handler my-rpc-handler))

     ;; Use with any Ring adapter
     (run-jetty app {:port 8080})"
  [rpc-handler]
  (fn [request]
    (if (= (:request-method request) :post)
      (try
        (let [body (slurp (:body request))
              rpc-request (json/parse-string body true)
              response @(-handle rpc-handler rpc-request)]
          {:status (if (:ok response) 200 400)
           :headers {"Content-Type" "application/json"}
           :body (json/generate-string response)})
        (catch Exception e
          {:status 500
           :headers {"Content-Type" "application/json"}
           :body (json/generate-string {:ok false
                                        :error {:message (.getMessage e)
                                                :type "InternalError"}})}))
      {:status 405
       :headers {"Content-Type" "application/json"}
       :body (json/generate-string {:ok false
                                    :error {:message "Method not allowed"
                                            :type "MethodNotAllowed"}})})))

;; -----------------------------------------------------------------------------
;; Request Context
;; -----------------------------------------------------------------------------

(def ^:dynamic *request-id*
  "Current request ID for tracing."
  nil)

(def ^:dynamic *request-context*
  "Current request context (auth, metadata, etc.)."
  nil)

(defmacro with-request-context
  "Execute body with request context bound.

   Usage:
     (with-request-context {:user-id 123 :tenant \"acme\"}
       (do-rpc-work))"
  [context & body]
  `(binding [*request-id* (str (UUID/randomUUID))
             *request-context* ~context]
     ~@body))

(defn current-user
  "Get the current user from request context."
  []
  (:user *request-context*))

(defn current-tenant
  "Get the current tenant from request context."
  []
  (:tenant *request-context*))

;; -----------------------------------------------------------------------------
;; Common Middleware
;; -----------------------------------------------------------------------------

(defn logging-middleware
  "Middleware that logs RPC requests and responses.

   Usage:
     (-> handler (with-middleware logging-middleware))"
  [handler request]
  (let [start-time (System/currentTimeMillis)]
    (d/chain (-handle handler request)
             (fn [response]
               (let [duration (- (System/currentTimeMillis) start-time)]
                 (println (format "[RPC] %s - %s - %dms"
                                  (:method request)
                                  (if (:ok response) "OK" "ERROR")
                                  duration)))
               response))))

(defn timing-middleware
  "Middleware that adds timing information to responses.

   Usage:
     (-> handler (with-middleware timing-middleware))"
  [handler request]
  (let [start-time (System/currentTimeMillis)]
    (d/chain (-handle handler request)
             (fn [response]
               (let [duration (- (System/currentTimeMillis) start-time)]
                 (assoc response :timing {:duration-ms duration}))))))

(defn rate-limit-middleware
  "Create rate limiting middleware.

   Options:
   - :requests-per-second  Max requests per second (default: 100)
   - :burst                Burst allowance (default: 10)

   Usage:
     (-> handler
         (with-middleware (rate-limit-middleware {:requests-per-second 50})))"
  [{:keys [requests-per-second burst]
    :or {requests-per-second 100 burst 10}}]
  (let [request-times (atom [])]
    (fn [handler request]
      (let [now (System/currentTimeMillis)
            window-start (- now 1000)
            recent-requests (count (filter #(> % window-start) @request-times))]
        (if (< recent-requests (+ requests-per-second burst))
          (do
            (swap! request-times (fn [times]
                                   (conj (filterv #(> % window-start) times) now)))
            (-handle handler request))
          (d/success-deferred {:ok false
                               :error {:message "Rate limit exceeded"
                                       :type "RateLimitExceeded"}}))))))

;; -----------------------------------------------------------------------------
;; Batch Operations
;; -----------------------------------------------------------------------------

(defn batch
  "Execute multiple RPC calls as a batch.

   Returns a deferred that resolves to a vector of results.

   Usage:
     @(batch handler
             [{:method \"getUser\" :args [1]}
              {:method \"getUser\" :args [2]}
              {:method \"getUser\" :args [3]}])"
  [handler requests]
  (apply d/zip (map #(-handle handler %) requests)))
