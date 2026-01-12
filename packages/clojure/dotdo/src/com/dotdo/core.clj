(ns com.dotdo.core
  "DotDo Platform SDK - Complete client library for DotDo services.

   This module provides high-level platform functionality:
   - Authentication: Token-based auth with automatic refresh
   - Connection Pooling: Efficient connection reuse with health checks
   - Retry Logic: Exponential backoff with jitter using core.async
   - Client Factory: Easy creation of configured clients

   Key concepts:
   - Clients are immutable and thread-safe
   - All I/O operations return core.async channels or deferreds
   - Automatic token refresh before expiration
   - Connection pooling with configurable limits and timeouts"
  (:require [com.dotdo.capnweb :as capnweb]
            [com.dotdo.rpc :as rpc]
            [clojure.core.async :as async :refer [go go-loop <! >! chan close! timeout alt!]]
            [manifold.deferred :as d]
            [cheshire.core :as json]
            [clj-http.client :as http])
  (:import [java.util.concurrent.atomic AtomicLong AtomicReference]
           [java.time Instant Duration]))

;; -----------------------------------------------------------------------------
;; Configuration
;; -----------------------------------------------------------------------------

(def ^:dynamic *config*
  "Default configuration for DotDo clients."
  {:auth-url "https://auth.dotdo.com"
   :api-url "wss://api.dotdo.com"
   :connect-timeout-ms 5000
   :request-timeout-ms 30000
   :max-retries 3
   :retry-base-delay-ms 100
   :retry-max-delay-ms 10000
   :pool-size 10
   :pool-timeout-ms 5000
   :token-refresh-buffer-seconds 60})

