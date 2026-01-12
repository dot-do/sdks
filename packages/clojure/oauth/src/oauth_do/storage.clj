(ns oauth-do.storage
  "File-based token storage."
  (:require [cheshire.core :as json]
            [clojure.java.io :as io]))

(def ^:private token-dir (str (System/getProperty "user.home") "/.oauth.do"))
(def ^:private token-file (str token-dir "/token"))

(defn save-tokens
  "Saves tokens to file storage."
  [tokens]
  (io/make-parents token-file)
  (spit token-file (json/generate-string tokens))
  :ok)

(defn load-tokens
  "Loads tokens from file storage."
  []
  (try
    (let [content (slurp token-file)]
      {:ok (json/parse-string content true)})
    (catch java.io.FileNotFoundException _
      {:error :not-found})
    (catch Exception e
      {:error (.getMessage e)})))

(defn get-access-token
  "Gets the access token from storage."
  []
  (let [result (load-tokens)]
    (when (:ok result)
      (:access_token (:ok result)))))

(defn get-refresh-token
  "Gets the refresh token from storage."
  []
  (let [result (load-tokens)]
    (when (:ok result)
      (:refresh_token (:ok result)))))

(defn delete-tokens
  "Deletes stored tokens."
  []
  (let [f (io/file token-file)]
    (when (.exists f)
      (.delete f)))
  :ok)

(defn has-tokens?
  "Checks if tokens exist."
  []
  (.exists (io/file token-file)))
