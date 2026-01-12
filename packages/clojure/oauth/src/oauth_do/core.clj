(ns oauth-do.core
  "OAuth device flow SDK for .do APIs."
  (:require [clj-http.client :as http]
            [cheshire.core :as json]
            [oauth-do.storage :as storage]))

(def ^:private default-client-id "client_01JQYTRXK9ZPD8JPJTKDCRB656")
(def ^:private auth-url "https://auth.apis.do/user_management/authorize_device")
(def ^:private token-url "https://auth.apis.do/user_management/authenticate")
(def ^:private user-url "https://apis.do/me")

(defn authorize-device
  "Initiates device authorization flow.
   Returns device code info including user_code and verification_uri."
  ([] (authorize-device {}))
  ([{:keys [client-id scope]
     :or {client-id default-client-id
          scope "openid profile email"}}]
   (let [response (http/post auth-url
                              {:content-type :json
                               :body (json/generate-string
                                      {:client_id client-id
                                       :scope scope})
                               :as :json})]
     (if (= 200 (:status response))
       {:ok (:body response)}
       {:error {:status (:status response)
                :body (:body response)}}))))

(defn poll-for-tokens
  "Polls for tokens after user authorizes the device."
  ([device-code interval expires-in]
   (poll-for-tokens device-code interval expires-in {}))
  ([device-code interval expires-in {:keys [client-id]
                                      :or {client-id default-client-id}}]
   (let [deadline (+ (System/currentTimeMillis) (* expires-in 1000))]
     (loop [current-interval interval]
       (if (>= (System/currentTimeMillis) deadline)
         {:error :expired}
         (let [response (http/post token-url
                                   {:content-type :json
                                    :body (json/generate-string
                                           {:client_id client-id
                                            :device_code device-code
                                            :grant_type "urn:ietf:params:oauth:grant-type:device_code"})
                                    :as :json
                                    :throw-exceptions false})]
           (cond
             (= 200 (:status response))
             (do
               (storage/save-tokens (:body response))
               {:ok (:body response)})

             (and (= 400 (:status response))
                  (= "authorization_pending" (get-in response [:body :error])))
             (do
               (Thread/sleep (* current-interval 1000))
               (recur current-interval))

             (and (= 400 (:status response))
                  (= "slow_down" (get-in response [:body :error])))
             (do
               (Thread/sleep (* (+ current-interval 5) 1000))
               (recur (+ current-interval 5)))

             :else
             {:error {:status (:status response)
                      :body (:body response)}})))))))

(defn get-user
  "Gets the current user info using the stored or provided access token."
  ([] (get-user nil))
  ([access-token]
   (let [token (or access-token (storage/get-access-token))]
     (if token
       (let [response (http/get user-url
                                {:headers {"Authorization" (str "Bearer " token)}
                                 :as :json
                                 :throw-exceptions false})]
         (if (= 200 (:status response))
           {:ok (:body response)}
           {:error {:status (:status response)
                    :body (:body response)}}))
       {:error :no-token}))))

(defn login
  "Interactive login flow. Prints instructions and waits for authorization."
  ([] (login {}))
  ([opts]
   (let [result (authorize-device opts)]
     (if (:ok result)
       (let [device-info (:ok result)]
         (println)
         (println (str "To sign in, visit: " (:verification_uri device-info)))
         (println (str "And enter code: " (:user_code device-info)))
         (println)
         (poll-for-tokens
          (:device_code device-info)
          (or (:interval device-info) 5)
          (or (:expires_in device-info) 900)
          opts))
       result))))

(defn logout
  "Logs out by removing stored tokens."
  []
  (storage/delete-tokens))