(defn configure!
  "Set global configuration.

   Usage:
     (configure! {:auth-url \"https://auth.staging.dotdo.com\"
                  :max-retries 5})"
  [config]
  (alter-var-root #'*config* merge config))

;; -----------------------------------------------------------------------------
;; Authentication
;; -----------------------------------------------------------------------------

(defprotocol IAuthProvider
  "Protocol for authentication providers."
  (-get-token [this] "Get current valid token, refreshing if needed")
  (-invalidate [this] "Invalidate current token, forcing refresh")
  (-close [this] "Clean up auth provider resources"))

(defrecord TokenAuth [^AtomicReference token-ref
                      ^AtomicReference expires-ref
                      refresh-fn
                      refresh-buffer-seconds
                      refresh-chan]
  IAuthProvider
  (-get-token [this]
    (let [token (.get token-ref)
          expires (.get expires-ref)
          now (Instant/now)]
      (if (and token
               expires
               (.isBefore now (.minusSeconds expires refresh-buffer-seconds)))
        ;; Token is still valid
        (go token)
        ;; Need to refresh
        (go
          (let [result (<! (refresh-fn))]
            (when (:token result)
              (.set token-ref (:token result))
              (.set expires-ref (Instant/ofEpochSecond (:expires-at result))))
            (:token result))))))

  (-invalidate [this]
    (.set token-ref nil)
    (.set expires-ref nil))

  (-close [this]
    (when refresh-chan
      (close! refresh-chan))))

(defn- make-oauth-refresh-fn
  "Create a refresh function for OAuth2 client credentials flow."
  [auth-url client-id client-secret]
  (fn []
    (go
      (try
        (let [response (http/post (str auth-url "/oauth/token")
                                  {:form-params {:grant_type "client_credentials"
                                                 :client_id client-id
                                                 :client_secret client-secret}
                                   :as :json
                                   :throw-exceptions false})]
          (if (= 200 (:status response))
            (let [body (:body response)]
              {:token (:access_token body)
               :expires-at (+ (quot (System/currentTimeMillis) 1000)
                              (:expires_in body 3600))})
            {:error (:body response)}))
        (catch Exception e
          {:error (.getMessage e)})))))

(defn- make-api-key-refresh-fn
  "Create a 'refresh' function for API key auth (no actual refresh needed)."
  [api-key]
  (fn []
    (go {:token api-key
         :expires-at (+ (quot (System/currentTimeMillis) 1000)
                        (* 365 24 60 60))}))) ; 1 year

(defn oauth-auth
  "Create an OAuth2 authentication provider.

   Usage:
     (def auth (oauth-auth {:client-id \"my-client\"
                            :client-secret \"secret\"
                            :auth-url \"https://auth.dotdo.com\"}))"
  [{:keys [client-id client-secret auth-url]}]
  (let [auth-url (or auth-url (:auth-url *config*))
        refresh-fn (make-oauth-refresh-fn auth-url client-id client-secret)
        refresh-buffer (:token-refresh-buffer-seconds *config*)]
    (->TokenAuth (AtomicReference. nil)
                 (AtomicReference. nil)
                 refresh-fn
                 refresh-buffer
                 nil)))

(defn api-key-auth
  "Create an API key authentication provider.

   Usage:
     (def auth (api-key-auth \"your-api-key\"))"
  [api-key]
  (let [refresh-fn (make-api-key-refresh-fn api-key)
        refresh-buffer (:token-refresh-buffer-seconds *config*)]
    (->TokenAuth (AtomicReference. api-key)
                 (AtomicReference. (Instant/now.plusSeconds (* 365 24 60 60)))
                 refresh-fn
                 refresh-buffer
                 nil)))

(defn bearer-token-auth
  "Create a bearer token authentication provider.

   Usage:
     (def auth (bearer-token-auth \"eyJ...\" 3600))"
  [token expires-in-seconds]
  (let [refresh-fn (fn [] (go {:token token
                               :expires-at (+ (quot (System/currentTimeMillis) 1000)
                                              expires-in-seconds)}))
        refresh-buffer (:token-refresh-buffer-seconds *config*)]
    (->TokenAuth (AtomicReference. token)
                 (AtomicReference. (Instant/now.plusSeconds expires-in-seconds))
                 refresh-fn
                 refresh-buffer
                 nil)))

;; -----------------------------------------------------------------------------
;; Retry Logic with Exponential Backoff
;; -----------------------------------------------------------------------------

(defn- calculate-backoff
  "Calculate backoff delay with exponential increase and jitter."
  [attempt base-delay-ms max-delay-ms]
  (let [exp-delay (* base-delay-ms (Math/pow 2 attempt))
        capped-delay (min exp-delay max-delay-ms)
        jitter (* capped-delay (rand))]
    (long (+ capped-delay jitter))))

(defn- retryable-error?
  "Check if an error is retryable."
  [error]
  (let [error-type (or (:type (ex-data error))
                       (type error))]
    (contains? #{:rpc/timeout
                 :rpc/connection-error
                 :rpc/service-unavailable
                 java.net.SocketTimeoutException
                 java.net.ConnectException}
               error-type)))

(defn with-retry
  "Execute an operation with retry logic.

   Options:
   - :max-retries       Maximum retry attempts (default: 3)
   - :base-delay-ms     Base delay between retries (default: 100)
   - :max-delay-ms      Maximum delay between retries (default: 10000)
   - :retry-pred        Predicate to determine if error is retryable
   - :on-retry          Callback called before each retry (fn [attempt error delay])

   Usage:
     (<! (with-retry
           (fn [] (call-api))
           {:max-retries 5
            :on-retry (fn [attempt error delay]
                        (log/warn \"Retrying\" :attempt attempt :delay delay))}))"
  ([operation] (with-retry operation {}))
  ([operation {:keys [max-retries base-delay-ms max-delay-ms retry-pred on-retry]
               :or {max-retries (:max-retries *config*)
                    base-delay-ms (:retry-base-delay-ms *config*)
                    max-delay-ms (:retry-max-delay-ms *config*)
                    retry-pred retryable-error?}}]
   (go-loop [attempt 0
             last-error nil]
     (if (>= attempt max-retries)
       ;; Max retries exceeded
       (if last-error
         (throw last-error)
         (throw (ex-info "Max retries exceeded" {:attempts attempt})))
       ;; Try operation
       (let [result (try
                      {:ok true :value (<! (operation))}
                      (catch Exception e
                        {:ok false :error e}))]
         (if (:ok result)
           (:value result)
           (let [error (:error result)]
             (if (retry-pred error)
               ;; Retryable error - wait and retry
               (let [delay-ms (calculate-backoff attempt base-delay-ms max-delay-ms)]
                 (when on-retry
                   (on-retry attempt error delay-ms))
                 (<! (timeout delay-ms))
                 (recur (inc attempt) error))
               ;; Non-retryable error - throw immediately
               (throw error)))))))))

(defmacro with-retry-sync
  "Synchronous version of with-retry for use outside go blocks.

   Usage:
     (with-retry-sync {:max-retries 3}
       (risky-operation))"
  [opts & body]
  `(async/<!! (with-retry (fn [] (go ~@body)) ~opts)))

;; -----------------------------------------------------------------------------
;; Connection Pooling
;; -----------------------------------------------------------------------------

(defprotocol IConnectionPool
  "Protocol for connection pool operations."
  (-acquire [this] "Acquire a connection from the pool")
  (-release [this conn] "Return a connection to the pool")
  (-close-pool [this] "Close all connections and shut down the pool")
  (-pool-stats [this] "Get pool statistics"))

(defrecord PooledConnection [connection created-at last-used-at])

(defn- create-connection
  "Create a new pooled connection."
  [url auth-provider options]
  (go
    (let [token (<! (-get-token auth-provider))
          conn (capnweb/connect url (merge options
                                           {:headers {"Authorization" (str "Bearer " token)}}))]
      (->PooledConnection conn
                          (Instant/now)
                          (AtomicReference. (Instant/now))))))

(defn- connection-healthy?
  "Check if a pooled connection is still healthy."
  [pooled-conn max-age-seconds]
  (let [now (Instant/now)
        created (:created-at pooled-conn)
        age (Duration/between created now)]
    (and (capnweb/connected? (:connection pooled-conn))
         (< (.toSeconds age) max-age-seconds))))

(defrecord ConnectionPool [url
                           auth-provider
                           options
                           ^AtomicLong pool-size
                           ^AtomicLong active-count
                           available-chan
                           request-chan
                           stats-atom
                           shutdown-atom
                           max-age-seconds
                           acquire-timeout-ms]
  IConnectionPool
  (-acquire [this]
    (go
      (when-not @shutdown-atom
        (let [timeout-ch (timeout acquire-timeout-ms)]
          (alt!
            available-chan
            ([conn]
             (if (and conn (connection-healthy? conn max-age-seconds))
               (do
                 (.set ^AtomicReference (:last-used-at conn) (Instant/now))
                 (swap! stats-atom update :acquisitions inc)
                 conn)
               ;; Connection unhealthy, create new one
               (do
                 (swap! stats-atom update :evictions inc)
                 (<! (create-connection url auth-provider options)))))

            timeout-ch
            ([_]
             ;; Timeout waiting for connection, create new one if under limit
             (if (< (.get active-count) (.get pool-size))
               (do
                 (.incrementAndGet active-count)
                 (swap! stats-atom update :creates inc)
                 (<! (create-connection url auth-provider options)))
               (throw (ex-info "Connection pool exhausted"
                               {:type :pool/exhausted
                                :pool-size (.get pool-size)
                                :active (.get active-count)})))))))))

  (-release [this conn]
    (when conn
      (go
        (if @shutdown-atom
          ;; Pool is shutting down, close connection
          (capnweb/close! (:connection conn))
          ;; Return to pool
          (do
            (swap! stats-atom update :releases inc)
            (>! available-chan conn))))))

  (-close-pool [this]
    (reset! shutdown-atom true)
    (close! available-chan)
    (close! request-chan)
    ;; Drain and close all connections
    (go-loop []
      (when-let [conn (<! available-chan)]
        (capnweb/close! (:connection conn))
        (recur))))

  (-pool-stats [this]
    (merge @stats-atom
           {:pool-size (.get pool-size)
            :active (.get active-count)})))

(defn connection-pool
  "Create a connection pool for DotDo API connections.

   Options:
   - :pool-size          Maximum connections in pool (default: 10)
   - :acquire-timeout-ms Timeout when acquiring connection (default: 5000)
   - :max-age-seconds    Maximum connection age before recycling (default: 300)

   Usage:
     (def pool (connection-pool auth-provider
                                {:pool-size 20
                                 :max-age-seconds 600}))"
  ([auth-provider] (connection-pool auth-provider {}))
  ([auth-provider {:keys [url pool-size acquire-timeout-ms max-age-seconds]
                   :or {url (:api-url *config*)
                        pool-size (:pool-size *config*)
                        acquire-timeout-ms (:pool-timeout-ms *config*)
                        max-age-seconds 300}}]
   (let [available-chan (chan pool-size)
         request-chan (chan 100)
         options {:timeout-ms (:connect-timeout-ms *config*)}]
     (->ConnectionPool url
                       auth-provider
                       options
                       (AtomicLong. pool-size)
                       (AtomicLong. 0)
                       available-chan
                       request-chan
                       (atom {:acquisitions 0
                              :releases 0
                              :creates 0
                              :evictions 0})
                       (atom false)
                       max-age-seconds
                       acquire-timeout-ms))))

(defmacro with-connection
  "Execute body with a pooled connection, automatically releasing it.

   Usage:
     (<! (with-connection [conn pool]
           (-> (capnweb/stub conn)
               (capnweb/call :someMethod arg1 arg2))))"
  [[conn-sym pool] & body]
  `(go
     (let [pooled-conn# (<! (-acquire ~pool))
           ~conn-sym (:connection pooled-conn#)]
       (try
         ~@body
         (finally
           (-release ~pool pooled-conn#))))))

;; -----------------------------------------------------------------------------
;; DotDo Client
;; -----------------------------------------------------------------------------

(defprotocol IDotDoClient
  "Protocol for DotDo client operations."
  (-call-method [this method args] "Call an RPC method")
  (-get-stub [this] "Get the raw RPC stub")
  (-close-client [this] "Close the client and release resources"))

(defrecord DotDoClient [pool auth-provider config]
  IDotDoClient
  (-call-method [this method args]
    (go
      (<! (with-retry
            (fn []
              (with-connection [conn pool]
                (let [stub (capnweb/stub conn)]
                  @(apply capnweb/call stub method args))))
            (:retry-config config {})))))

  (-get-stub [this]
    (go
      (let [pooled-conn (<! (-acquire pool))]
        {:stub (capnweb/stub (:connection pooled-conn))
         :release-fn (fn [] (-release pool pooled-conn))})))

  (-close-client [this]
    (-close-pool pool)
    (-close auth-provider)))

(defn client
  "Create a DotDo client with connection pooling and retry logic.

   Options:
   - :auth              Authentication provider (required)
   - :url               API URL (default: from config)
   - :pool-size         Connection pool size (default: 10)
   - :max-retries       Maximum retry attempts (default: 3)
   - :timeout-ms        Request timeout (default: 30000)

   Usage:
     (def dotdo (client {:auth (api-key-auth \"your-key\")
                         :pool-size 20}))

     ;; Make calls
     (<! (-call-method dotdo :getUser [123]))

     ;; Or get raw stub for more control
     (let [{:keys [stub release-fn]} (<! (-get-stub dotdo))]
       (try
         @(-> stub :users (capnweb/call :get 123))
         (finally
           (release-fn))))"
  [{:keys [auth url pool-size max-retries timeout-ms]
    :or {url (:api-url *config*)
         pool-size (:pool-size *config*)
         max-retries (:max-retries *config*)
         timeout-ms (:request-timeout-ms *config*)}}]
  (when-not auth
    (throw (ex-info "Authentication provider required" {:type :config/missing-auth})))
  (let [pool (connection-pool auth {:url url :pool-size pool-size})
        config {:retry-config {:max-retries max-retries}
                :timeout-ms timeout-ms}]
    (->DotDoClient pool auth config)))

;; -----------------------------------------------------------------------------
;; Convenience Functions
;; -----------------------------------------------------------------------------

(defn call!
  "Make an RPC call using a DotDo client.

   Returns a channel that will contain the result.

   Usage:
     (<! (call! client :getUser 123))
     (<! (call! client :createUser {:name \"Alice\"}))"
  [client method & args]
  (-call-method client method args))

(defn call-sync!
  "Synchronous version of call! for use outside go blocks.

   Usage:
     (call-sync! client :getUser 123)"
  [client method & args]
  (async/<!! (-call-method client method args)))

(defmacro with-client
  "Execute body with a new client, automatically closing it.

   Usage:
     (with-client [c {:auth (api-key-auth \"key\")}]
       (<! (call! c :getUser 123)))"
  [[client-sym options] & body]
  `(let [~client-sym (client ~options)]
     (try
       ~@body
       (finally
         (-close-client ~client-sym)))))

;; -----------------------------------------------------------------------------
;; Health Checks
;; -----------------------------------------------------------------------------

(defn health-check
  "Perform a health check on a DotDo client.

   Returns a channel with health status.

   Usage:
     (<! (health-check client))"
  [client]
  (go
    (try
      (let [start (System/currentTimeMillis)
            _ (<! (call! client :ping))
            duration (- (System/currentTimeMillis) start)]
        {:status :healthy
         :latency-ms duration
         :pool-stats (-pool-stats (:pool client))})
      (catch Exception e
        {:status :unhealthy
         :error (.getMessage e)
         :pool-stats (-pool-stats (:pool client))}))))

;; -----------------------------------------------------------------------------
;; Batch Operations
;; -----------------------------------------------------------------------------

(defn batch-call!
  "Execute multiple RPC calls in parallel.

   Returns a channel that will contain a vector of results.

   Usage:
     (<! (batch-call! client
                      [[:getUser 1]
                       [:getUser 2]
                       [:getUser 3]]))"
  [client calls]
  (go
    (let [result-chans (mapv (fn [[method & args]]
                               (-call-method client method args))
                             calls)
          results (atom [])]
      (doseq [ch result-chans]
        (swap! results conj (<! ch)))
      @results)))

(defn parallel-map
  "Map a function over a collection with controlled parallelism.

   Options:
   - :concurrency  Maximum parallel operations (default: 10)

   Usage:
     (<! (parallel-map client
                       [1 2 3 4 5]
                       (fn [id] (call! client :getUser id))
                       {:concurrency 3}))"
  ([client coll f] (parallel-map client coll f {}))
  ([client coll f {:keys [concurrency] :or {concurrency 10}}]
   (let [input-ch (chan)
         output-ch (chan (count coll))
         results (atom (vec (repeat (count coll) nil)))]

     ;; Put indexed items into input channel
     (go
       (doseq [[idx item] (map-indexed vector coll)]
         (>! input-ch [idx item]))
       (close! input-ch))

     ;; Start worker goroutines
     (dotimes [_ concurrency]
       (go-loop []
         (when-let [[idx item] (<! input-ch)]
           (let [result (<! (f item))]
             (swap! results assoc idx result)
             (>! output-ch :done))
           (recur))))

     ;; Wait for all results
     (go
       (dotimes [_ (count coll)]
         (<! output-ch))
       @results))))

;; -----------------------------------------------------------------------------
;; Event Subscriptions
;; -----------------------------------------------------------------------------

(defn subscribe
  "Subscribe to events from the DotDo platform.

   Returns a channel that will receive events.

   Options:
   - :buffer-size  Channel buffer size (default: 100)
   - :filter       Filter function for events

   Usage:
     (let [events (<! (subscribe client :user-events {:filter #(= (:type %) :created)}))]
       (go-loop []
         (when-let [event (<! events)]
           (handle-event event)
           (recur))))"
  ([client topic] (subscribe client topic {}))
  ([client topic {:keys [buffer-size filter]
                  :or {buffer-size 100}}]
   (go
     (let [{:keys [stub release-fn]} (<! (-get-stub client))
           events-ch (chan buffer-size (if filter (clojure.core/filter filter) identity))]
       ;; In a real implementation, this would set up a subscription
       ;; For now, we return the channel
       {:channel events-ch
        :unsubscribe (fn []
                       (close! events-ch)
                       (release-fn))}))))

;; -----------------------------------------------------------------------------
;; Metrics and Observability
;; -----------------------------------------------------------------------------

(def ^:private metrics-atom (atom {:calls 0
                                   :errors 0
                                   :retries 0
                                   :total-latency-ms 0}))

(defn get-metrics
  "Get current client metrics."
  []
  (let [m @metrics-atom
        calls (:calls m)]
    (assoc m :avg-latency-ms (if (pos? calls)
                               (/ (:total-latency-ms m) calls)
                               0))))

(defn reset-metrics!
  "Reset all metrics to zero."
  []
  (reset! metrics-atom {:calls 0
                        :errors 0
                        :retries 0
                        :total-latency-ms 0}))

(defn- record-call!
  "Record a call in metrics."
  [latency-ms success?]
  (swap! metrics-atom
         (fn [m]
           (-> m
               (update :calls inc)
               (update :total-latency-ms + latency-ms)
               (cond-> (not success?) (update :errors inc))))))

(defn- record-retry!
  "Record a retry in metrics."
  []
  (swap! metrics-atom update :retries inc))

;; -----------------------------------------------------------------------------
;; Initialization
;; -----------------------------------------------------------------------------

(defn init!
  "Initialize the DotDo SDK with configuration.

   Usage:
     (init! {:auth-url \"https://auth.dotdo.com\"
             :api-url \"wss://api.dotdo.com\"
             :max-retries 5})"
  [config]
  (configure! config))
