# Cap'n Web Ruby Client: Syntax Exploration

This document explores **divergent** syntax approaches for the `capnweb` Ruby gem. Each approach represents a different philosophy about how Ruby developers should interact with the library.

---

## Prior Art: How Ruby RPC/HTTP Libraries Do It

### gRPC-Ruby
```ruby
stub = Helloworld::Greeter::Stub.new('localhost:50051', :this_channel_is_insecure)
response = stub.say_hello(Helloworld::HelloRequest.new(name: 'World'))
```
- Explicitly typed stubs from generated code
- Synchronous by default
- Request/response objects are explicit

### Faraday
```ruby
conn = Faraday.new(url: 'https://api.example.com') do |f|
  f.request :json
  f.response :json
  f.adapter Faraday.default_adapter
end
response = conn.get('/users/1')
```
- Block-based configuration
- Builder pattern via blocks
- Method chaining for middleware

### HTTParty
```ruby
class GitHub
  include HTTParty
  base_uri 'api.github.com'
end
GitHub.get('/users/octocat')
```
- Module inclusion for configuration
- Class-level DSL
- Very clean, declarative

### Dry-RB / ROM
```ruby
class CreateUser < Dry::Transaction
  step :validate
  step :persist
end
```
- Declarative, composable steps
- Monadic error handling (Success/Failure)

---

## Approach 1: "Pure Ruby Magic" (method_missing + Blocks)

**Philosophy**: Maximize Ruby's dynamic nature. Stubs are pure proxies where anything goes. Blocks for everything async. Method chains for pipelining. This feels like "Ruby on Rails" — convention over configuration, magic that "just works."

### Connection & Session

```ruby
require 'capnweb'

# Block-based session (auto-closes when block exits)
CapnWeb.connect('wss://api.example.com') do |api|
  user = api.users.get(123).await!
  puts user.name
end

# Long-lived connection (manual disposal)
api = CapnWeb.connect('wss://api.example.com')
# ... use api ...
api.close

# HTTP batch mode — block scopes the batch
CapnWeb.batch('https://api.example.com/rpc') do |api|
  user_promise = api.users.get(123)
  friends_promise = api.users.get(123).friends

  # Batch sent when block exits or when .await! is called
  user, friends = CapnWeb.await!(user_promise, friends_promise)
end

# Alternative: using Ruby 3.0+ Ractor-safe connection pool
CapnWeb.configure do |config|
  config.pool_size = 5
  config.timeout = 30
  config.on_error { |e| Rails.logger.error(e) }
end
```

### Making RPC Calls

```ruby
# Every property/method access returns an RpcPromise
promise = api.users.get(123)

# .await! blocks and returns the resolved value (bang = might raise!)
user = api.users.get(123).await!

# .await returns Result monad (never raises, Dry::Monads compatible)
result = api.users.get(123).await
case result
when CapnWeb::Success then puts result.value.name
when CapnWeb::Failure then puts result.error.message
end

# Property access on promises (pipelining)
name = api.users.get(123).profile.name.await!

# Async with Fibers (Ruby 3.2+)
Fiber.schedule do
  user = api.users.get(123).await!
end
```

### Pipelining Syntax

```ruby
# Method chains automatically pipeline — no intermediate awaits!
api.authenticate(token)
   .get_user_id
   .then { |id| api.profiles.get(id) }
   .await!

# The magic .map method (server-side transformation)
friend_profiles = api.users.get(123)
                     .friend_ids
                     .map { |id| api.profiles.get(id) }
                     .await!

# Even cleaner with symbolic method reference
names = api.users.list.map(&:name).await!

# Batch multiple calls, single round trip
user, friends, notifications = CapnWeb.pipeline(
  api.users.get(123),
  api.users.get(123).friends,
  api.notifications.unread
)
```

### Error Handling

```ruby
# Bang methods raise on error
begin
  user = api.users.get(123).await!
rescue CapnWeb::RpcError => e
  puts "RPC failed: #{e.message}"
rescue CapnWeb::ConnectionError => e
  puts "Connection lost: #{e.message}"
end

# Non-bang returns Result (monadic)
api.users.get(123).await
  .fmap { |user| user.name.upcase }
  .or { |error| "Unknown" }

# Rescue in chain (like Promise.catch)
api.users.get(123)
   .rescue { |e| default_user }
   .await!

# Timeout
api.users.get(123).await!(timeout: 5.seconds)
```

### Exposing Local Objects as RPC Targets

