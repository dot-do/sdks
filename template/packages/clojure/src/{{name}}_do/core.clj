(ns {{name}}-do.core
  "{{Name}}.do SDK for Clojure.

  {{description}}

  Example:
  ```clojure
  (require '[{{name}}-do.core :as {{name}}])

  (def client ({{name}}/create-client {:api-key (System/getenv \"DOTDO_KEY\")}))
  @({{name}}/connect! client)
  ;; Use the client...
  @({{name}}/disconnect! client)
  ```"
  (:require [{{name}}-do.client :as client]))

;; Re-export main API
(def create-client client/create-client)
(def connect! client/connect!)
(def disconnect! client/disconnect!)
(def connected? client/connected?)
(def call! client/call!)
