(ns {{name}}-do.client
  "{{Name}}.do client for interacting with the {{name}} service."
  (:require [com.dotdo.rpc :as rpc])
  (:import [clojure.lang ExceptionInfo]))

(def ^:private default-options
  {:base-url "https://{{name}}.do"
   :timeout-ms 30000})

(defn create-client
  "Create a new {{Name}}.do client.

  Options:
    :api-key    - API key for authentication (optional)
    :base-url   - Base URL for the service (default: \"https://{{name}}.do\")
    :timeout-ms - Connection timeout in milliseconds (default: 30000)

  Example:
  ```clojure
  (def client (create-client {:api-key \"your-api-key\"}))
  ```"
  [options]
  (let [opts (merge default-options options)]
    (atom {:options opts
           :rpc nil})))

(defn connected?
  "Check if the client is connected."
  [client]
  (some? (:rpc @client)))

(defn connect!
  "Connect to the {{name}}.do service.

  Returns a promise that resolves to the RPC client.

  Example:
  ```clojure
  @(connect! client)
  ```"
  [client]
  (future
    (let [{:keys [options rpc]} @client]
      (if rpc
        rpc
        (let [headers (when-let [api-key (:api-key options)]
                        {"Authorization" (str "Bearer " api-key)})
              new-rpc (rpc/connect (:base-url options)
                                   {:headers headers})]
          (swap! client assoc :rpc new-rpc)
          new-rpc)))))

(defn disconnect!
  "Disconnect from the service.

  Returns a promise that resolves when disconnected.

  Example:
  ```clojure
  @(disconnect! client)
  ```"
  [client]
  (future
    (when-let [rpc (:rpc @client)]
      (rpc/close! rpc)
      (swap! client assoc :rpc nil)
      nil)))

(defn get-rpc
  "Get the underlying RPC client. Throws if not connected."
  [client]
  (if-let [rpc (:rpc @client)]
    rpc
    (throw (ex-info "{{Name}}Client is not connected. Call connect! first."
                    {:type :{{name}}-do/not-connected}))))

(defn call!
  "Make an RPC call to the {{name}}.do service.

  Returns a promise that resolves to the result.

  Example:
  ```clojure
  @(call! client :greet \"World\")
  ```"
  [client method & args]
  (future
    (let [rpc (get-rpc client)]
      (apply rpc/call rpc method args))))