```ruby
# Include CapnWeb::Target to make class remotely callable
class NotificationHandler
  include CapnWeb::Target

  def on_message(msg)
    puts "Received: #{msg}"
  end

  def on_disconnect(reason)
    puts "Disconnected: #{reason}"
  end

  private

  def secret_method  # Private methods NOT exposed
    # ...
  end
end

# Pass to server
api.subscribe(NotificationHandler.new).await!

# Or use a Proc/lambda (automatically becomes remote target)
api.on_update(->(data) { process(data) })
```

### Optional Typing (Sorbet)

```ruby
# sig/capnweb.rbs or sorbet/rbi files
class MyApiStub < CapnWeb::Stub
  sig { params(id: Integer).returns(CapnWeb::Promise[User]) }
  def get_user(id); end
end

# Usage with type checking
api = T.cast(CapnWeb.connect(url), MyApiStub)
```

---

## Approach 2: "Explicit & Typed" (Dry-RB Style)

**Philosophy**: Favor explicitness over magic. Clear separation between stubs, promises, and values. Integrate with Dry::Monads for railway-oriented error handling. This appeals to developers who prefer predictability and testability.

### Connection & Session

```ruby
require 'capnweb'

# Explicit session creation with configuration object
config = CapnWeb::Config.new(
  url: 'wss://api.example.com',
  transport: :websocket,
  timeout: 30,
  retry_policy: CapnWeb::Retry.exponential(max_attempts: 3)
)

session = CapnWeb::Session.new(config)
api = session.stub  # Returns RpcStub

# Or use a factory
api = CapnWeb::Client.websocket('wss://api.example.com')
api = CapnWeb::Client.http_batch('https://api.example.com/rpc')

# Session lifecycle is explicit
session.connect
session.disconnect
session.connected?
```

### Making RPC Calls

```ruby
# Calls return RpcCall objects (not magic proxies)
call = api.call(:users, :get, id: 123)

# Explicit resolution
result = call.resolve  # => Dry::Monads::Result

result.success? # => true/false
result.value!   # => User (or raises on failure)
result.failure  # => Error (or nil on success)

# Pattern matching (Ruby 3.0+)
case call.resolve
in Success(user)
  puts user.name
in Failure(CapnWeb::NotFoundError)
  puts "User not found"
in Failure(error)
  puts "Error: #{error}"
end

# Async with explicit executor
CapnWeb::Async.run do
  user = api.call(:users, :get, id: 123).resolve!
end
```

### Pipelining Syntax

```ruby
# Build pipeline explicitly
pipeline = CapnWeb::Pipeline.new(api)

user_ref = pipeline.call(:authenticate, token: token)
user_id = pipeline.call(:get_user_id, on: user_ref)
profile = pipeline.call(:profiles, :get, id: user_id)

# Execute pipeline (single round trip)
results = pipeline.execute
# => { user_ref: Success(authed_api), user_id: Success(42), profile: Success(profile_data) }

# Or use builder syntax
results = api.pipeline do |p|
  authed = p.authenticate(token)
  user_id = p.on(authed).get_user_id
  p.profiles.get(id: user_id)
end.execute

# Chainable operations with explicit piping
api.users.get(123)
   .pipe { |u| api.profiles.get(u.id) }
   .pipe { |p| api.permissions.for(p.role) }
   .resolve!
```

### Error Handling

```ruby
# Dry::Monads integration
include Dry::Monads[:result, :do]

def fetch_user_profile(id)
  user = yield api.call(:users, :get, id: id).resolve
  profile = yield api.call(:profiles, :get, user_id: user.id).resolve
  Success(profile)
end

# Transaction-style operations
CapnWeb::Transaction.call(api) do
  step :authenticate
  step :fetch_user
  step :fetch_profile

  def authenticate(input)
    api.authenticate(input[:token]).resolve
  end

  # ... etc
end

# Custom error types with metadata
rescue CapnWeb::Error::NotFound => e
  e.resource  # => :user
  e.id        # => 123
  e.details   # => { server_trace: "..." }
end
```

### Exposing Local Objects as RPC Targets

```ruby
# Explicit target registration with schema
class NotificationHandler
  extend CapnWeb::Target::DSL

  rpc_method :on_message do
    param :content, String
    param :sender_id, Integer
    returns nil
  end

  rpc_method :on_disconnect do
    param :reason, String
    returns nil
  end

  def on_message(content:, sender_id:)
    # ...
  end

  def on_disconnect(reason:)
    # ...
  end
end

# Register with session
session.register_target(:notifications, NotificationHandler.new)

# Or pass inline
api.call(:subscribe, handler: CapnWeb::Target.wrap(handler))
```

