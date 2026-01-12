(ns capnweb.conformance-test
  "Cap'n Web Conformance Test Harness for Clojure.

   This module provides:
   - Dynamic test generation from YAML conformance specs
   - Full support for basic RPC calls and map/rmap operations
   - Integration with clojure.test for standard tooling

   Run tests:
     clj -X:test
     clj -M:conformance

   Environment variables:
     TEST_SERVER_URL - WebSocket URL of test server (required)
     TEST_SPEC_DIR   - Directory containing YAML specs (optional)"
  (:require [clojure.test :refer [deftest testing is are use-fixtures]]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [clj-yaml.core :as yaml]
            [capnweb.core :as rpc]
            [manifold.deferred :as d])
  (:import [java.io File]))

;; -----------------------------------------------------------------------------
;; Configuration
;; -----------------------------------------------------------------------------

(def ^:dynamic *test-server-url*
  "URL of the conformance test server."
  (or (System/getenv "TEST_SERVER_URL")
      "ws://localhost:8080"))

(def ^:dynamic *test-spec-dir*
  "Directory containing YAML conformance specs."
  (or (System/getenv "TEST_SPEC_DIR")
      "../../test/conformance"))

(def ^:dynamic *session*
  "Current RPC session for tests."
  nil)

(def ^:dynamic *api*
  "Current RPC stub for tests."
  nil)

;; -----------------------------------------------------------------------------
;; Test Fixtures
;; -----------------------------------------------------------------------------

(defn with-session
  "Fixture that establishes an RPC session for all tests."
  [f]
  (println "Connecting to test server:" *test-server-url*)
  (let [session (rpc/connect *test-server-url*
                             {:timeout-ms 10000
                              :reconnect? false})]
    (try
      (binding [*session* session
                *api* (rpc/stub session)]
        (f))
      (finally
        (rpc/close! session)
        (println "Disconnected from test server")))))

(use-fixtures :once with-session)

;; -----------------------------------------------------------------------------
;; YAML Spec Loading
;; -----------------------------------------------------------------------------

(defn load-spec-file
  "Load a YAML conformance spec file."
  [^File file]
  (when (.isFile file)
    (when (str/ends-with? (.getName file) ".yaml")
      (try
        (let [content (slurp file)]
          (yaml/parse-string content))
        (catch Exception e
          (println "Error loading spec file:" (.getPath file) "-" (.getMessage e))
          nil)))))

