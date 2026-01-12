(ns com.dotdo.kafka
  "DotDo Kafka SDK - Kafka producer, consumer, and streams with RPC pipelining.

   This module provides a Clojure-idiomatic Kafka client built on DotDo RPC:
   - Producer with batching, compression, and delivery guarantees
   - Consumer with core.async integration and manual/auto commit
   - Admin client for topic and cluster management
   - Streams DSL for stateful stream processing

   Key concepts:
   - Producers and consumers are thread-safe and connection-pooled
   - Messages flow through core.async channels
   - Exactly-once semantics with transactional producers
   - Consumer groups with automatic rebalancing

   Example:
     ;; Producer
     (def producer (create-producer {:bootstrap-servers \"localhost:9092\"}))
     @(send! producer :my-topic {:user-id 123 :action \"login\"})

     ;; Consumer
     (def consumer (create-consumer {:bootstrap-servers \"localhost:9092\"
                                     :group-id \"my-group\"}))
     (subscribe! consumer [:my-topic])
     (let [messages (poll-chan consumer)]
       (go-loop []
         (when-let [msg (<! messages)]
           (process-message msg)
           (recur))))

     ;; Streams
     (def topology
       (-> (stream-builder)
           (stream :input-topic)
           (filter (fn [k v] (pos? (:amount v))))
           (map-values (fn [v] (assoc v :processed-at (System/currentTimeMillis))))
           (to :output-topic)))
     (start-streams topology {:application-id \"my-streams-app\"})"
  (:require [com.dotdo.core :as dotdo]
            [com.dotdo.capnweb :as capnweb]
            [clojure.core.async :as async :refer [go go-loop <! >! chan close! timeout alt! sliding-buffer]]
            [manifold.deferred :as d]
            [cheshire.core :as json]
            [clojure.spec.alpha :as s])
  (:import [java.util UUID]
           [java.time Instant Duration]
           [java.util.concurrent.atomic AtomicLong AtomicBoolean AtomicReference]))

;; =============================================================================
;; Specs for Validation
;; =============================================================================

(s/def ::non-empty-string (s/and string? #(pos? (count %))))
(s/def ::bootstrap-servers ::non-empty-string)
(s/def ::topic (s/or :string string? :keyword keyword?))
(s/def ::topics (s/coll-of ::topic))
(s/def ::group-id ::non-empty-string)
(s/def ::partition nat-int?)
(s/def ::offset nat-int?)
(s/def ::key any?)
(s/def ::value any?)
(s/def ::headers (s/map-of string? string?))
(s/def ::timestamp inst?)

(s/def ::producer-record
  (s/keys :req-un [::topic ::value]
          :opt-un [::key ::partition ::headers ::timestamp]))

(s/def ::consumer-record
  (s/keys :req-un [::topic ::partition ::offset ::key ::value]
          :opt-un [::headers ::timestamp]))

;; =============================================================================
;; Configuration
;; =============================================================================

(def ^:dynamic *config*
  "Default configuration for Kafka clients."
  {:bootstrap-servers "localhost:9092"
   :connect-timeout-ms 10000
   :request-timeout-ms 30000
   :max-retries 3
   :retry-base-delay-ms 100
   :retry-max-delay-ms 5000

   ;; Producer defaults
   :producer {:acks "all"
              :retries 3
              :batch-size 16384
              :linger-ms 1
              :buffer-memory 33554432
              :compression-type "none"
              :max-in-flight-requests-per-connection 5
              :enable-idempotence true}

   ;; Consumer defaults
   :consumer {:auto-offset-reset "earliest"
              :enable-auto-commit false
              :max-poll-records 500
              :max-poll-interval-ms 300000
              :session-timeout-ms 45000
              :heartbeat-interval-ms 3000
              :fetch-min-bytes 1
              :fetch-max-wait-ms 500}

   ;; Streams defaults
   :streams {:processing-guarantee "exactly_once_v2"
             :num-stream-threads 1
             :cache-max-bytes-buffering 10485760
             :commit-interval-ms 30000}})

(defn configure!
  "Set global Kafka configuration.

   Usage:
     (configure! {:bootstrap-servers \"kafka1:9092,kafka2:9092\"
                  :producer {:acks \"1\"}})"
  [config]
  (alter-var-root #'*config* #(merge-with merge % config)))

;; =============================================================================
;; Serialization
;; =============================================================================

(defmulti serialize
  "Serialize a value for Kafka. Dispatches on :serializer key in options."
  (fn [value options] (:serializer options :json)))

(defmethod serialize :json [value _]
  (when value
    (json/generate-string value)))

(defmethod serialize :string [value _]
  (when value (str value)))

(defmethod serialize :edn [value _]
  (when value (pr-str value)))

(defmethod serialize :bytes [value _]
  value)

(defmulti deserialize
  "Deserialize a Kafka message. Dispatches on :deserializer key in options."
  (fn [bytes options] (:deserializer options :json)))

(defmethod deserialize :json [bytes _]
  (when bytes
    (json/parse-string bytes true)))

(defmethod deserialize :string [bytes _]
  bytes)

(defmethod deserialize :edn [bytes _]
  (when bytes
    (read-string bytes)))

(defmethod deserialize :bytes [bytes _]
  bytes)

;; =============================================================================
;; Protocol Definitions
;; =============================================================================

(defprotocol IProducer
  "Protocol for Kafka producer operations."
  (-send [this record] "Send a record asynchronously")
  (-send-sync [this record] "Send a record synchronously")
  (-flush [this] "Flush pending messages")
  (-init-transactions [this] "Initialize transactions")
  (-begin-transaction [this] "Begin a transaction")
  (-commit-transaction [this] "Commit a transaction")
  (-abort-transaction [this] "Abort a transaction")
  (-close-producer [this] "Close the producer"))

(defprotocol IConsumer
  "Protocol for Kafka consumer operations."
  (-subscribe [this topics] "Subscribe to topics")
  (-unsubscribe [this] "Unsubscribe from all topics")
  (-assign [this partitions] "Manually assign partitions")
  (-poll [this timeout-ms] "Poll for messages")
  (-commit [this] "Commit current offsets")
  (-commit-sync [this] "Commit current offsets synchronously")
  (-commit-offsets [this offsets] "Commit specific offsets")
  (-seek [this topic partition offset] "Seek to offset")
  (-seek-to-beginning [this partitions] "Seek to beginning")
  (-seek-to-end [this partitions] "Seek to end")
  (-pause [this partitions] "Pause consumption")
  (-resume [this partitions] "Resume consumption")
  (-position [this topic partition] "Get current position")
  (-committed [this topic partition] "Get committed offset")
  (-close-consumer [this] "Close the consumer"))

(defprotocol IAdminClient
  "Protocol for Kafka admin operations."
  (-create-topics [this topics] "Create topics")
  (-delete-topics [this topics] "Delete topics")
  (-list-topics [this] "List all topics")
  (-describe-topics [this topics] "Describe topics")
  (-describe-cluster [this] "Describe the cluster")
  (-list-consumer-groups [this] "List consumer groups")
  (-describe-consumer-groups [this groups] "Describe consumer groups")
  (-delete-consumer-groups [this groups] "Delete consumer groups")
  (-alter-configs [this configs] "Alter configurations")
  (-describe-configs [this resources] "Describe configurations")
  (-close-admin [this] "Close the admin client"))

;; =============================================================================
;; Record Types
;; =============================================================================

(defrecord ProducerRecord [topic key value partition headers timestamp])

(defrecord ConsumerRecord [topic partition offset key value headers timestamp
                           leader-epoch serialized-key-size serialized-value-size])

(defrecord RecordMetadata [topic partition offset timestamp
                           serialized-key-size serialized-value-size])

(defrecord TopicPartition [topic partition])

(defrecord TopicPartitionOffset [topic partition offset])

(defn ->producer-record
  "Create a ProducerRecord.

   Usage:
     (->producer-record :my-topic \"key\" {:data \"value\"})
     (->producer-record :my-topic {:data \"value\"})
     (->producer-record {:topic :my-topic :key \"k\" :value {:data \"v\"}})"
  ([topic value]
   (->ProducerRecord (name topic) nil value nil nil nil))
  ([topic key value]
   (->ProducerRecord (name topic) key value nil nil nil))
  ([{:keys [topic key value partition headers timestamp]}]
   (->ProducerRecord (name topic) key value partition headers timestamp)))

(defn ->topic-partition
  "Create a TopicPartition.

   Usage:
     (->topic-partition :my-topic 0)"
  [topic partition]
  (->TopicPartition (name topic) partition))

(defn ->topic-partition-offset
  "Create a TopicPartitionOffset for committing.

   Usage:
     (->topic-partition-offset :my-topic 0 100)"
  [topic partition offset]
  (->TopicPartitionOffset (name topic) partition offset))

;; =============================================================================
;; Producer Implementation
;; =============================================================================

(defrecord KafkaProducer [rpc-session rpc-stub options closed?]
  IProducer
  (-send [_ record]
    (let [serialized {:topic (:topic record)
                      :key (serialize (:key record) options)
                      :value (serialize (:value record) options)
                      :partition (:partition record)
                      :headers (:headers record)
                      :timestamp (:timestamp record)}]
      (d/chain
       (capnweb/call rpc-stub :send serialized)
       (fn [result]
         (->RecordMetadata (:topic result)
                          (:partition result)
                          (:offset result)
                          (:timestamp result)
                          (:serializedKeySize result)
                          (:serializedValueSize result))))))

  (-send-sync [this record]
    @(-send this record))

  (-flush [_]
    (capnweb/call rpc-stub :flush))

  (-init-transactions [_]
    (capnweb/call rpc-stub :initTransactions))

  (-begin-transaction [_]
    (capnweb/call rpc-stub :beginTransaction))

  (-commit-transaction [_]
    (capnweb/call rpc-stub :commitTransaction))

  (-abort-transaction [_]
    (capnweb/call rpc-stub :abortTransaction))

  (-close-producer [_]
    (when (compare-and-set! closed? false true)
      (capnweb/close! rpc-session)))

  java.io.Closeable
  (close [this]
    (-close-producer this)))

;; =============================================================================
;; Consumer Implementation
;; =============================================================================

(defrecord KafkaConsumer [rpc-session rpc-stub options closed? subscriptions poll-chan-atom]
  IConsumer
  (-subscribe [_ topics]
    (reset! subscriptions (set (map name topics)))
    (capnweb/call rpc-stub :subscribe (vec @subscriptions)))

  (-unsubscribe [_]
    (reset! subscriptions #{})
    (capnweb/call rpc-stub :unsubscribe))

  (-assign [_ partitions]
    (let [tps (mapv (fn [tp] {:topic (name (:topic tp)) :partition (:partition tp)})
                    partitions)]
      (capnweb/call rpc-stub :assign tps)))

  (-poll [_ timeout-ms]
    (d/chain
     (capnweb/call rpc-stub :poll timeout-ms)
     (fn [records]
       (mapv (fn [r]
               (->ConsumerRecord (:topic r)
                                (:partition r)
                                (:offset r)
                                (deserialize (:key r) options)
                                (deserialize (:value r) options)
                                (:headers r)
                                (:timestamp r)
                                (:leaderEpoch r)
                                (:serializedKeySize r)
                                (:serializedValueSize r)))
             records))))

  (-commit [_]
    (capnweb/call rpc-stub :commitAsync))

  (-commit-sync [_]
    (capnweb/call rpc-stub :commitSync))

  (-commit-offsets [_ offsets]
    (let [offset-map (into {}
                           (map (fn [tpo]
                                  [{:topic (:topic tpo) :partition (:partition tpo)}
                                   {:offset (:offset tpo)}])
                                offsets))]
      (capnweb/call rpc-stub :commitSync offset-map)))

  (-seek [_ topic partition offset]
    (capnweb/call rpc-stub :seek {:topic (name topic) :partition partition} offset))

  (-seek-to-beginning [_ partitions]
    (let [tps (mapv (fn [tp] {:topic (name (:topic tp)) :partition (:partition tp)})
                    partitions)]
      (capnweb/call rpc-stub :seekToBeginning tps)))

  (-seek-to-end [_ partitions]
    (let [tps (mapv (fn [tp] {:topic (name (:topic tp)) :partition (:partition tp)})
                    partitions)]
      (capnweb/call rpc-stub :seekToEnd tps)))

  (-pause [_ partitions]
    (let [tps (mapv (fn [tp] {:topic (name (:topic tp)) :partition (:partition tp)})
                    partitions)]
      (capnweb/call rpc-stub :pause tps)))

  (-resume [_ partitions]
    (let [tps (mapv (fn [tp] {:topic (name (:topic tp)) :partition (:partition tp)})
                    partitions)]
      (capnweb/call rpc-stub :resume tps)))

  (-position [_ topic partition]
    (capnweb/call rpc-stub :position {:topic (name topic) :partition partition}))

  (-committed [_ topic partition]
    (d/chain
     (capnweb/call rpc-stub :committed {:topic (name topic) :partition partition})
     (fn [result]
       (when result
         {:offset (:offset result)
          :metadata (:metadata result)}))))

  (-close-consumer [_]
    (when (compare-and-set! closed? false true)
      (when-let [ch @poll-chan-atom]
        (close! ch))
      (capnweb/close! rpc-session)))

  java.io.Closeable
  (close [this]
    (-close-consumer this)))

;; =============================================================================
;; Admin Client Implementation
;; =============================================================================

(defrecord KafkaAdminClient [rpc-session rpc-stub options closed?]
  IAdminClient
  (-create-topics [_ topics]
    (let [topic-configs (mapv (fn [t]
                                (if (map? t)
                                  {:name (name (:name t))
                                   :numPartitions (:partitions t 1)
                                   :replicationFactor (:replication-factor t 1)
                                   :configs (:configs t {})}
                                  {:name (name t)
                                   :numPartitions 1
                                   :replicationFactor 1}))
                              topics)]
      (capnweb/call rpc-stub :createTopics topic-configs)))

  (-delete-topics [_ topics]
    (capnweb/call rpc-stub :deleteTopics (mapv name topics)))

  (-list-topics [_]
    (d/chain
     (capnweb/call rpc-stub :listTopics)
     (fn [result]
       (into #{} (map :name result)))))

  (-describe-topics [_ topics]
    (d/chain
     (capnweb/call rpc-stub :describeTopics (mapv name topics))
     (fn [result]
       (into {}
             (map (fn [t]
                    [(:name t)
                     {:name (:name t)
                      :partitions (mapv (fn [p]
                                          {:partition (:partition p)
                                           :leader (:leader p)
                                           :replicas (:replicas p)
                                           :isr (:isr p)})
                                        (:partitions t))
                      :internal? (:internal t false)}])
                  result)))))

  (-describe-cluster [_]
    (d/chain
     (capnweb/call rpc-stub :describeCluster)
     (fn [result]
       {:cluster-id (:clusterId result)
        :controller {:id (:id (:controller result))
                     :host (:host (:controller result))
                     :port (:port (:controller result))}
        :nodes (mapv (fn [n]
                       {:id (:id n)
                        :host (:host n)
                        :port (:port n)
                        :rack (:rack n)})
                     (:nodes result))})))

  (-list-consumer-groups [_]
    (d/chain
     (capnweb/call rpc-stub :listConsumerGroups)
     (fn [result]
       (mapv (fn [g]
               {:group-id (:groupId g)
                :protocol-type (:protocolType g)
                :state (:state g)})
             result))))

  (-describe-consumer-groups [_ groups]
    (d/chain
     (capnweb/call rpc-stub :describeConsumerGroups (vec groups))
     (fn [result]
       (into {}
             (map (fn [g]
                    [(:groupId g)
                     {:group-id (:groupId g)
                      :state (:state g)
                      :protocol-type (:protocolType g)
                      :protocol (:protocol g)
                      :members (mapv (fn [m]
                                       {:member-id (:memberId m)
                                        :client-id (:clientId m)
                                        :client-host (:clientHost m)
                                        :assignments (:assignments m)})
                                     (:members g))}])
                  result)))))

  (-delete-consumer-groups [_ groups]
    (capnweb/call rpc-stub :deleteConsumerGroups (vec groups)))

  (-alter-configs [_ configs]
    (capnweb/call rpc-stub :alterConfigs configs))

  (-describe-configs [_ resources]
    (d/chain
     (capnweb/call rpc-stub :describeConfigs resources)
     (fn [result]
       (into {}
             (map (fn [[k v]]
                    [k (into {}
                             (map (fn [[ck cv]]
                                    [ck {:value (:value cv)
                                         :default? (:default cv)
                                         :sensitive? (:sensitive cv)
                                         :read-only? (:readOnly cv)}])
                                  v))])
                  result)))))

  (-close-admin [_]
    (when (compare-and-set! closed? false true)
      (capnweb/close! rpc-session)))

  java.io.Closeable
  (close [this]
    (-close-admin this)))

;; =============================================================================
;; Public API - Producer
;; =============================================================================

(defn create-producer
  "Create a Kafka producer.

   Options:
   - :bootstrap-servers  Kafka broker addresses (required)
   - :acks               Acknowledgment mode: \"0\", \"1\", \"all\" (default: \"all\")
   - :retries            Retry attempts (default: 3)
   - :batch-size         Batch size in bytes (default: 16384)
   - :linger-ms          Batch linger time (default: 1)
   - :compression-type   Compression: \"none\", \"gzip\", \"snappy\", \"lz4\", \"zstd\"
   - :enable-idempotence Enable idempotent producer (default: true)
   - :transactional-id   Transaction ID for exactly-once semantics
   - :serializer         Key/value serializer: :json, :string, :edn, :bytes

   Usage:
     (def producer (create-producer {:bootstrap-servers \"localhost:9092\"}))
     (def producer (create-producer {:bootstrap-servers \"kafka:9092\"
                                     :compression-type \"lz4\"
                                     :transactional-id \"my-txn\"}))"
  [options]
  (let [merged-opts (merge (:producer *config*) options)
        url (str "kafka://" (:bootstrap-servers merged-opts))
        session (capnweb/connect url {:timeout-ms (:connect-timeout-ms *config*)
                                      :headers {"X-Kafka-Config" (json/generate-string merged-opts)}})
        stub (-> (capnweb/stub session) :producer)]
    (->KafkaProducer session stub merged-opts (atom false))))

(defn send!
  "Send a message to a topic.

   Returns a deferred that resolves to RecordMetadata.

   Usage:
     @(send! producer :my-topic {:user-id 123})
     @(send! producer :my-topic \"key\" {:user-id 123})
     @(send! producer {:topic :my-topic :key \"k\" :value {:data 1}})"
  ([producer topic value]
   (-send producer (->producer-record topic value)))
  ([producer topic key value]
   (-send producer (->producer-record topic key value)))
  ([producer record]
   (if (map? record)
     (-send producer (->producer-record record))
     (-send producer record))))

(defn send-sync!
  "Send a message synchronously, blocking until acknowledged.

   Usage:
     (send-sync! producer :my-topic {:user-id 123})"
  ([producer topic value]
   (-send-sync producer (->producer-record topic value)))
  ([producer topic key value]
   (-send-sync producer (->producer-record topic key value))))

(defn flush!
  "Flush any buffered messages.

   Usage:
     @(flush! producer)"
  [producer]
  (-flush producer))

(defn close-producer!
  "Close the producer.

   Usage:
     (close-producer! producer)"
  [producer]
  (-close-producer producer))

;; =============================================================================
;; Public API - Producer Transactions
;; =============================================================================

(defn init-transactions!
  "Initialize transactions for a transactional producer.

   Must be called before using transactions.

   Usage:
     @(init-transactions! producer)"
  [producer]
  (-init-transactions producer))

(defmacro with-transaction
  "Execute producer operations within a transaction.

   Automatically begins, commits, or aborts the transaction.

   Usage:
     (with-transaction producer
       @(send! producer :topic1 {:data 1})
       @(send! producer :topic2 {:data 2}))"
  [producer & body]
  `(do
     @(-begin-transaction ~producer)
     (try
       (let [result# (do ~@body)]
         @(-commit-transaction ~producer)
         result#)
       (catch Exception e#
         @(-abort-transaction ~producer)
         (throw e#)))))

;; =============================================================================
;; Public API - Consumer
;; =============================================================================

(defn create-consumer
  "Create a Kafka consumer.

   Options:
   - :bootstrap-servers   Kafka broker addresses (required)
   - :group-id            Consumer group ID (required for subscribe)
   - :auto-offset-reset   Reset behavior: \"earliest\", \"latest\" (default: \"earliest\")
   - :enable-auto-commit  Auto-commit offsets (default: false)
   - :max-poll-records    Max records per poll (default: 500)
   - :deserializer        Key/value deserializer: :json, :string, :edn, :bytes

   Usage:
     (def consumer (create-consumer {:bootstrap-servers \"localhost:9092\"
                                     :group-id \"my-group\"}))"
  [options]
  (let [merged-opts (merge (:consumer *config*) options)
        url (str "kafka://" (:bootstrap-servers merged-opts))
        session (capnweb/connect url {:timeout-ms (:connect-timeout-ms *config*)
                                      :headers {"X-Kafka-Config" (json/generate-string merged-opts)}})
        stub (-> (capnweb/stub session) :consumer)]
    (->KafkaConsumer session stub merged-opts (atom false) (atom #{}) (atom nil))))

(defn subscribe!
  "Subscribe to topics.

   Usage:
     @(subscribe! consumer [:topic1 :topic2])
     @(subscribe! consumer [\"my-topic\"])"
  [consumer topics]
  (-subscribe consumer topics))

(defn unsubscribe!
  "Unsubscribe from all topics.

   Usage:
     @(unsubscribe! consumer)"
  [consumer]
  (-unsubscribe consumer))

(defn assign!
  "Manually assign specific partitions.

   Usage:
     @(assign! consumer [(->topic-partition :my-topic 0)
                         (->topic-partition :my-topic 1)])"
  [consumer partitions]
  (-assign consumer partitions))

(defn poll!
  "Poll for messages.

   Returns a deferred that resolves to a sequence of ConsumerRecords.

   Usage:
     @(poll! consumer 1000)  ; 1 second timeout"
  ([consumer] (poll! consumer 1000))
  ([consumer timeout-ms]
   (-poll consumer timeout-ms)))

(defn poll-chan
  "Get a core.async channel that receives polled messages.

   The channel continuously polls and delivers messages until closed.

   Options:
   - :buffer-size   Channel buffer size (default: 1000)
   - :poll-timeout  Poll timeout in ms (default: 1000)

   Usage:
     (let [messages (poll-chan consumer)]
       (go-loop []
         (when-let [msg (<! messages)]
           (process msg)
           (recur))))

     ;; To stop polling, close the channel
     (close! messages)"
  ([consumer] (poll-chan consumer {}))
  ([consumer {:keys [buffer-size poll-timeout] :or {buffer-size 1000 poll-timeout 1000}}]
   (let [ch (chan buffer-size)
         running? (atom true)]
     (reset! (:poll-chan-atom consumer) ch)
     (go-loop []
       (when @running?
         (try
           (let [records @(-poll consumer poll-timeout)]
             (doseq [record records]
               (when-not (>! ch record)
                 (reset! running? false))))
           (catch Exception _e
             (<! (timeout 1000)))) ; Back off on error
         (when @running?
           (recur))))
     ;; Handle channel close
     (go
       (loop []
         (when (<! ch)
           (recur)))
       (reset! running? false))
     ch)))

(defn commit!
  "Commit current offsets asynchronously.

   Usage:
     @(commit! consumer)"
  [consumer]
  (-commit consumer))

(defn commit-sync!
  "Commit current offsets synchronously.

   Usage:
     @(commit-sync! consumer)"
  [consumer]
  (-commit-sync consumer))

(defn commit-offsets!
  "Commit specific offsets.

   Usage:
     @(commit-offsets! consumer [(->topic-partition-offset :my-topic 0 100)])"
  [consumer offsets]
  (-commit-offsets consumer offsets))

(defn seek!
  "Seek to a specific offset.

   Usage:
     @(seek! consumer :my-topic 0 100)"
  [consumer topic partition offset]
  (-seek consumer topic partition offset))

(defn seek-to-beginning!
  "Seek to the beginning of partitions.

   Usage:
     @(seek-to-beginning! consumer [(->topic-partition :my-topic 0)])"
  [consumer partitions]
  (-seek-to-beginning consumer partitions))

(defn seek-to-end!
  "Seek to the end of partitions.

   Usage:
     @(seek-to-end! consumer [(->topic-partition :my-topic 0)])"
  [consumer partitions]
  (-seek-to-end consumer partitions))

(defn pause!
  "Pause consumption of partitions.

   Usage:
     @(pause! consumer [(->topic-partition :my-topic 0)])"
  [consumer partitions]
  (-pause consumer partitions))

(defn resume!
  "Resume consumption of paused partitions.

   Usage:
     @(resume! consumer [(->topic-partition :my-topic 0)])"
  [consumer partitions]
  (-resume consumer partitions))

(defn position
  "Get the current position for a partition.

   Usage:
     @(position consumer :my-topic 0)"
  [consumer topic partition]
  (-position consumer topic partition))

(defn committed
  "Get the committed offset for a partition.

   Usage:
     @(committed consumer :my-topic 0)"
  [consumer topic partition]
  (-committed consumer topic partition))

(defn close-consumer!
  "Close the consumer.

   Usage:
     (close-consumer! consumer)"
  [consumer]
  (-close-consumer consumer))

;; =============================================================================
;; Public API - Admin Client
;; =============================================================================

(defn create-admin-client
  "Create a Kafka admin client.

   Usage:
     (def admin (create-admin-client {:bootstrap-servers \"localhost:9092\"}))"
  [options]
  (let [merged-opts (merge options)
        url (str "kafka://" (:bootstrap-servers merged-opts))
        session (capnweb/connect url {:timeout-ms (:connect-timeout-ms *config*)
                                      :headers {"X-Kafka-Config" (json/generate-string merged-opts)}})
        stub (-> (capnweb/stub session) :admin)]
    (->KafkaAdminClient session stub merged-opts (atom false))))

(defn create-topics!
  "Create topics.

   Topics can be keywords/strings (with defaults) or maps with config:
   {:name :my-topic :partitions 3 :replication-factor 2
    :configs {:retention.ms 86400000}}

   Usage:
     @(create-topics! admin [:topic1 :topic2])
     @(create-topics! admin [{:name :my-topic :partitions 6}])"
  [admin topics]
  (-create-topics admin topics))

(defn delete-topics!
  "Delete topics.

   Usage:
     @(delete-topics! admin [:topic1 :topic2])"
  [admin topics]
  (-delete-topics admin topics))

(defn list-topics
  "List all topics.

   Usage:
     @(list-topics admin)"
  [admin]
  (-list-topics admin))

(defn describe-topics
  "Describe topics.

   Usage:
     @(describe-topics admin [:my-topic])"
  [admin topics]
  (-describe-topics admin topics))

(defn describe-cluster
  "Describe the Kafka cluster.

   Usage:
     @(describe-cluster admin)"
  [admin]
  (-describe-cluster admin))

(defn list-consumer-groups
  "List all consumer groups.

   Usage:
     @(list-consumer-groups admin)"
  [admin]
  (-list-consumer-groups admin))

(defn describe-consumer-groups
  "Describe consumer groups.

   Usage:
     @(describe-consumer-groups admin [\"my-group\"])"
  [admin groups]
  (-describe-consumer-groups admin groups))

(defn delete-consumer-groups!
  "Delete consumer groups.

   Usage:
     @(delete-consumer-groups! admin [\"old-group\"])"
  [admin groups]
  (-delete-consumer-groups admin groups))

(defn close-admin!
  "Close the admin client.

   Usage:
     (close-admin! admin)"
  [admin]
  (-close-admin admin))

;; =============================================================================
;; Kafka Streams DSL
;; =============================================================================

(defprotocol IStreamBuilder
  "Protocol for stream builder operations."
  (-stream [this topic] "Create a stream from a topic")
  (-table [this topic] "Create a table from a topic")
  (-global-table [this topic] "Create a global table")
  (-build [this] "Build the topology"))

(defprotocol IKStream
  "Protocol for KStream operations."
  (-filter-stream [this pred] "Filter records")
  (-map-stream [this f] "Map over records")
  (-map-values-stream [this f] "Map over values")
  (-flat-map-stream [this f] "Flat map over records")
  (-flat-map-values-stream [this f] "Flat map over values")
  (-select-key-stream [this f] "Select a new key")
  (-group-by-key-stream [this] "Group by key")
  (-group-by-stream [this f] "Group by custom key")
  (-join-stream [this other f window] "Join with another stream")
  (-left-join-stream [this other f window] "Left join with another stream")
  (-branch-stream [this preds] "Branch into multiple streams")
  (-merge-stream [this other] "Merge with another stream")
  (-to-stream [this topic] "Write to a topic")
  (-peek-stream [this f] "Peek at records")
  (-through-stream [this topic] "Write to topic and continue"))

(defprotocol IKTable
  "Protocol for KTable operations."
  (-filter-table [this pred] "Filter records")
  (-map-values-table [this f] "Map over values")
  (-join-table [this other f] "Join with another table")
  (-left-join-table [this other f] "Left join with another table")
  (-outer-join-table [this other f] "Outer join with another table")
  (-to-stream-table [this] "Convert to stream")
  (-group-by-table [this f] "Group by custom key"))

(defprotocol IKGroupedStream
  "Protocol for grouped stream operations."
  (-count-grouped [this] "Count records")
  (-reduce-grouped [this reducer] "Reduce records")
  (-aggregate-grouped [this init aggregator] "Aggregate records")
  (-windowed-by-grouped [this window] "Apply windowing"))

;; Stream implementation records
(defrecord StreamBuilder [operations]
  IStreamBuilder
  (-stream [_ topic]
    (->KStreamImpl [{:op :source :topic (name topic)}]))

  (-table [_ topic]
    (->KTableImpl [{:op :table-source :topic (name topic)}]))

  (-global-table [_ topic]
    (->KTableImpl [{:op :global-table-source :topic (name topic)}]))

  (-build [_]
    operations))

(defrecord KStreamImpl [operations]
  IKStream
  (-filter-stream [_ pred]
    (->KStreamImpl (conj operations {:op :filter :predicate (pr-str pred)})))

  (-map-stream [_ f]
    (->KStreamImpl (conj operations {:op :map :mapper (pr-str f)})))

  (-map-values-stream [_ f]
    (->KStreamImpl (conj operations {:op :map-values :mapper (pr-str f)})))

  (-flat-map-stream [_ f]
    (->KStreamImpl (conj operations {:op :flat-map :mapper (pr-str f)})))

  (-flat-map-values-stream [_ f]
    (->KStreamImpl (conj operations {:op :flat-map-values :mapper (pr-str f)})))

  (-select-key-stream [_ f]
    (->KStreamImpl (conj operations {:op :select-key :selector (pr-str f)})))

  (-group-by-key-stream [_]
    (->KGroupedStreamImpl operations))

  (-group-by-stream [_ f]
    (->KGroupedStreamImpl (conj operations {:op :group-by :selector (pr-str f)})))

  (-join-stream [_ other f window]
    (->KStreamImpl (conj operations {:op :join
                                     :other (:operations other)
                                     :joiner (pr-str f)
                                     :window window})))

  (-left-join-stream [_ other f window]
    (->KStreamImpl (conj operations {:op :left-join
                                     :other (:operations other)
                                     :joiner (pr-str f)
                                     :window window})))

  (-branch-stream [_ preds]
    (mapv (fn [pred]
            (->KStreamImpl (conj operations {:op :branch :predicate (pr-str pred)})))
          preds))

  (-merge-stream [_ other]
    (->KStreamImpl (conj operations {:op :merge :other (:operations other)})))

  (-to-stream [_ topic]
    {:topology (conj operations {:op :to :topic (name topic)})})

  (-peek-stream [_ f]
    (->KStreamImpl (conj operations {:op :peek :action (pr-str f)})))

  (-through-stream [_ topic]
    (->KStreamImpl (conj operations {:op :through :topic (name topic)}))))

(defrecord KTableImpl [operations]
  IKTable
  (-filter-table [_ pred]
    (->KTableImpl (conj operations {:op :filter :predicate (pr-str pred)})))

  (-map-values-table [_ f]
    (->KTableImpl (conj operations {:op :map-values :mapper (pr-str f)})))

  (-join-table [_ other f]
    (->KTableImpl (conj operations {:op :join
                                    :other (:operations other)
                                    :joiner (pr-str f)})))

  (-left-join-table [_ other f]
    (->KTableImpl (conj operations {:op :left-join
                                    :other (:operations other)
                                    :joiner (pr-str f)})))

  (-outer-join-table [_ other f]
    (->KTableImpl (conj operations {:op :outer-join
                                    :other (:operations other)
                                    :joiner (pr-str f)})))

  (-to-stream-table [_]
    (->KStreamImpl operations))

  (-group-by-table [_ f]
    (->KGroupedStreamImpl (conj operations {:op :group-by :selector (pr-str f)}))))

(defrecord KGroupedStreamImpl [operations]
  IKGroupedStream
  (-count-grouped [_]
    (->KTableImpl (conj operations {:op :count})))

  (-reduce-grouped [_ reducer]
    (->KTableImpl (conj operations {:op :reduce :reducer (pr-str reducer)})))

  (-aggregate-grouped [_ init aggregator]
    (->KTableImpl (conj operations {:op :aggregate
                                    :initializer (pr-str init)
                                    :aggregator (pr-str aggregator)})))

  (-windowed-by-grouped [_ window]
    (->KGroupedStreamImpl (conj operations {:op :windowed-by :window window}))))

;; =============================================================================
;; Public API - Streams DSL
;; =============================================================================

(defn stream-builder
  "Create a new stream builder.

   Usage:
     (def builder (stream-builder))"
  []
  (->StreamBuilder []))

(defn stream
  "Create a KStream from a topic.

   Usage:
     (-> (stream-builder) (stream :my-topic))"
  [builder topic]
  (-stream builder topic))

(defn table
  "Create a KTable from a compacted topic.

   Usage:
     (-> (stream-builder) (table :my-table-topic))"
  [builder topic]
  (-table builder topic))

(defn global-table
  "Create a GlobalKTable from a compacted topic.

   Usage:
     (-> (stream-builder) (global-table :config-topic))"
  [builder topic]
  (-global-table builder topic))

;; Stream operations
(defn sfilter
  "Filter stream records.

   Usage:
     (-> stream (sfilter (fn [k v] (pos? (:amount v)))))"
  [stream pred]
  (-filter-stream stream pred))

(defn smap
  "Map over stream records.

   Usage:
     (-> stream (smap (fn [k v] [(str k) (assoc v :processed true)])))"
  [stream f]
  (-map-stream stream f))

(defn map-values
  "Map over stream values.

   Usage:
     (-> stream (map-values (fn [v] (assoc v :timestamp (System/currentTimeMillis)))))"
  [stream f]
  (-map-values-stream stream f))

(defn flat-map
  "Flat map over stream records.

   Usage:
     (-> stream (flat-map (fn [k v] [[k v] [(str k \"-copy\") v]])))"
  [stream f]
  (-flat-map-stream stream f))

(defn flat-map-values
  "Flat map over stream values.

   Usage:
     (-> stream (flat-map-values (fn [v] [v (update v :count inc)])))"
  [stream f]
  (-flat-map-values-stream stream f))

(defn select-key
  "Select a new key for stream records.

   Usage:
     (-> stream (select-key (fn [k v] (:user-id v))))"
  [stream f]
  (-select-key-stream stream f))

(defn group-by-key
  "Group stream by existing key.

   Usage:
     (-> stream group-by-key)"
  [stream]
  (-group-by-key-stream stream))

(defn group-by
  "Group stream by a new key.

   Usage:
     (-> stream (group-by (fn [k v] (:category v))))"
  [stream f]
  (-group-by-stream stream f))

(defn join-streams
  "Join two streams within a window.

   Usage:
     (-> stream1 (join-streams stream2
                               (fn [v1 v2] (merge v1 v2))
                               {:type :tumbling :size-ms 60000}))"
  [stream other f window]
  (-join-stream stream other f window))

(defn left-join-streams
  "Left join two streams within a window.

   Usage:
     (-> stream1 (left-join-streams stream2
                                    (fn [v1 v2] (assoc v1 :other v2))
                                    {:type :tumbling :size-ms 60000}))"
  [stream other f window]
  (-left-join-stream stream other f window))

(defn branch
  "Branch a stream into multiple streams based on predicates.

   Usage:
     (let [[high low] (branch stream
                              [(fn [k v] (> (:priority v) 5))
                               (fn [k v] (<= (:priority v) 5))])]
       ...)"
  [stream preds]
  (-branch-stream stream preds))

(defn merge-streams
  "Merge two streams.

   Usage:
     (-> stream1 (merge-streams stream2))"
  [stream other]
  (-merge-stream stream other))

(defn to
  "Write stream to a topic (terminal operation).

   Usage:
     (-> stream (to :output-topic))"
  [stream topic]
  (-to-stream stream topic))

(defn peek
  "Peek at stream records without modifying.

   Usage:
     (-> stream (peek (fn [k v] (println \"Processing:\" k))))"
  [stream f]
  (-peek-stream stream f))

(defn through
  "Write to a topic and continue processing.

   Usage:
     (-> stream (through :intermediate-topic) ...)"
  [stream topic]
  (-through-stream stream topic))

;; Grouped stream operations
(defn scount
  "Count records in a grouped stream.

   Usage:
     (-> stream group-by-key scount)"
  [grouped-stream]
  (-count-grouped grouped-stream))

(defn sreduce
  "Reduce records in a grouped stream.

   Usage:
     (-> stream group-by-key (sreduce (fn [agg new] (+ agg (:amount new)))))"
  [grouped-stream reducer]
  (-reduce-grouped grouped-stream reducer))

(defn aggregate
  "Aggregate records in a grouped stream.

   Usage:
     (-> stream
         group-by-key
         (aggregate {:count 0 :sum 0}
                    (fn [agg k v]
                      (-> agg
                          (update :count inc)
                          (update :sum + (:amount v))))))"
  [grouped-stream init aggregator]
  (-aggregate-grouped grouped-stream init aggregator))

(defn windowed-by
  "Apply windowing to a grouped stream.

   Window types:
   - {:type :tumbling :size-ms 60000}
   - {:type :hopping :size-ms 60000 :advance-ms 10000}
   - {:type :sliding :difference-ms 10000}
   - {:type :session :inactivity-gap-ms 30000}

   Usage:
     (-> stream
         group-by-key
         (windowed-by {:type :tumbling :size-ms 60000})
         scount)"
  [grouped-stream window]
  (-windowed-by-grouped grouped-stream window))

;; Table operations
(defn tfilter
  "Filter table records.

   Usage:
     (-> table (tfilter (fn [k v] (:active v))))"
  [table pred]
  (-filter-table table pred))

(defn tmap-values
  "Map over table values.

   Usage:
     (-> table (tmap-values (fn [v] (select-keys v [:id :name]))))"
  [table f]
  (-map-values-table table f))

(defn join-tables
  "Join two tables.

   Usage:
     (-> table1 (join-tables table2 (fn [v1 v2] (merge v1 v2))))"
  [table other f]
  (-join-table table other f))

(defn left-join-tables
  "Left join two tables.

   Usage:
     (-> table1 (left-join-tables table2 (fn [v1 v2] (assoc v1 :other v2))))"
  [table other f]
  (-left-join-table table other f))

(defn outer-join-tables
  "Outer join two tables.

   Usage:
     (-> table1 (outer-join-tables table2 (fn [v1 v2] {:left v1 :right v2})))"
  [table other f]
  (-outer-join-table table other f))

(defn to-stream
  "Convert a table to a stream.

   Usage:
     (-> table to-stream (to :output-topic))"
  [table]
  (-to-stream-table table))

;; =============================================================================
;; Public API - Running Streams Applications
;; =============================================================================

(defrecord KafkaStreamsApp [rpc-session rpc-stub topology options running?])

(defn start-streams
  "Start a Kafka Streams application.

   Options:
   - :application-id         Application ID (required)
   - :bootstrap-servers      Kafka broker addresses (required)
   - :processing-guarantee   \"at_least_once\", \"exactly_once_v2\" (default)
   - :num-stream-threads     Number of processing threads (default: 1)
   - :state-dir              State store directory
   - :cache-max-bytes        Cache size for buffering (default: 10MB)

   Usage:
     (def topology
       (-> (stream-builder)
           (stream :input)
           (map-values (fn [v] (assoc v :processed true)))
           (to :output)))

     (def app (start-streams topology
                             {:application-id \"my-app\"
                              :bootstrap-servers \"localhost:9092\"}))"
  [topology options]
  (let [merged-opts (merge (:streams *config*) options)
        url (str "kafka://" (:bootstrap-servers merged-opts))
        session (capnweb/connect url {:timeout-ms (:connect-timeout-ms *config*)
                                      :headers {"X-Kafka-Config" (json/generate-string merged-opts)}})
        stub (-> (capnweb/stub session) :streams)
        app (->KafkaStreamsApp session stub (:topology topology) merged-opts (atom true))]
    ;; Start the streams application
    @(capnweb/call stub :start (:topology topology) merged-opts)
    app))

(defn streams-state
  "Get the current state of a streams application.

   Returns one of: :created, :rebalancing, :running, :pending-shutdown, :not-running, :error

   Usage:
     (streams-state app)"
  [app]
  (keyword @(capnweb/call (:rpc-stub app) :state)))

(defn streams-metrics
  "Get metrics from a streams application.

   Usage:
     @(streams-metrics app)"
  [app]
  (capnweb/call (:rpc-stub app) :metrics))

(defn stop-streams!
  "Stop a streams application.

   Usage:
     (stop-streams! app)"
  [app]
  (when (compare-and-set! (:running? app) true false)
    @(capnweb/call (:rpc-stub app) :close)
    (capnweb/close! (:rpc-session app))))

;; =============================================================================
;; Utility Macros
;; =============================================================================

(defmacro with-producer
  "Execute body with a producer, automatically closing it.

   Usage:
     (with-producer [p {:bootstrap-servers \"localhost:9092\"}]
       @(send! p :my-topic {:data 1}))"
  [[producer-sym options] & body]
  `(let [~producer-sym (create-producer ~options)]
     (try
       ~@body
       (finally
         (close-producer! ~producer-sym)))))

(defmacro with-consumer
  "Execute body with a consumer, automatically closing it.

   Usage:
     (with-consumer [c {:bootstrap-servers \"localhost:9092\"
                        :group-id \"my-group\"}]
       @(subscribe! c [:my-topic])
       (process-messages c))"
  [[consumer-sym options] & body]
  `(let [~consumer-sym (create-consumer ~options)]
     (try
       ~@body
       (finally
         (close-consumer! ~consumer-sym)))))

(defmacro with-admin
  "Execute body with an admin client, automatically closing it.

   Usage:
     (with-admin [admin {:bootstrap-servers \"localhost:9092\"}]
       @(create-topics! admin [:new-topic]))"
  [[admin-sym options] & body]
  `(let [~admin-sym (create-admin-client ~options)]
     (try
       ~@body
       (finally
         (close-admin! ~admin-sym)))))