### Optional Typing (RBS)

```rbs
# sig/api.rbs
interface _UserApi
  def get: (Integer id) -> CapnWeb::Promise[User]
  def list: () -> CapnWeb::Promise[Array[User]]
end

class ApiClient
  include _UserApi
end
```

---

## Approach 3: "Async-Native" (Fiber Scheduler / async gem)

**Philosophy**: Built for Ruby 3.2+ with Fiber Scheduler. Async operations feel synchronous. No callbacks, no `.await!`, just write normal Ruby code inside async contexts. Inspired by Python's asyncio and JavaScript's async/await.

### Connection & Session

```ruby
require 'capnweb'
require 'async'  # Uses async gem's reactor

# Inside async context, everything "just works"
Async do
  api = CapnWeb.connect('wss://api.example.com')

  user = api.users.get(123)  # Automatically awaited!
  puts user.name

  api.close
end

# Explicit async block with CapnWeb's built-in scheduler
CapnWeb.async do |api|
  # Connection URL configured globally or passed to .async
  user = api.users.get(123)
  friends = api.users.get(123).friends

  # Parallel execution
  user, notifications = CapnWeb.gather(
    api.users.get(123),
    api.notifications.list
  )
end

# Configuration
CapnWeb.configure do |c|
  c.default_url = 'wss://api.example.com'
  c.scheduler = :async  # or :fiber, :synchrony, :inline
end
```

### Making RPC Calls

```ruby
CapnWeb.async do |api|
  # Calls look synchronous but are non-blocking
  user = api.users.get(123)
  profile = api.profiles.for(user)

  # Explicit concurrency when needed
  task1 = CapnWeb.spawn { api.users.get(1) }
  task2 = CapnWeb.spawn { api.users.get(2) }

  user1, user2 = task1.wait, task2.wait

  # Or use gather for parallel execution
  users = CapnWeb.gather(
    api.users.get(1),
    api.users.get(2),
    api.users.get(3)
  )

  # Timeouts built-in
  CapnWeb.with_timeout(5) do
    api.slow_operation
  end
end
```

### Pipelining Syntax

```ruby
CapnWeb.async do |api|
  # Pipeline builds automatically from chained calls
  # These all execute in ONE round trip:
  authed = api.authenticate(token)
  user_id = authed.get_user_id
  profile = api.profiles.get(user_id)

  # The pipeline is sent when we first need a resolved value
  puts profile.name  # <- Pipeline executes here

  # Explicit pipeline for complex scenarios
  CapnWeb.pipeline do |p|
    ids = p << api.users.list_ids

    # Map executes server-side
    profiles = ids.map do |id|
      api.profiles.get(id)
    end

    profiles  # Return value of pipeline block
  end
end

# Stream processing for large results
CapnWeb.async do |api|
  api.users.stream.each do |user|
    # Processed as they arrive
    process(user)
  end
end
```

### Error Handling

```ruby
CapnWeb.async do |api|
  # Standard rescue (errors raised at await points)
  begin
    user = api.users.get(123)
  rescue CapnWeb::NotFoundError => e
    user = default_user
  end

  # Retry with backoff
  CapnWeb.retry(times: 3, backoff: :exponential) do
    api.flaky_service.call
  end

  # Circuit breaker pattern
  CapnWeb.circuit(:user_service, threshold: 5) do
    api.users.get(123)
  end
end

# Supervision tree for long-running connections
supervisor = CapnWeb::Supervisor.new do |s|
  s.worker(:api) { CapnWeb.connect(url) }
  s.on_failure(:restart, delay: 1.second)
end
supervisor.start
```

### Exposing Local Objects as RPC Targets

```ruby
# Async-aware targets
class StreamHandler
  include CapnWeb::AsyncTarget

  async def on_data(chunk)
    # Can use async operations inside
    processed = transform(chunk)
    @buffer << processed

    if @buffer.full?
      flush_to_database
    end
  end

  async def on_complete
    flush_to_database
  end
end

# Register and handle callbacks asynchronously
CapnWeb.async do |api|
  handler = StreamHandler.new
  api.subscribe(handler)

  # Keep connection alive, handling callbacks
  CapnWeb.wait_until { handler.complete? }
end
```

### Optional Typing (Sorbet + Async)