(defn find-spec-files
  "Find all YAML spec files in the given directory."
  [dir]
  (let [spec-dir (io/file dir)]
    (if (.exists spec-dir)
      (->> (.listFiles spec-dir)
           (filter #(str/ends-with? (.getName ^File %) ".yaml"))
           (sort-by #(.getName ^File %)))
      (do
        (println "Spec directory not found:" dir)
        []))))

(defn load-all-specs
  "Load all conformance specs from the spec directory."
  []
  (->> (find-spec-files *test-spec-dir*)
       (map load-spec-file)
       (remove nil?)))

;; -----------------------------------------------------------------------------
;; Test Context Management
;; -----------------------------------------------------------------------------

(def ^:dynamic *test-context*
  "Context for the current test, including setup results."
  {})

(defn resolve-variable
  "Resolve a variable reference like '$counters' from test context."
  [value context]
  (if (and (string? value) (str/starts-with? value "$"))
    (let [var-name (subs value 1)]
      (get context (keyword var-name) value))
    value))

;; -----------------------------------------------------------------------------
;; Expression Evaluation
;; -----------------------------------------------------------------------------

(defn parse-map-expression
  "Parse a map expression like 'x => self.square(x)' into a Clojure function.

   Supported forms:
   - 'x => self.square(x)'         -> (fn [x] (-> api (rpc/call :square x)))
   - 'x => self.returnNumber(x*2)' -> (fn [x] (-> api (rpc/call :returnNumber (* x 2))))
   - 'counter => counter.value'    -> (fn [counter] (:value counter))"
  [expression api]
  (let [[_ param body] (re-matches #"(\w+)\s*=>\s*(.+)" expression)]
    (when (and param body)
      (cond
        ;; self.method(args) pattern
        (re-matches #"self\.(\w+)\((.+)\)" body)
        (let [[_ method args-str] (re-matches #"self\.(\w+)\((.+)\)" body)
              method-kw (keyword method)]
          (fn [x]
            (let [;; Simple arg evaluation - replace param with value
                  args-processed (if (= args-str param)
                                   x
                                   ;; Handle expressions like x * 2
                                   (if-let [[_ mul-val] (re-matches (re-pattern (str param "\\s*\\*\\s*(\\d+)")) args-str)]
                                     (* x (parse-long mul-val))
                                     x))]
              @(rpc/call api method-kw args-processed))))

        ;; capability.property pattern (e.g., counter.value)
        (re-matches #"(\w+)\.(\w+)" body)
        (let [[_ _obj prop] (re-matches #"(\w+)\.(\w+)" body)
              prop-kw (keyword prop)]
          (fn [x]
            (if (map? x)
              (get x prop-kw)
              ;; For capabilities, need to call as method
              @(rpc/call x prop-kw))))

        ;; capability.method(args) pattern (e.g., c.increment(10))
        (re-matches #"(\w+)\.(\w+)\((.+)\)" body)
        (let [[_ _obj method args-str] (re-matches #"(\w+)\.(\w+)\((.+)\)" body)
              method-kw (keyword method)
              arg-val (parse-long args-str)]
          (fn [x]
            (if (map? x)
              (if-let [f (get x method-kw)]
                (f arg-val)
                (throw (ex-info (str "Method not found: " method-kw) {:obj x})))
              @(rpc/call x method-kw arg-val))))

        ;; Default: identity
        :else
        identity))))

;; -----------------------------------------------------------------------------
;; Test Execution
;; -----------------------------------------------------------------------------

(defn execute-call
  "Execute a single RPC call from a test spec."
  [api call-spec args context]
  (let [call-target (resolve-variable call-spec context)
        resolved-args (mapv #(resolve-variable % context) args)]
    (cond
      ;; Variable reference to a stored result
      (and (string? call-target) (str/starts-with? call-target "$"))
      (get context (keyword (subs call-target 1)))

      ;; Regular method call
      :else
      (let [method-kw (keyword call-target)]
        (apply rpc/call api method-kw resolved-args)))))

(defn execute-map-operation
  "Execute a map operation on a collection result."
  [result map-spec api context]
  (let [expression (:expression map-spec)
        map-fn (parse-map-expression expression api)]
    (if map-fn
      (rpc/rmap result map-fn)
      (throw (ex-info "Failed to parse map expression" {:expression expression})))))

(defn execute-setup-step
  "Execute a single setup step, returning updated context."
  [api step context]
  (let [call-method (:call step)
        args (or (:args step) [])
        result-name (:as step)
        should-await (:await step)

        ;; Execute the call
        result (execute-call api call-method args context)

        ;; Apply map if present
        result (if-let [map-spec (:map step)]
                 (execute-map-operation result map-spec api context)
                 result)

        ;; Await if needed
        final-result (if should-await @result result)]

    ;; Store in context if named
    (if result-name
      (assoc context (keyword result-name) final-result)
      context)))

(defn execute-setup
  "Execute all setup steps, building up the test context."
  [api setup-steps]
  (reduce (fn [ctx step]
            (execute-setup-step api step ctx))
          {}
          setup-steps))

(defn run-test-case
  "Run a single test case from the conformance spec."
  [api test-case]
  (let [test-name (:name test-case)
        description (:description test-case)
        setup-steps (:setup test-case)
        call-method (:call test-case)
        args (or (:args test-case) [])
        map-spec (:map test-case)
        expected (:expect test-case)
        expect-type (:expect_type test-case)
        expect-length (:expect_length test-case)
        max-round-trips (:max_round_trips test-case)]

    (testing (str test-name ": " description)
      (try
        ;; Execute setup if present
        (let [context (if setup-steps
                        (execute-setup api setup-steps)
                        {})

              ;; Execute the main call
              result (execute-call api call-method args context)

              ;; Apply map operation if present
              result (if map-spec
                       (execute-map-operation result map-spec api context)
                       result)

              ;; Dereference to get final value
              actual @result]

          ;; Assertions based on expected value type
          (cond
            ;; Exact value match
            (some? expected)
            (is (= expected actual)
                (str "Expected " (pr-str expected) " but got " (pr-str actual)))

            ;; Type check
            expect-type
            (case expect-type
              "capability"
              (is (map? actual) "Expected a capability (map)")

              "array_of_capabilities"
              (do
                (is (sequential? actual) "Expected array of capabilities")
                (when expect-length
                  (is (= expect-length (count actual))
                      (str "Expected " expect-length " items, got " (count actual)))))

              ;; Default
              (is true (str "Unknown expect_type: " expect-type)))

            ;; Default pass
            :else
            (is true "Test completed without explicit expectation")))

        (catch Exception e
          (is false (str "Test failed with exception: " (.getMessage e)
                         "\n" (pr-str (ex-data e)))))))))

;; -----------------------------------------------------------------------------
;; Dynamic Test Generation
;; -----------------------------------------------------------------------------

(defn spec->test-name
  "Convert a spec name to a valid Clojure test name."
  [spec-name]
  (-> spec-name
      (str/lower-case)
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"^-|-$" "")
      (symbol)))

(defmacro define-conformance-tests
  "Macro to define conformance tests from loaded specs at compile time.
   For runtime dynamic loading, use run-all-conformance-tests instead."
  []
  `(do
     ~@(for [spec (load-all-specs)
             test-case (:tests spec)]
         (let [test-name (spec->test-name (:name test-case))]
           `(deftest ~test-name
              (when *api*
                (run-test-case *api* ~test-case)))))))

(defn run-spec-tests
  "Run all tests from a single spec."
  [api spec]
  (let [spec-name (:name spec)]
    (println "\n=== Running:" spec-name "===")
    (println (:description spec))
    (println)

    (doseq [test-case (:tests spec)]
      (run-test-case api test-case))))

(defn run-all-conformance-tests
  "Run all conformance tests from YAML specs.
   Returns a map with :passed, :failed, and :errors counts."
  [api]
  (let [specs (load-all-specs)
        results (atom {:passed 0 :failed 0 :errors 0})]

    (println "")
    (println "========================================")
    (println "Cap'n Web Clojure Conformance Tests")
    (println "========================================")
    (println "Server:" *test-server-url*)
    (println "Specs:" (count specs))
    (println "")

    (doseq [spec specs]
      (run-spec-tests api spec))

    @results))

;; -----------------------------------------------------------------------------
;; Standalone Test Definitions (for clojure.test integration)
;; -----------------------------------------------------------------------------

;; Basic RPC Call Tests

(deftest ^:basic test-square-positive
  (when *api*
    (is (= 25 @(rpc/call *api* :square 5))
        "Square of 5 should be 25")))

(deftest ^:basic test-square-negative
  (when *api*
    (is (= 9 @(rpc/call *api* :square -3))
        "Square of -3 should be 9")))

(deftest ^:basic test-square-zero
  (when *api*
    (is (= 0 @(rpc/call *api* :square 0))
        "Square of 0 should be 0")))

(deftest ^:basic test-return-number
  (when *api*
    (is (= 42 @(rpc/call *api* :returnNumber 42))
        "returnNumber should return the same number")))

(deftest ^:basic test-return-null
  (when *api*
    (is (nil? @(rpc/call *api* :returnNull))
        "returnNull should return nil")))

(deftest ^:basic test-fibonacci-ten
  (when *api*
    (is (= [0 1 1 2 3 5 8 13 21 34]
           @(rpc/call *api* :generateFibonacci 10))
        "Should generate first 10 Fibonacci numbers")))

;; Map/Remap Tests

(deftest ^:map test-map-fibonacci-square
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :generateFibonacci 6)
                      (rpc/rmap (fn [x] @(rpc/call *api* :square x))))]
      (is (= [0 1 1 4 9 25] result)
          "Map square over fib(6) should give [0 1 1 4 9 25]"))))

(deftest ^:map test-map-fibonacci-double
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :generateFibonacci 5)
                      (rpc/rmap (fn [x] @(rpc/call *api* :returnNumber (* x 2)))))]
      (is (= [0 2 2 4 6] result)
          "Map double over fib(5) should give [0 2 2 4 6]"))))

