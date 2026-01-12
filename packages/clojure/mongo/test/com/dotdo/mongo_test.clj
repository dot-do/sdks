(ns com.dotdo.mongo-test
  "Tests for DotDo MongoDB SDK."
  (:require [clojure.test :refer [deftest testing is are]]
            [com.dotdo.mongo :as mongo]))

;; =============================================================================
;; ObjectId Tests
;; =============================================================================

(deftest object-id-test
  (testing "ObjectId creation"
    (let [oid (mongo/object-id)]
      (is (mongo/object-id? oid))
      (is (string? (:id oid)))))

  (testing "ObjectId from string"
    (let [id-str "507f1f77bcf86cd799439011"
          oid (mongo/object-id id-str)]
      (is (mongo/object-id? oid))
      (is (= id-str (:id oid)))
      (is (= id-str (str oid)))))

  (testing "ObjectId coercion"
    (let [id-str "507f1f77bcf86cd799439011"]
      (is (mongo/object-id? (mongo/->object-id id-str)))
      (is (= "short" (mongo/->object-id "short")))))) ; Non-24-char strings pass through

;; =============================================================================
;; Query Builder Tests
;; =============================================================================

(deftest query-builder-test
  (testing "$and query"
    (is (= {:$and [{:a 1} {:b 2}]}
           (mongo/$and {:a 1} {:b 2}))))

  (testing "$or query"
    (is (= {:$or [{:status "active"} {:priority 5}]}
           (mongo/$or {:status "active"} {:priority 5}))))

  (testing "$in query"
    (is (= {:$in ["a" "b" "c"]}
           (mongo/$in ["a" "b" "c"]))))

  (testing "$nin query"
    (is (= {:$nin [1 2 3]}
           (mongo/$nin [1 2 3]))))

  (testing "$exists query"
    (is (= {:$exists true} (mongo/$exists true)))
    (is (= {:$exists false} (mongo/$exists false))))

  (testing "$regex query"
    (is (= {:$regex "^test"} (mongo/$regex "^test")))
    (is (= {:$regex "^test" :$options "i"} (mongo/$regex "^test" "i"))))

  (testing "Comparison operators"
    (is (= {:$gt 5} (mongo/$gt 5)))
    (is (= {:$gte 5} (mongo/$gte 5)))
    (is (= {:$lt 5} (mongo/$lt 5)))
    (is (= {:$lte 5} (mongo/$lte 5)))
    (is (= {:$ne 5} (mongo/$ne 5)))
    (is (= {:$eq 5} (mongo/$eq 5)))))

;; =============================================================================
;; Update Operator Tests
;; =============================================================================

(deftest update-operator-test
  (testing "$set update"
    (is (= {:$set {:name "Alice" :age 30}}
           (mongo/$set {:name "Alice" :age 30}))))

  (testing "$unset update"
    (is (= {:$unset {"temp" 1 "old" 1}}
           (mongo/$unset [:temp :old]))))

  (testing "$inc update"
    (is (= {:$inc {:count 1 :score -5}}
           (mongo/$inc {:count 1 :score -5}))))

  (testing "$push update"
    (is (= {:$push {:items "new-item"}}
           (mongo/$push {:items "new-item"}))))

  (testing "$pull update"
    (is (= {:$pull {:items {:status "removed"}}}
           (mongo/$pull {:items {:status "removed"}}))))

  (testing "$addToSet update"
    (is (= {:$addToSet {:tags "important"}}
           (mongo/$add-to-set {:tags "important"})))))

;; =============================================================================
;; Record Type Tests
;; =============================================================================

(deftest producer-record-test
  (testing "ProducerRecord creation with keyword"
    (let [record (mongo/->producer-record :my-topic "value")]
      ;; Just verify the record can be created
      (is (some? record)))))

;; =============================================================================
;; Configuration Tests
;; =============================================================================

(deftest configuration-test
  (testing "Default configuration exists"
    (is (map? mongo/*config*))
    (is (contains? mongo/*config* :default-url))
    (is (contains? mongo/*config* :max-pool-size))
    (is (contains? mongo/*config* :max-retries))))

;; =============================================================================
;; Query Composition Tests
;; =============================================================================

(deftest query-composition-test
  (testing "Complex query composition"
    (let [query (mongo/$and
                  {:status "active"}
                  (mongo/$or
                    {:priority (mongo/$gt 5)}
                    {:urgent true})
                  {:email (mongo/$exists true)})]
      (is (= {:$and [{:status "active"}
                     {:$or [{:priority {:$gt 5}}
                            {:urgent true}]}
                     {:email {:$exists true}}]}
             query))))

  (testing "Update composition"
    (let [update (merge
                   (mongo/$set {:status "processed"})
                   (mongo/$inc {:version 1}))]
      (is (= {:$set {:status "processed"}
              :$inc {:version 1}}
             update)))))