```ruby
# typed: strict
extend T::Sig

sig { params(id: Integer).returns(User) }
def fetch_user(id)
  CapnWeb.async do |api|
    api.users.get(id)
  end
end
```

---

## Approach 4: "DSL Builder" (Rails-like Declarative)

**Philosophy**: Define your API contract upfront. Generated stubs with full IDE support. Feels like ActiveRecord or Shrine — declarative configuration, powerful conventions. Best for large teams who want structure.

### Connection & Session

```ruby
require 'capnweb'

# Define API contract (like ActiveRecord schema)
class MyApi < CapnWeb::Api
  endpoint 'wss://api.example.com'

  namespace :users do
    action :get, id: Integer, returns: User
    action :list, returns: [User]
    action :create, params: UserParams, returns: User
  end

  namespace :profiles do
    action :for, user: User, returns: Profile
  end

  # Callbacks
  before_call :log_request
  after_call :log_response
  on_error :handle_error

  private

  def log_request(call)
    Rails.logger.info("RPC: #{call.namespace}.#{call.action}")
  end
end

# Use the API
api = MyApi.connect

# Or with Rails integration
# config/initializers/capnweb.rb
CapnWeb.configure do |c|
  c.register :main_api, MyApi
end

# In controllers/services
api = CapnWeb[:main_api]
```

### Making RPC Calls

```ruby
# Type-safe calls based on API definition
user = api.users.get(123)
# IDE knows: user is User, .get takes Integer

# Validation happens before sending
api.users.create(name: nil)  # => raises CapnWeb::ValidationError

# Scoped queries (like ActiveRecord)
api.users.where(active: true).limit(10).list

# Eager loading relationships
api.users.get(123).includes(:profile, :friends)

# Batch loading (N+1 prevention)
users = api.users.list
profiles = api.profiles.preload(users)
```

### Pipelining Syntax

```ruby
# Declarative pipeline definition
class FetchUserWithProfile < CapnWeb::Pipeline
  step :authenticate do |token|
    api.authenticate(token)
  end

  step :fetch_user, depends_on: :authenticate do |auth|
    api.users.get(auth.user_id)
  end

  step :fetch_profile, depends_on: :fetch_user do |user|
    api.profiles.for(user)
  end

  # All steps execute in optimal round-trips
end

# Use it
result = FetchUserWithProfile.call(token: auth_token)
result.profile.name

# Or inline
api.pipeline(:fetch_complete_user) do
  auth = authenticate(token)
  user = users.get(auth.user_id)
  profile = profiles.for(user)

  { user: user, profile: profile }
end
```

### Error Handling

```ruby
# Declarative error handling in API definition
class MyApi < CapnWeb::Api
  rescue_from CapnWeb::NotFoundError, with: :handle_not_found
  rescue_from CapnWeb::AuthError, with: :handle_auth_error

  # Transform errors to domain exceptions
  error_mapping do
    map 'USER_NOT_FOUND', to: UserNotFoundError
    map 'PERMISSION_DENIED', to: PermissionDeniedError
  end

  # Retry configuration
  retry_policy do
    on CapnWeb::ConnectionError, times: 3, backoff: :exponential
    on CapnWeb::RateLimitError, times: 1, delay: -> { |e| e.retry_after }
  end
end

# In use
begin
  api.users.get(123)
rescue UserNotFoundError => e
  # Domain-specific error
end
```

### Exposing Local Objects as RPC Targets

```ruby
# Declarative target definition
class WebhookReceiver < CapnWeb::Target
  # Define available RPC methods
  exposes :on_event, :on_error

  # Input validation
  validates :on_event do
    param :type, String, in: %w[created updated deleted]
    param :payload, Hash
  end

  # Callbacks
  before_rpc :authenticate
  after_rpc :log_call

  def on_event(type:, payload:)
    case type
    when 'created' then handle_create(payload)
    when 'updated' then handle_update(payload)
    when 'deleted' then handle_delete(payload)
    end
  end

  def on_error(message:, code:)
    Sentry.capture_message(message, extra: { code: code })
  end

  private

  def authenticate(call)
    raise CapnWeb::Unauthorized unless call.metadata[:token] == ENV['WEBHOOK_SECRET']
  end
end

# Register globally
CapnWeb.register_target(WebhookReceiver)

# Or instance-based
api.register(:webhooks, WebhookReceiver.new)
```

### Optional Typing (RBS + Steep)

```ruby
# Generate RBS from API definition
# $ capnweb generate:types MyApi

# sig/my_api.rbs (auto-generated)
class MyApi
  def users: () -> MyApi::Users

  class Users
    def get: (Integer id) -> User
    def list: () -> Array[User]
  end
end
```

