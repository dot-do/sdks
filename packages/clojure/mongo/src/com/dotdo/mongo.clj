(ns com.dotdo.mongo
  "DotDo MongoDB SDK - MongoDB operations with RPC pipelining and change streams.

   This module provides a Clojure-idiomatic MongoDB client built on DotDo RPC:
   - Full MongoDB query and command support via pipelining
   - Change streams with core.async integration
   - Connection pooling with automatic retry
   - Thread-safe, immutable client design

   Key concepts:
   - Collections are accessed through keywords: (-> db :users)
   - Queries use Clojure data structures that map to MongoDB query operators
   - All I/O returns deferreds or core.async channels
   - Change streams integrate naturally with go blocks

   Example:
     (def client (connect \"mongodb://localhost:27017\"))
     (def db (database client :mydb))

     ;; Find documents
     @(-> db :users (find {:active true}))

     ;; Insert with pipelining
     @(-> db :users (insert-one {:name \"Alice\" :email \"alice@example.com\"}))

     ;; Aggregation pipeline
     @(-> db :orders
          (aggregate [{:$match {:status \"completed\"}}
                      {:$group {:_id \"$customer_id\" :total {:$sum \"$amount\"}}}]))

     ;; Change streams
     (let [changes (watch db :users)]
       (go-loop []
         (when-let [event (<! changes)]
           (println \"Change:\" event)
           (recur))))"
  (:require [com.dotdo.core :as dotdo]
            [com.dotdo.capnweb :as capnweb]
            [clojure.core.async :as async :refer [go go-loop <! >! chan close! timeout]]
            [manifold.deferred :as d]
            [cheshire.core :as json]
            [clojure.spec.alpha :as s])
  (:import [java.util UUID Date]
           [java.time Instant]
           [java.util.concurrent.atomic AtomicLong AtomicReference]))

;; =============================================================================
;; Specs for Validation
;; =============================================================================

(s/def ::non-empty-string (s/and string? #(pos? (count %))))
(s/def ::database-name ::non-empty-string)
(s/def ::collection-name ::non-empty-string)
(s/def ::document map?)
(s/def ::documents (s/coll-of ::document))
(s/def ::filter map?)
(s/def ::projection (s/or :map map? :vec vector?))
(s/def ::sort map?)
(s/def ::limit pos-int?)
(s/def ::skip nat-int?)

(s/def ::find-options
  (s/keys :opt-un [::projection ::sort ::limit ::skip]))

(s/def ::update-options
  (s/keys :opt-un [::upsert ::array-filters]))

;; =============================================================================
;; ObjectId Type
;; =============================================================================

(defrecord ObjectId [^String id]
  Object
  (toString [_] id))

(defn object-id
  "Create an ObjectId from a hex string or generate a new one."
  ([] (->ObjectId (str (UUID/randomUUID))))
  ([s] (->ObjectId s)))

(defn object-id?
  "Check if value is an ObjectId."
  [x]
  (instance? ObjectId x))

(defn ->object-id
  "Coerce value to ObjectId if it's a string that looks like one."
  [x]
  (cond
    (object-id? x) x
    (and (string? x) (= 24 (count x))) (->ObjectId x)
    :else x))

;; =============================================================================
;; BSON Serialization
;; =============================================================================

(defn- serialize-value
  "Serialize a Clojure value for MongoDB."
  [v]
  (cond
    (object-id? v) {:$oid (:id v)}
    (inst? v) {:$date (.toEpochMilli (Instant/ofEpochMilli (.getTime ^Date v)))}
    (instance? Instant v) {:$date (.toEpochMilli ^Instant v)}
    (uuid? v) {:$uuid (str v)}
    (keyword? v) (name v)
    (symbol? v) (str v)
    (map? v) (into {} (map (fn [[k val]] [(serialize-value k) (serialize-value val)]) v))
    (sequential? v) (mapv serialize-value v)
    (set? v) (mapv serialize-value v)
    :else v))

(defn- deserialize-value
  "Deserialize a MongoDB value to Clojure."
  [v]
  (cond
    (and (map? v) (contains? v :$oid)) (->ObjectId (:$oid v))
    (and (map? v) (contains? v "$oid")) (->ObjectId (get v "$oid"))
    (and (map? v) (contains? v :$date)) (Date. (long (:$date v)))
    (and (map? v) (contains? v "$date")) (Date. (long (get v "$date")))
    (and (map? v) (contains? v :$uuid)) (UUID/fromString (:$uuid v))
    (and (map? v) (contains? v "$uuid")) (UUID/fromString (get v "$uuid"))
    (map? v) (into {} (map (fn [[k val]] [(keyword k) (deserialize-value val)]) v))
    (sequential? v) (mapv deserialize-value v)
    :else v))

;; =============================================================================
;; Protocol Definitions
;; =============================================================================

(defprotocol IMongoClient
  "Protocol for MongoDB client operations."
  (-database [this name] "Get a database by name")
  (-list-databases [this] "List all databases")
  (-admin [this] "Get admin database for administrative commands")
  (-close [this] "Close the client and release resources"))

(defprotocol IDatabase
  "Protocol for database operations."
  (-collection [this name] "Get a collection by name")
  (-list-collections [this] "List all collections")
  (-create-collection [this name options] "Create a new collection")
  (-drop-collection [this name] "Drop a collection")
  (-run-command [this command] "Run a database command")
  (-client [this] "Get the parent client"))

(defprotocol ICollection
  "Protocol for collection operations."
  (-find [this filter options] "Find documents")
  (-find-one [this filter options] "Find a single document")
  (-insert-one [this document options] "Insert one document")
  (-insert-many [this documents options] "Insert multiple documents")
  (-update-one [this filter update options] "Update one document")
  (-update-many [this filter update options] "Update multiple documents")
  (-replace-one [this filter replacement options] "Replace one document")
  (-delete-one [this filter options] "Delete one document")
  (-delete-many [this filter options] "Delete multiple documents")
  (-count-documents [this filter] "Count matching documents")
  (-aggregate [this pipeline options] "Run aggregation pipeline")
  (-distinct [this field filter] "Get distinct values for field")
  (-create-index [this keys options] "Create an index")
  (-drop-index [this name] "Drop an index")
  (-list-indexes [this] "List all indexes")
  (-watch [this pipeline options] "Watch for changes")
  (-database-ref [this] "Get the parent database"))

;; =============================================================================
;; Configuration
;; =============================================================================

(def ^:dynamic *config*
  "Default configuration for MongoDB clients."
  {:default-url "mongodb://localhost:27017"
   :connect-timeout-ms 10000
   :request-timeout-ms 30000
   :max-pool-size 10
   :min-pool-size 1
   :max-retries 3
   :retry-base-delay-ms 100
   :retry-max-delay-ms 5000
   :read-preference :primary
   :write-concern :majority
   :read-concern :local})

(defn configure!
  "Set global MongoDB configuration.

   Usage:
     (configure! {:max-pool-size 20
                  :write-concern :w1})"
  [config]
  (alter-var-root #'*config* merge config))

;; =============================================================================
;; Collection Implementation
;; =============================================================================

(defrecord Collection [database name rpc-stub]
  ICollection
  (-find [_ filter options]
    (let [query {:filter (serialize-value filter)
                 :projection (:projection options)
                 :sort (:sort options)
                 :limit (:limit options)
                 :skip (:skip options)}
          query (into {} (filter (fn [[_ v]] (some? v)) query))]
      (d/chain
       (capnweb/call rpc-stub :find query)
       (fn [result]
         (mapv deserialize-value result)))))

  (-find-one [_ filter options]
    (let [query {:filter (serialize-value filter)
                 :projection (:projection options)}
          query (into {} (filter (fn [[_ v]] (some? v)) query))]
      (d/chain
       (capnweb/call rpc-stub :findOne query)
       deserialize-value)))

  (-insert-one [_ document options]
    (let [doc (serialize-value document)]
      (d/chain
       (capnweb/call rpc-stub :insertOne doc options)
       (fn [result]
         {:acknowledged true
          :inserted-id (deserialize-value (:insertedId result))}))))

  (-insert-many [_ documents options]
    (let [docs (mapv serialize-value documents)]
      (d/chain
       (capnweb/call rpc-stub :insertMany docs options)
       (fn [result]
         {:acknowledged true
          :inserted-ids (mapv deserialize-value (:insertedIds result))
          :inserted-count (count (:insertedIds result))}))))

  (-update-one [_ filter update options]
    (let [query {:filter (serialize-value filter)
                 :update (serialize-value update)
                 :upsert (:upsert options false)
                 :array-filters (:array-filters options)}
          query (into {} (filter (fn [[_ v]] (some? v)) query))]
      (d/chain
       (capnweb/call rpc-stub :updateOne query)
       (fn [result]
         {:acknowledged true
          :matched-count (:matchedCount result 0)
          :modified-count (:modifiedCount result 0)
          :upserted-id (when-let [id (:upsertedId result)]
                         (deserialize-value id))}))))

  (-update-many [_ filter update options]
    (let [query {:filter (serialize-value filter)
                 :update (serialize-value update)
                 :upsert (:upsert options false)
                 :array-filters (:array-filters options)}
          query (into {} (filter (fn [[_ v]] (some? v)) query))]
      (d/chain
       (capnweb/call rpc-stub :updateMany query)
       (fn [result]
         {:acknowledged true
          :matched-count (:matchedCount result 0)
          :modified-count (:modifiedCount result 0)}))))

  (-replace-one [_ filter replacement options]
    (let [query {:filter (serialize-value filter)
                 :replacement (serialize-value replacement)
                 :upsert (:upsert options false)}]
      (d/chain
       (capnweb/call rpc-stub :replaceOne query)
       (fn [result]
         {:acknowledged true
          :matched-count (:matchedCount result 0)
          :modified-count (:modifiedCount result 0)
          :upserted-id (when-let [id (:upsertedId result)]
                         (deserialize-value id))}))))

  (-delete-one [_ filter options]
    (d/chain
     (capnweb/call rpc-stub :deleteOne (serialize-value filter) options)
     (fn [result]
       {:acknowledged true
        :deleted-count (:deletedCount result 0)})))

  (-delete-many [_ filter options]
    (d/chain
     (capnweb/call rpc-stub :deleteMany (serialize-value filter) options)
     (fn [result]
       {:acknowledged true
        :deleted-count (:deletedCount result 0)})))

  (-count-documents [_ filter]
    (capnweb/call rpc-stub :countDocuments (serialize-value filter)))

  (-aggregate [_ pipeline options]
    (d/chain
     (capnweb/call rpc-stub :aggregate (mapv serialize-value pipeline) options)
     (fn [result]
       (mapv deserialize-value result))))

  (-distinct [_ field filter]
    (capnweb/call rpc-stub :distinct (name field) (serialize-value filter)))

  (-create-index [_ keys options]
    (capnweb/call rpc-stub :createIndex (serialize-value keys) options))

  (-drop-index [_ index-name]
    (capnweb/call rpc-stub :dropIndex index-name))

  (-list-indexes [_]
    (d/chain
     (capnweb/call rpc-stub :listIndexes)
     (fn [result]
       (mapv deserialize-value result))))

  (-watch [_ pipeline options]
    (let [ch (chan (:buffer-size options 100))
          change-stream (capnweb/call rpc-stub :watch
                                      (mapv serialize-value pipeline)
                                      options)]
      ;; Set up streaming from RPC to channel
      (go-loop []
        (let [event (<! change-stream)]
          (if event
            (do
              (>! ch (deserialize-value event))
              (recur))
            (close! ch))))
      ch))

  (-database-ref [_]
    database)

  clojure.lang.ILookup
  (valAt [this key]
    (.valAt this key nil))
  (valAt [_ key _not-found]
    ;; Return sub-collection for nested paths
    (->Collection database (str name "." (clojure.core/name key))
                  (get rpc-stub key))))

;; =============================================================================
;; Database Implementation
;; =============================================================================

(defrecord Database [client name rpc-stub]
  IDatabase
  (-collection [_ coll-name]
    (let [coll-stub (get rpc-stub (keyword coll-name))]
      (->Collection _ (clojure.core/name coll-name) coll-stub)))

  (-list-collections [_]
    (d/chain
     (capnweb/call rpc-stub :listCollections)
     (fn [result]
       (mapv :name result))))

  (-create-collection [_ coll-name options]
    (capnweb/call rpc-stub :createCollection (clojure.core/name coll-name) options))

  (-drop-collection [_ coll-name]
    (capnweb/call rpc-stub :dropCollection (clojure.core/name coll-name)))

  (-run-command [_ command]
    (d/chain
     (capnweb/call rpc-stub :runCommand (serialize-value command))
     deserialize-value))

  (-client [_]
    client)

  clojure.lang.ILookup
  (valAt [this key]
    (.valAt this key nil))
  (valAt [this key _not-found]
    (-collection this key)))

;; =============================================================================
;; Client Implementation
;; =============================================================================

(defrecord MongoClient [url rpc-session rpc-stub options]
  IMongoClient
  (-database [_ db-name]
    (let [db-stub (get rpc-stub (keyword db-name))]
      (->Database _ (clojure.core/name db-name) db-stub)))

  (-list-databases [_]
    (d/chain
     (capnweb/call rpc-stub :listDatabases)
     (fn [result]
       (mapv (fn [db]
               {:name (:name db)
                :size-on-disk (:sizeOnDisk db)
                :empty? (:empty db)})
             result))))

  (-admin [_]
    (-database _ "admin"))

  (-close [_]
    (when rpc-session
      (capnweb/close! rpc-session)))

  clojure.lang.ILookup
  (valAt [this key]
    (.valAt this key nil))
  (valAt [this key _not-found]
    (-database this key))

  java.io.Closeable
  (close [this]
    (-close this)))

;; =============================================================================
;; Public API - Connection
;; =============================================================================

(defn connect
  "Connect to a MongoDB server.

   Options:
   - :connect-timeout-ms  Connection timeout (default: 10000)
   - :request-timeout-ms  Request timeout (default: 30000)
   - :max-pool-size       Maximum connections (default: 10)
   - :read-preference     :primary, :secondary, :nearest (default: :primary)
   - :write-concern       :w1, :majority, :unacknowledged (default: :majority)
   - :read-concern        :local, :majority, :linearizable (default: :local)
   - :auth                {:username \"user\" :password \"pass\" :source \"admin\"}

   Usage:
     (def client (connect \"mongodb://localhost:27017\"))
     (def client (connect \"mongodb://localhost\" {:max-pool-size 20}))"
  ([url] (connect url {}))
  ([url options]
   (let [merged-opts (merge *config* options)
         session (capnweb/connect url {:timeout-ms (:connect-timeout-ms merged-opts)
                                       :headers (when-let [auth (:auth merged-opts)]
                                                  {"X-MongoDB-Auth" (json/generate-string auth)})})
         stub (capnweb/stub session)]
     (->MongoClient url session stub merged-opts))))

(defn close!
  "Close a MongoDB client connection."
  [client]
  (-close client))

;; =============================================================================
;; Public API - Database
;; =============================================================================

(defn database
  "Get a database from a client.

   Usage:
     (def db (database client :mydb))
     (def db (database client \"mydb\"))"
  [client db-name]
  (-database client db-name))

(defn list-databases
  "List all databases on the server.

   Usage:
     @(list-databases client)"
  [client]
  (-list-databases client))

;; =============================================================================
;; Public API - Collection
;; =============================================================================

(defn collection
  "Get a collection from a database.

   Usage:
     (def coll (collection db :users))
     ;; Or using keyword access:
     (def coll (:users db))"
  [database coll-name]
  (-collection database coll-name))

(defn list-collections
  "List all collections in a database.

   Usage:
     @(list-collections db)"
  [database]
  (-list-collections database))

;; =============================================================================
;; Public API - CRUD Operations
;; =============================================================================

(defn find
  "Find documents in a collection.

   Options:
   - :projection  Fields to include/exclude {:name 1 :_id 0}
   - :sort        Sort order {:created-at -1}
   - :limit       Maximum documents to return
   - :skip        Number of documents to skip

   Usage:
     @(find coll {:active true})
     @(find coll {:age {:$gt 21}} {:sort {:age 1} :limit 10})
     @(-> db :users (find {:role \"admin\"}))"
  ([coll] (find coll {}))
  ([coll filter] (find coll filter {}))
  ([coll filter options]
   (-find coll filter options)))

(defn find-one
  "Find a single document in a collection.

   Usage:
     @(find-one coll {:_id (object-id \"...\")})
     @(find-one coll {:email \"alice@example.com\"} {:projection {:password 0}})"
  ([coll filter] (find-one coll filter {}))
  ([coll filter options]
   (-find-one coll filter options)))

(defn find-by-id
  "Find a document by its _id field.

   Usage:
     @(find-by-id coll \"507f1f77bcf86cd799439011\")"
  ([coll id] (find-by-id coll id {}))
  ([coll id options]
   (-find-one coll {:_id (->object-id id)} options)))

(defn insert-one
  "Insert a single document.

   Returns {:acknowledged true :inserted-id <ObjectId>}

   Usage:
     @(insert-one coll {:name \"Alice\" :email \"alice@example.com\"})"
  ([coll document] (insert-one coll document {}))
  ([coll document options]
   (-insert-one coll document options)))

(defn insert-many
  "Insert multiple documents.

   Returns {:acknowledged true :inserted-ids [...] :inserted-count n}

   Usage:
     @(insert-many coll [{:name \"Alice\"} {:name \"Bob\"}])"
  ([coll documents] (insert-many coll documents {}))
  ([coll documents options]
   (-insert-many coll documents options)))

(defn update-one
  "Update a single document.

   Options:
   - :upsert        Insert if no match (default: false)
   - :array-filters Filters for array updates

   Returns {:matched-count n :modified-count n :upserted-id <ObjectId or nil>}

   Usage:
     @(update-one coll {:_id id} {:$set {:status \"active\"}})
     @(update-one coll {:email \"alice@example.com\"} {:$inc {:login-count 1}})"
  ([coll filter update] (update-one coll filter update {}))
  ([coll filter update options]
   (-update-one coll filter update options)))

(defn update-many
  "Update multiple documents.

   Usage:
     @(update-many coll {:status \"pending\"} {:$set {:status \"processed\"}})"
  ([coll filter update] (update-many coll filter update {}))
  ([coll filter update options]
   (-update-many coll filter update options)))

(defn replace-one
  "Replace a single document.

   Usage:
     @(replace-one coll {:_id id} new-document)"
  ([coll filter replacement] (replace-one coll filter replacement {}))
  ([coll filter replacement options]
   (-replace-one coll filter replacement options)))

(defn delete-one
  "Delete a single document.

   Usage:
     @(delete-one coll {:_id id})"
  ([coll filter] (delete-one coll filter {}))
  ([coll filter options]
   (-delete-one coll filter options)))

(defn delete-many
  "Delete multiple documents.

   Usage:
     @(delete-many coll {:status \"expired\"})"
  ([coll filter] (delete-many coll filter {}))
  ([coll filter options]
   (-delete-many coll filter options)))

(defn count-documents
  "Count documents matching a filter.

   Usage:
     @(count-documents coll {:active true})"
  ([coll] (count-documents coll {}))
  ([coll filter]
   (-count-documents coll filter)))

;; =============================================================================
;; Public API - Aggregation
;; =============================================================================

(defn aggregate
  "Run an aggregation pipeline.

   Usage:
     @(aggregate coll [{:$match {:status \"completed\"}}
                       {:$group {:_id \"$category\"
                                 :total {:$sum \"$amount\"}}}
                       {:$sort {:total -1}}])"
  ([coll pipeline] (aggregate coll pipeline {}))
  ([coll pipeline options]
   (-aggregate coll pipeline options)))

(defn distinct-values
  "Get distinct values for a field.

   Usage:
     @(distinct-values coll :category)
     @(distinct-values coll :category {:status \"active\"})"
  ([coll field] (distinct-values coll field {}))
  ([coll field filter]
   (-distinct coll field filter)))

;; =============================================================================
;; Public API - Indexes
;; =============================================================================

(defn create-index
  "Create an index on a collection.

   Options:
   - :unique      Unique constraint (default: false)
   - :sparse      Sparse index (default: false)
   - :name        Custom index name
   - :expire-after-seconds  TTL index expiration

   Usage:
     @(create-index coll {:email 1} {:unique true})
     @(create-index coll {:location \"2dsphere\"})
     @(create-index coll {:created-at 1} {:expire-after-seconds 86400})"
  ([coll keys] (create-index coll keys {}))
  ([coll keys options]
   (-create-index coll keys options)))

(defn drop-index
  "Drop an index by name.

   Usage:
     @(drop-index coll \"email_1\")"
  [coll index-name]
  (-drop-index coll index-name))

(defn list-indexes
  "List all indexes on a collection.

   Usage:
     @(list-indexes coll)"
  [coll]
  (-list-indexes coll))

;; =============================================================================
;; Public API - Change Streams
;; =============================================================================

(defn watch
  "Watch a collection for changes.

   Returns a core.async channel that receives change events.

   Options:
   - :buffer-size     Channel buffer size (default: 100)
   - :full-document   :updateLookup for full document on updates
   - :resume-after    Resume token to continue from

   Change event format:
     {:operation-type :insert|:update|:replace|:delete
      :document-key   {:_id <ObjectId>}
      :full-document  {...}  ; for insert/replace/update with full-document
      :update-description {...}  ; for update operations
      :cluster-time   <timestamp>}

   Usage:
     (let [changes (watch coll)]
       (go-loop []
         (when-let [event (<! changes)]
           (case (:operation-type event)
             :insert (println \"New document:\" (:full-document event))
             :update (println \"Updated:\" (:document-key event))
             :delete (println \"Deleted:\" (:document-key event)))
           (recur))))

     ;; To stop watching, close the channel
     (close! changes)"
  ([coll] (watch coll [] {}))
  ([coll pipeline] (watch coll pipeline {}))
  ([coll pipeline options]
   (-watch coll pipeline options)))

(defn watch-database
  "Watch all collections in a database for changes.

   Usage:
     (let [changes (watch-database db)]
       (go-loop []
         (when-let [event (<! changes)]
           (println \"Collection:\" (:ns event) \"Event:\" event)
           (recur))))"
  ([db] (watch-database db [] {}))
  ([db pipeline] (watch-database db pipeline {}))
  ([db pipeline options]
   (let [ch (chan (:buffer-size options 100))
         rpc-stub (:rpc-stub db)
         change-stream (capnweb/call rpc-stub :watch
                                     (mapv serialize-value pipeline)
                                     options)]
     (go-loop []
       (let [event (<! change-stream)]
         (if event
           (do
             (>! ch (deserialize-value event))
             (recur))
           (close! ch))))
     ch)))

;; =============================================================================
;; Public API - Transactions
;; =============================================================================

(defmacro with-transaction
  "Execute operations within a transaction.

   The session is automatically started and committed on success,
   or aborted on exception.

   Usage:
     (with-transaction [session client]
       @(insert-one coll1 {:type \"credit\" :amount 100} {:session session})
       @(insert-one coll2 {:type \"debit\" :amount 100} {:session session}))"
  [[session-sym client] & body]
  `(let [rpc-stub# (:rpc-stub ~client)
         session-result# @(capnweb/call rpc-stub# :startSession)
         ~session-sym {:session-id (:sessionId session-result#)}]
     (try
       @(capnweb/call rpc-stub# :startTransaction (:session-id ~session-sym))
       (let [result# (do ~@body)]
         @(capnweb/call rpc-stub# :commitTransaction (:session-id ~session-sym))
         result#)
       (catch Exception e#
         @(capnweb/call rpc-stub# :abortTransaction (:session-id ~session-sym))
         (throw e#))
       (finally
         @(capnweb/call rpc-stub# :endSession (:session-id ~session-sym))))))

;; =============================================================================
;; Public API - Bulk Operations
;; =============================================================================

(defn bulk-write
  "Execute multiple write operations in bulk.

   Operations can be:
   - {:insert-one {:document {...}}}
   - {:update-one {:filter {...} :update {...}}}
   - {:update-many {:filter {...} :update {...}}}
   - {:replace-one {:filter {...} :replacement {...}}}
   - {:delete-one {:filter {...}}}
   - {:delete-many {:filter {...}}}

   Options:
   - :ordered  Execute in order, stop on error (default: true)

   Usage:
     @(bulk-write coll
        [{:insert-one {:document {:name \"Alice\"}}}
         {:update-one {:filter {:name \"Bob\"} :update {:$set {:active true}}}}
         {:delete-one {:filter {:status \"expired\"}}}])"
  ([coll operations] (bulk-write coll operations {}))
  ([coll operations options]
   (let [serialized (mapv (fn [op]
                            (cond
                              (:insert-one op)
                              {:insertOne {:document (serialize-value (:document (:insert-one op)))}}

                              (:update-one op)
                              {:updateOne {:filter (serialize-value (:filter (:update-one op)))
                                           :update (serialize-value (:update (:update-one op)))}}

                              (:update-many op)
                              {:updateMany {:filter (serialize-value (:filter (:update-many op)))
                                            :update (serialize-value (:update (:update-many op)))}}

                              (:replace-one op)
                              {:replaceOne {:filter (serialize-value (:filter (:replace-one op)))
                                            :replacement (serialize-value (:replacement (:replace-one op)))}}

                              (:delete-one op)
                              {:deleteOne {:filter (serialize-value (:filter (:delete-one op)))}}

                              (:delete-many op)
                              {:deleteMany {:filter (serialize-value (:filter (:delete-many op)))}}

                              :else op))
                          operations)
         rpc-stub (:rpc-stub coll)]
     (d/chain
      (capnweb/call rpc-stub :bulkWrite serialized options)
      (fn [result]
        {:acknowledged true
         :inserted-count (:insertedCount result 0)
         :matched-count (:matchedCount result 0)
         :modified-count (:modifiedCount result 0)
         :deleted-count (:deletedCount result 0)
         :upserted-count (:upsertedCount result 0)})))))

;; =============================================================================
;; Public API - Map Operations (Pipelining)
;; =============================================================================

(defn find-map
  "Find documents and map a function over results server-side.

   This uses RPC pipelining to avoid N+1 round trips.

   Usage:
     ;; Get user IDs and fetch their profiles in one round trip
     @(find-map db :users
                {:active true}
                (fn [user]
                  (-> db :profiles (find-one {:user-id (:_id user)}))))"
  [db coll-name filter f]
  (let [coll (collection db coll-name)]
    (d/chain
     (find coll filter)
     (fn [docs]
       (capnweb/rmap docs f)))))

(defn aggregate-map
  "Run aggregation and map a function over results server-side.

   Usage:
     @(aggregate-map db :orders
                     [{:$group {:_id \"$customer_id\" :total {:$sum \"$amount\"}}}]
                     (fn [result]
                       (-> db :customers (find-one {:_id (:_id result)}))))"
  [db coll-name pipeline f]
  (let [coll (collection db coll-name)]
    (d/chain
     (aggregate coll pipeline)
     (fn [docs]
       (capnweb/rmap docs f)))))

;; =============================================================================
;; Utility Functions
;; =============================================================================

(defn ping
  "Ping the MongoDB server.

   Usage:
     @(ping client)"
  [client]
  (-> client -admin (-run-command {:ping 1})))

(defn server-status
  "Get server status information.

   Usage:
     @(server-status client)"
  [client]
  (-> client -admin (-run-command {:serverStatus 1})))

(defn stats
  "Get collection statistics.

   Usage:
     @(stats coll)"
  [coll]
  (let [db (-database-ref coll)
        coll-name (:name coll)]
    (-run-command db {:collStats coll-name})))

;; =============================================================================
;; Query Builder Helpers
;; =============================================================================

(defn $and
  "Build an $and query.
   Usage: ($and {:a 1} {:b 2})"
  [& conditions]
  {:$and (vec conditions)})

(defn $or
  "Build an $or query.
   Usage: ($or {:status \"active\"} {:priority {:$gt 5}})"
  [& conditions]
  {:$or (vec conditions)})

(defn $not
  "Build a $not query.
   Usage: ($not {:status \"deleted\"})"
  [condition]
  {:$not condition})

(defn $in
  "Build an $in query.
   Usage: {:status ($in [\"active\" \"pending\"])}"
  [values]
  {:$in (vec values)})

(defn $nin
  "Build a $nin query.
   Usage: {:status ($nin [\"deleted\" \"archived\"])}"
  [values]
  {:$nin (vec values)})

(defn $exists
  "Build an $exists query.
   Usage: {:email ($exists true)}"
  [exists?]
  {:$exists exists?})

(defn $regex
  "Build a $regex query.
   Usage: {:name ($regex \"^A\" \"i\")}"
  ([pattern] {:$regex pattern})
  ([pattern options] {:$regex pattern :$options options}))

(defn $gt [v] {:$gt v})
(defn $gte [v] {:$gte v})
(defn $lt [v] {:$lt v})
(defn $lte [v] {:$lte v})
(defn $ne [v] {:$ne v})
(defn $eq [v] {:$eq v})

;; =============================================================================
;; Update Operator Helpers
;; =============================================================================

(defn $set
  "Build a $set update.
   Usage: ($set {:status \"active\" :updated-at (Date.)})"
  [fields]
  {:$set fields})

(defn $unset
  "Build an $unset update.
   Usage: ($unset [:temp-field :old-field])"
  [fields]
  {:$unset (into {} (map (fn [f] [(name f) 1]) fields))})

(defn $inc
  "Build an $inc update.
   Usage: ($inc {:count 1 :score -5})"
  [fields]
  {:$inc fields})

(defn $push
  "Build a $push update.
   Usage: ($push {:items {:$each [1 2 3]}})"
  [fields]
  {:$push fields})

(defn $pull
  "Build a $pull update.
   Usage: ($pull {:items {:status \"removed\"}})"
  [fields]
  {:$pull fields})

(defn $add-to-set
  "Build an $addToSet update.
   Usage: ($add-to-set {:tags \"important\"})"
  [fields]
  {:$addToSet fields})