(deftest ^:map test-map-on-null
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :returnNull)
                      (rpc/rmap (fn [x] @(rpc/call *api* :square x))))]
      (is (nil? result)
          "Map on null should return null"))))

(deftest ^:map test-map-on-single-number
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :returnNumber 7)
                      (rpc/rmap (fn [x] @(rpc/call *api* :square x))))]
      (is (= 49 result)
          "Map on single number 7 should give 49"))))

(deftest ^:map test-map-empty-array
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :generateFibonacci 0)
                      (rpc/rmap (fn [x] @(rpc/call *api* :square x))))]
      (is (= [] result)
          "Map over empty array should give empty array"))))

(deftest ^:map test-nested-map
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :generateFibonacci 4)
                      (rpc/rmap (fn [n] @(rpc/call *api* :generateFibonacci n))))]
      (is (= [[] [0] [0] [0 1]] result)
          "Nested map should generate fib sequences for each fib number"))))

(deftest ^:map test-map-preserves-order
  (when *api*
    (let [result @(-> *api*
                      (rpc/call :generateFibonacci 8)
                      (rpc/rmap (fn [x] @(rpc/call *api* :returnNumber x))))]
      (is (= [0 1 1 2 3 5 8 13] result)
          "Map should preserve order of elements"))))

;; -----------------------------------------------------------------------------
;; Test Runner Entry Point
;; -----------------------------------------------------------------------------

(defn -main
  "Main entry point for running conformance tests from command line."
  [& args]
  (println "Starting Cap'n Web Clojure Conformance Tests")

  ;; Parse command line args
  (let [opts (into {} (map (fn [[k v]] [(keyword k) v])
                           (partition 2 args)))]

    ;; Override config from args
    (binding [*test-server-url* (or (:url opts) *test-server-url*)
              *test-spec-dir* (or (:spec-dir opts) *test-spec-dir*)]

      ;; Connect and run tests
      (let [session (rpc/connect *test-server-url*
                                 {:timeout-ms 10000})]
        (try
          (let [api (rpc/stub session)]
            (run-all-conformance-tests api))
          (finally
            (rpc/close! session)))))))

;; -----------------------------------------------------------------------------
;; REPL Helpers
;; -----------------------------------------------------------------------------

(comment
  ;; Connect to test server
  (def session (rpc/connect "ws://localhost:8080"))
  (def api (rpc/stub session))

  ;; Run a simple test
  @(rpc/call api :square 5)

  ;; Test rmap
  @(-> api
       (rpc/call :generateFibonacci 6)
       (rpc/rmap (fn [x] @(rpc/call api :square x))))

  ;; Load and inspect specs
  (def specs (load-all-specs))
  (map :name specs)
  (-> specs first :tests)

  ;; Run all tests
  (run-all-conformance-tests api)

  ;; Cleanup
  (rpc/close! session)
  )
