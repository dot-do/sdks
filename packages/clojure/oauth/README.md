# oauth-do

OAuth device flow SDK for .do APIs in Clojure.

## Installation

Add to your `deps.edn`:

```clojure
{:deps {oauth-do/oauth-do {:local/root "path/to/oauth-do"}}}
```

Or using git:

```clojure
{:deps {oauth-do/oauth-do {:git/url "https://github.com/dotdo/oauth-clojure"
                           :git/sha "..."}}}
```

## Usage

### Interactive Login

```clojure
(require '[oauth-do.core :as oauth])

;; Start device flow login
(oauth/login)
;; => {:ok {:access_token "..." :refresh_token "..."}}

;; Get current user info
(oauth/get-user)
;; => {:ok {:name "..." :email "..."}}

;; Logout
(oauth/logout)
```

### Manual Device Flow

```clojure
(require '[oauth-do.core :as oauth])

;; Step 1: Initiate device authorization
(def device-info (:ok (oauth/authorize-device)))

;; Display to user
(println "Visit:" (:verification_uri device-info))
(println "Enter code:" (:user_code device-info))

;; Step 2: Poll for tokens
(oauth/poll-for-tokens
  (:device_code device-info)
  (:interval device-info)
  (:expires_in device-info))
```

### Custom Client ID

```clojure
(oauth/login {:client-id "your_client_id"})
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `(authorize-device)` / `(authorize-device opts)` - Initiate device authorization
- `(poll-for-tokens device-code interval expires-in)` - Poll for tokens
- `(get-user)` / `(get-user access-token)` - Get current user info
- `(login)` / `(login opts)` - Interactive login flow
- `(logout)` - Remove stored tokens

## License

MIT