### Rails Integration

```ruby
# Gemfile
gem 'capnweb-rails'

# config/capnweb.yml
development:
  main_api:
    url: ws://localhost:3001
    timeout: 10

production:
  main_api:
    url: <%= ENV['API_URL'] %>
    pool_size: 10

# app/apis/my_api.rb
class MyApi < CapnWeb::Api
  # ...
end

# In controllers
class UsersController < ApplicationController
  def show
    @user = capnweb.users.get(params[:id])
  end

  private

  def capnweb
    @capnweb ||= MyApi.connect
  end
end
```

---

## Comparison Matrix

| Feature | Approach 1: Magic | Approach 2: Explicit | Approach 3: Async | Approach 4: DSL |
|---------|------------------|---------------------|-------------------|-----------------|
| Learning curve | Low | Medium | Medium | Medium-High |
| Type safety | Optional | Strong | Optional | Strong |
| IDE support | Limited | Excellent | Good | Excellent |
| Testing ease | Medium | Excellent | Good | Excellent |
| Async model | Blocks/await! | Explicit/Monads | Native Fibers | Callbacks |
| Error handling | Exceptions | Result monads | Exceptions | Declarative |
| Best for | Scripts, prototypes | Complex apps | High-concurrency | Large teams |
| Ruby feel | Rails-like | Dry-rb-like | Modern Ruby 3 | Framework-like |

---

## Recommended Hybrid Approach

After exploring these approaches, the ideal Ruby library might combine the best elements:

```ruby
require 'capnweb'

# Simple case: Magic and blocks (Approach 1)
CapnWeb.connect('wss://api.example.com') do |api|
  user = api.users.get(123).await!
end

# Type-safe case: Define contracts (Approach 4)
class MyApi < CapnWeb::Api
  namespace :users do
    action :get, id: Integer, returns: User
  end
end

# Async case: Native fibers (Approach 3)
CapnWeb.async do |api|
  user = api.users.get(123)  # No await needed
end

# Complex case: Explicit control (Approach 2)
result = api.users.get(123).resolve
case result
in Success(user) then process(user)
in Failure(e) then handle_error(e)
end
```

The library should detect the context and adapt:
- Inside `Async { }` block: fiber-based, auto-await
- With `.await!`: blocking, exception-based
- With `.resolve`: explicit, Result-based
- With API class: typed, IDE-friendly

This gives Rubyists the freedom to choose their style while maintaining a consistent underlying protocol implementation.

---

## Implementation Notes

### Core Classes Needed

```ruby
module CapnWeb
  class Session          # Manages connection, import/export tables
  class Stub             # Proxy with method_missing
  class Promise          # Thenable with pipelining support
  class Target           # Base class for remotely-callable objects
  class Pipeline         # Batches calls for single round-trip
  class Transport        # Abstract; WebSocket, HTTP implementations
  class Result           # Success/Failure monad
  class Error            # Base error class with subtypes
end
```

### Key Ruby Features to Leverage

1. **method_missing** — For dynamic stub proxying
2. **BasicObject** — For clean Stub that doesn't inherit Object methods
3. **Fiber Scheduler** — For async-native experience (Ruby 3.2+)
4. **Ractor** — For thread-safe connection pooling (Ruby 3.0+)
5. **Pattern matching** — For elegant Result handling (Ruby 3.0+)
6. **Module#prepend** — For middleware/hooks
7. **refinements** — For optional syntax sugar without global pollution

### Gem Structure

```
capnweb/
  lib/
    capnweb.rb
    capnweb/
      version.rb
      session.rb
      stub.rb
      promise.rb
      target.rb
      pipeline.rb
      transport/
        websocket.rb
        http_batch.rb
      async/
        fiber_scheduler.rb
        async_adapter.rb
      types/
        rbs/
        sorbet/
  sig/
    capnweb.rbs
```

---

## What Makes a Rubyist Say "Beautiful"

1. **Blocks everywhere** — Ruby's killer feature
2. **Method chaining** — Fluent, readable pipelines
3. **Convention over configuration** — Sensible defaults
4. **Duck typing with optional types** — Freedom with safety rails
5. **DSLs that read like English** — `api.users.get(123).await!`
6. **Surprise-free** — Magic that doesn't bite you
7. **Testable** — Easy to mock, stub, inject

The goal: A library that feels like it was born in Ruby, not ported to it.
