(ns com.dotdo.kafka-test
  "Tests for DotDo Kafka SDK."
  (:require [clojure.test :refer [deftest testing is are]]
            [com.dotdo.kafka :as kafka]))

;; =============================================================================
;; Record Type Tests
;; =============================================================================

(deftest producer-record-test
  (testing "ProducerRecord creation - topic and value"
    (let [record (kafka/->producer-record :my-topic {:data 1})]
      (is (= "my-topic" (:topic record)))
      (is (= {:data 1} (:value record)))
      (is (nil? (:key record)))))

  (testing "ProducerRecord creation - topic, key, and value"
    (let [record (kafka/->producer-record :my-topic "my-key" {:data 1})]
      (is (= "my-topic" (:topic record)))
      (is (= "my-key" (:key record)))
      (is (= {:data 1} (:value record)))))

  (testing "ProducerRecord creation - from map"
    (let [record (kafka/->producer-record {:topic :my-topic
                                           :key "my-key"
                                           :value {:data 1}
                                           :partition 0
                                           :headers {"type" "test"}})]
      (is (= "my-topic" (:topic record)))
      (is (= "my-key" (:key record)))
      (is (= {:data 1} (:value record)))
      (is (= 0 (:partition record)))
      (is (= {"type" "test"} (:headers record))))))

(deftest topic-partition-test
  (testing "TopicPartition creation"
    (let [tp (kafka/->topic-partition :my-topic 0)]
      (is (= "my-topic" (:topic tp)))
      (is (= 0 (:partition tp)))))

  (testing "TopicPartitionOffset creation"
    (let [tpo (kafka/->topic-partition-offset :my-topic 0 100)]
      (is (= "my-topic" (:topic tpo)))
      (is (= 0 (:partition tpo)))
      (is (= 100 (:offset tpo))))))

;; =============================================================================
;; Serialization Tests
;; =============================================================================

(deftest serialization-test
  (testing "JSON serialization"
    (is (= "{\"name\":\"Alice\",\"age\":30}"
           (kafka/serialize {:name "Alice" :age 30} {:serializer :json})))
    (is (nil? (kafka/serialize nil {:serializer :json}))))

  (testing "String serialization"
    (is (= "hello" (kafka/serialize "hello" {:serializer :string})))
    (is (= "123" (kafka/serialize 123 {:serializer :string}))))

  (testing "EDN serialization"
    (is (= "{:name \"Alice\", :age 30}"
           (kafka/serialize {:name "Alice" :age 30} {:serializer :edn}))))

  (testing "Bytes pass-through"
    (let [bytes (.getBytes "test")]
      (is (= bytes (kafka/serialize bytes {:serializer :bytes}))))))

(deftest deserialization-test
  (testing "JSON deserialization"
    (is (= {:name "Alice" :age 30}
           (kafka/deserialize "{\"name\":\"Alice\",\"age\":30}" {:deserializer :json})))
    (is (nil? (kafka/deserialize nil {:deserializer :json}))))

  (testing "String deserialization"
    (is (= "hello" (kafka/deserialize "hello" {:deserializer :string}))))

  (testing "EDN deserialization"
    (is (= {:name "Alice" :age 30}
           (kafka/deserialize "{:name \"Alice\", :age 30}" {:deserializer :edn})))))

;; =============================================================================
;; Configuration Tests
;; =============================================================================

