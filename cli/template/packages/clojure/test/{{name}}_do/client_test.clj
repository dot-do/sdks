(ns {{name}}-do.client-test
  (:require [clojure.test :refer [deftest is testing]]
            [{{name}}-do.core :as {{name}}]))

(deftest create-client-test
  (testing "creates with default options"
    (let [client ({{name}}/create-client {})]
      (is (not ({{name}}/connected? client)))
      (is (= "https://{{name}}.do" (get-in @client [:options :base-url])))))

  (testing "creates with custom options"
    (let [client ({{name}}/create-client {:api-key "test-key"
                                           :base-url "https://test.{{name}}.do"})]
      (is (= "test-key" (get-in @client [:options :api-key])))
      (is (= "https://test.{{name}}.do" (get-in @client [:options :base-url]))))))

(deftest get-rpc-test
  (testing "throws when not connected"
    (let [client ({{name}}/create-client {})]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo
                            #"not connected"
                            ({{name}}-do.client/get-rpc client))))))