(deftest configuration-test
  (testing "Default configuration exists"
    (is (map? kafka/*config*))
    (is (contains? kafka/*config* :bootstrap-servers))
    (is (contains? kafka/*config* :producer))
    (is (contains? kafka/*config* :consumer))
    (is (contains? kafka/*config* :streams)))

  (testing "Producer defaults"
    (let [producer-config (:producer kafka/*config*)]
      (is (= "all" (:acks producer-config)))
      (is (true? (:enable-idempotence producer-config)))))

  (testing "Consumer defaults"
    (let [consumer-config (:consumer kafka/*config*)]
      (is (= "earliest" (:auto-offset-reset consumer-config)))
      (is (false? (:enable-auto-commit consumer-config)))))

  (testing "Streams defaults"
    (let [streams-config (:streams kafka/*config*)]
      (is (= "exactly_once_v2" (:processing-guarantee streams-config))))))

;; =============================================================================
;; Streams DSL Tests
;; =============================================================================

(deftest stream-builder-test
  (testing "StreamBuilder creation"
    (let [builder (kafka/stream-builder)]
      (is (some? builder))
      (is (instance? com.dotdo.kafka.StreamBuilder builder)))))

(deftest stream-operations-test
  (testing "Stream creation from topic"
    (let [stream (-> (kafka/stream-builder)
                     (kafka/stream :my-topic))]
      (is (some? stream))
      (is (instance? com.dotdo.kafka.KStreamImpl stream))))

  (testing "Filter operation"
    (let [filtered (-> (kafka/stream-builder)
                       (kafka/stream :input)
                       (kafka/sfilter (fn [k v] (pos? (:amount v)))))]
      (is (instance? com.dotdo.kafka.KStreamImpl filtered))))

  (testing "Map values operation"
    (let [mapped (-> (kafka/stream-builder)
                     (kafka/stream :input)
                     (kafka/map-values (fn [v] (assoc v :processed true))))]
      (is (instance? com.dotdo.kafka.KStreamImpl mapped))))

  (testing "Group by key operation"
    (let [grouped (-> (kafka/stream-builder)
                      (kafka/stream :input)
                      kafka/group-by-key)]
      (is (instance? com.dotdo.kafka.KGroupedStreamImpl grouped))))

  (testing "Count operation"
    (let [counted (-> (kafka/stream-builder)
                      (kafka/stream :input)
                      kafka/group-by-key
                      kafka/scount)]
      (is (instance? com.dotdo.kafka.KTableImpl counted))))

  (testing "Windowed aggregation"
    (let [windowed (-> (kafka/stream-builder)
                       (kafka/stream :input)
                       kafka/group-by-key
                       (kafka/windowed-by {:type :tumbling :size-ms 60000})
                       kafka/scount)]
      (is (instance? com.dotdo.kafka.KTableImpl windowed)))))

(deftest table-operations-test
  (testing "Table creation from topic"
    (let [table (-> (kafka/stream-builder)
                    (kafka/table :my-table))]
      (is (some? table))
      (is (instance? com.dotdo.kafka.KTableImpl table))))

  (testing "Table filter operation"
    (let [filtered (-> (kafka/stream-builder)
                       (kafka/table :input)
                       (kafka/tfilter (fn [k v] (:active v))))]
      (is (instance? com.dotdo.kafka.KTableImpl filtered))))

  (testing "Table to stream conversion"
    (let [stream (-> (kafka/stream-builder)
                     (kafka/table :input)
                     kafka/to-stream)]
      (is (instance? com.dotdo.kafka.KStreamImpl stream)))))

(deftest topology-building-test
  (testing "Complete topology building"
    (let [topology (-> (kafka/stream-builder)
                       (kafka/stream :input)
                       (kafka/sfilter (fn [k v] (some? v)))
                       (kafka/map-values (fn [v] (assoc v :processed-at (System/currentTimeMillis))))
                       (kafka/to :output))]
      (is (map? topology))
      (is (contains? topology :topology))
      (is (vector? (:topology topology))))))

;; =============================================================================
;; Branch and Merge Tests
;; =============================================================================

(deftest branch-test
  (testing "Branch operation returns multiple streams"
    (let [streams (-> (kafka/stream-builder)
                      (kafka/stream :input)
                      (kafka/branch [(fn [k v] (> (:priority v) 5))
                                     (fn [k v] (<= (:priority v) 5))]))]
      (is (vector? streams))
      (is (= 2 (count streams)))
      (is (every? #(instance? com.dotdo.kafka.KStreamImpl %) streams)))))

(deftest merge-test
  (testing "Merge operation combines streams"
    (let [stream1 (-> (kafka/stream-builder) (kafka/stream :input1))
          stream2 (-> (kafka/stream-builder) (kafka/stream :input2))
          merged (kafka/merge-streams stream1 stream2)]
      (is (instance? com.dotdo.kafka.KStreamImpl merged)))))

;; =============================================================================
;; Join Tests
;; =============================================================================

(deftest join-streams-test
  (testing "Stream-stream join"
    (let [stream1 (-> (kafka/stream-builder) (kafka/stream :input1))
          stream2 (-> (kafka/stream-builder) (kafka/stream :input2))
          joined (kafka/join-streams stream1 stream2
                                     (fn [v1 v2] (merge v1 v2))
                                     {:type :tumbling :size-ms 60000})]
      (is (instance? com.dotdo.kafka.KStreamImpl joined)))))

(deftest join-tables-test
  (testing "Table-table join"
    (let [table1 (-> (kafka/stream-builder) (kafka/table :table1))
          table2 (-> (kafka/stream-builder) (kafka/table :table2))
          joined (kafka/join-tables table1 table2
                                    (fn [v1 v2] (merge v1 v2)))]
      (is (instance? com.dotdo.kafka.KTableImpl joined)))))

;; =============================================================================
;; Aggregation Tests
;; =============================================================================

(deftest aggregation-test
  (testing "Aggregate operation"
    (let [aggregated (-> (kafka/stream-builder)
                         (kafka/stream :input)
                         kafka/group-by-key
                         (kafka/aggregate {:count 0 :sum 0}
                                          (fn [agg k v]
                                            (-> agg
                                                (update :count inc)
                                                (update :sum + (:amount v))))))]
      (is (instance? com.dotdo.kafka.KTableImpl aggregated))))

  (testing "Reduce operation"
    (let [reduced (-> (kafka/stream-builder)
                      (kafka/stream :input)
                      kafka/group-by-key
                      (kafka/sreduce (fn [agg new] (+ agg (:amount new)))))]
      (is (instance? com.dotdo.kafka.KTableImpl reduced)))))
