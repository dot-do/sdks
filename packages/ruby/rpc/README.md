# rpc.do

[![Gem Version](https://badge.fury.io/rb/rpc.do.svg)](https://rubygems.org/gems/rpc.do)

**The magic proxy that makes any `.do` service feel like Ruby.**

```ruby
require 'rpc.do'

# Magic proxy: attribute access routes to *.do domains
users = RPC.mongo.users.find(active: true).await!     # -> mongo.do
payment = RPC.stripe.charges.create(amount: 2000).await!  # -> stripe.do
result = RPC.openai.chat.completions(model: 'gpt-4').await!  # -> openai.do
```

One require. Any service. Zero configuration.

---

## What is rpc.do?

`rpc.do` is the managed RPC layer for the `.do` ecosystem. It sits between raw [capnweb](https://rubygems.org/gems/capnweb) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `RPC.service.anything.you.want` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Authenticate seamlessly** - Integrates with `oauth.do`

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  rpc.do  | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Magic proxy (RPC.service.method)
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining
    +--- Auth integration
```

---

## rpc.do vs capnweb

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side `.remap` | Yes | Yes (enhanced) |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc.do** when you're calling `.do` services and want maximum flexibility.

---

## Installation

```bash
gem install rpc.do
```

Or add to your Gemfile:

```ruby
gem 'rpc.do'
```

Requires Ruby 3.1+. For Ractor support: 3.2+. For fiber-based async: 3.2+ with `async` gem.

---

## Quick Start

### The Magic Proxy

The `RPC` constant is a magic proxy. Every method call creates a route to a `.do` domain:

```ruby
require 'rpc.do'

# RPC.mongo -> mongo.do
# RPC.stripe -> stripe.do
# RPC.github -> github.do

# Find users in MongoDB
users = RPC.mongo.users.find(status: 'active').await!

# Create a Stripe charge
charge = RPC.stripe.charges.create(
  amount: 2000,
  currency: 'usd',
  source: 'tok_visa'
).await!

# Call any .do service
result = RPC.myservice.do_something(arg1: 'value').await!
```

### How Does It Work?

When you access `RPC.mongo`, the proxy:

1. Resolves `mongo` to `mongo.do`
2. Establishes a WebSocket connection to `wss://mongo.do/rpc`
3. Authenticates using your `RPC_DO_TOKEN` environment variable
4. Returns a capability stub for making RPC calls
5. Pools and reuses the connection for subsequent calls

```ruby
# These all route automatically:
RPC.mongo          # -> wss://mongo.do/rpc
RPC.database       # -> wss://database.do/rpc
RPC.agents         # -> wss://agents.do/rpc
RPC.workflows      # -> wss://workflows.do/rpc
RPC.functions      # -> wss://functions.do/rpc
```

### Authentication

Set your API token as an environment variable:

```bash
export RPC_DO_TOKEN="your-api-token"
```

Or configure programmatically:

```ruby
RpcDo.configure do |config|
  config.token = 'your-api-token'
end
```

---

## Ruby Idioms

### Blocks for Scoped Connections

Ruby developers expect blocks for resource management:

```ruby
# Auto-closing connection (like File.open)
RPC.with_connection('wss://mongo.do') do |mongo|
  users = mongo.users.find(active: true).await!
  # Connection closes when block exits
end

# Compare to Ruby's standard patterns:
File.open(path) { |f| ... }           # File auto-closes
Mutex.synchronize { ... }              # Lock auto-releases
RPC.with_connection(url) { |api| ... } # Connection auto-closes
```

### Bang Methods Signal Danger

Following Ruby's conventions:

```ruby
.await!   # Might raise an exception
.await    # Returns a Result, never raises
```

Just like `save` vs `save!`, `find` vs `find!`:

```ruby
# Bang version - raises on error
user = RPC.users.get(123).await!

# Non-bang version - returns Result
result = RPC.users.get(123).await

case result
in RpcDo::Success(user)
  puts user.name
in RpcDo::Failure(error)
  puts "Failed: #{error.message}"
end
```

### method_missing for Dynamic Proxies

The magic proxy uses `BasicObject` and `method_missing`:

```ruby
# Every method call is captured
RPC.users                # proxy with path ["users"]
RPC.users.get            # proxy with path ["users", "get"]
RPC.users.get(123)       # RpcPromise for call to "get" with args [123]
```

This is why `RPC.users.get(123).profile.name` works without code generation.

### Enumerator for Streaming

Use Ruby's native `Enumerator` for streaming results:

```ruby
# Stream change events from MongoDB
RPC.mongo.users.watch.each do |change|
  puts "Change detected: #{change['operationType']}"

  case change['operationType']
  when 'insert'
    process_new_user(change['fullDocument'])
  when 'update'
    sync_user_update(change['fullDocument'])
  end
end

# Lazy enumeration
changes = RPC.mongo.orders.watch.lazy
             .select { |c| c['fullDocument']['amount'] > 100 }
             .take(10)
             .to_a

# With Enumerator::Lazy for memory efficiency
large_collection = RPC.mongo.users.find({}).each.lazy
  .map { |u| transform(u) }
  .select { |u| u[:active] }
  .first(100)
```

### Ractor for Thread Safety

For concurrent applications, use Ractors (Ruby 3.2+):

```ruby
# Ractor-safe client creation
results = 4.times.map do |i|
  Ractor.new(i) do |worker_id|
    # Each Ractor gets its own client
    client = RpcDo::Client.new

    100.times.map do |j|
      client.tasks.process(worker: worker_id, task: j).await!
    end
  end
end

# Collect results from all Ractors
all_results = results.flat_map(&:take)
```

---

## Pipelining Without Thinking

The killer feature inherited from capnweb. Chain calls without awaiting intermediate results.

### The Problem

```ruby
# Traditional approach: THREE round trips
auth = RPC.auth.authenticate(token).await!      # Wait for network...
user = RPC.users.get(auth[:user_id]).await!     # Wait for network...
profile = RPC.profiles.get(user[:profile_id]).await!  # Wait for network...
```

### The Solution

```ruby
# With pipelining: ONE round trip
profile = RPC.auth.authenticate(token).user.profile.await!
```

### How Pipelining Works

Every attribute access and method call returns an `RpcPromise` - a lazy proxy that records operations without executing them. When you finally call `await!`, rpc.do sends the entire chain as a single request:

```ruby
# Build the pipeline - nothing sent yet
auth = RPC.auth.authenticate(token)      # RpcPromise
user = auth.user                         # RpcPromise (pipelines through auth)
profile = user.profile                   # RpcPromise (pipelines through user)

# NOW we send everything - one round trip
result = profile.await!
```

The server receives the complete expression graph and resolves dependencies internally.

### Parallel Pipelines with gather

Fetch multiple resources simultaneously:

```ruby
# Branch from the same session - single round trip
session = RPC.auth.authenticate(token)

user, permissions, settings, notifications = RpcDo.gather(
  session.user,
  session.permissions,
  session.settings,
  session.notifications.unread
)

puts "#{user[:name]} has #{notifications.count} unread notifications"
```

### Cross-Service Pipelining

Pipeline across different `.do` services:

```ruby
# Get user from database, then enrich from multiple services
user = RPC.database.users.get(user_id)

# All resolve together in minimal round trips
user_data, avatar, activity, subscription = RpcDo.gather(
  user,
  RPC.storage.avatars.get(user.avatar_id),
  RPC.analytics.users.activity(user.id),
  RPC.billing.subscriptions.get(user.subscription_id)
)
```

---

## Server-Side Map with remap

Transform collections on the server to avoid N+1 round trips.

### The N+1 Problem

```ruby
# BAD: N+1 round trips
user_ids = RPC.users.list_ids.await!        # 1 round trip
profiles = user_ids.map do |id|
  RPC.profiles.get(id).await!               # N round trips
end
```

### The Solution: remap

```ruby
# GOOD: 1 round trip total
profiles = RPC.users.list.remap { |u| u.profile }.await!

# Complex transforms with captured references
enriched = RPC.users.list.remap do |user|
  {
    id: user.id,
    name: user.name,
    profile: RPC.profiles.get(user.id),
    avatar: RPC.storage.avatars.get(user.avatar_id)
  }
end.await!
```

### How remap Works

The block is serialized and sent to the server. The server executes the mapping operation and returns results:

```ruby
# This block
{ |u| u.email }

# Becomes this expression sent to server
"u => u.email"
```

### remap Constraints

**Important:** Block serialization has constraints:

1. **Only simple blocks** - Single-expression blocks that access the parameter and captured references
2. **No arbitrary code** - You cannot call arbitrary Ruby methods inside the block
3. **Captured values must be serializable** - Numbers, strings, API stubs are fine; database connections are not
4. **No side effects** - The block should be pure; side effects may execute multiple times or not at all

```ruby
# GOOD: Simple property access
emails = RPC.mongo.users.find({}).remap { |u| u[:email] }.await!

# GOOD: Simple transformation
names = RPC.mongo.users.find({}).remap { |u|
  "#{u[:first_name]} #{u[:last_name]}"
}.await!

# GOOD: Captured service references
storage = RPC.storage
enriched = RPC.mongo.users.find({}).remap { |u|
  { user: u, avatar: storage.avatars.get(u[:avatar_id]) }
}.await!

# BAD: Arbitrary method calls
def custom_transform(u)
  database.lookup(u[:id])  # Won't work!
end

# BAD: Complex control flow
RPC.users.find({}).remap { |u|
  u[:active] ? u[:name] : 'inactive'  # May not work
}
```

For complex transformations, fetch and transform locally:

```ruby
users = RPC.mongo.users.find({}).await!
transformed = users.map { |u| custom_transform(u) }
```

---

## Error Handling

### Exception Style (Bang Methods)

```ruby
begin
  user = RPC.users.get(123).await!
rescue RpcDo::NotFoundError => e
  puts "User not found: #{e.message}"
rescue RpcDo::PermissionError => e
  puts "Access denied: #{e.message}"
rescue RpcDo::ConnectionError => e
  puts "Network error: #{e.message}"
rescue RpcDo::TimeoutError => e
  puts "Request timed out"
rescue RpcDo::RpcError => e
  puts "Server error: #{e.message}"
end
```

### Result Style (Safe Methods)

Never raises. Returns a `Result` monad:

```ruby
result = RPC.users.get(123).await

case result
in RpcDo::Success(user)
  puts user[:name]
in RpcDo::Failure(error)
  puts error.message
end
```

### Pattern Matching (Ruby 3.0+)

```ruby
case RPC.users.get(123).await
in Success(user) then process(user)
in Failure(RpcDo::NotFoundError) then create_default_user
in Failure(error) then raise error
end
```

### Functional Chains

```ruby
RPC.users.get(123).await
  .fmap { |user| user[:name].upcase }
  .or { |_error| 'Unknown' }
```

### Inline Rescue

```ruby
user = RPC.users.get(123)
         .rescue { |_e| default_user }
         .await!
```

### Error Hierarchy

```
RpcDo::Error
  RpcDo::ConnectionError     # Network/transport failures
  RpcDo::TimeoutError        # Request timed out
  RpcDo::RpcError            # Remote errors
    RpcDo::NotFoundError     # Resource not found
    RpcDo::PermissionError   # Access denied
    RpcDo::ValidationError   # Invalid arguments
```

### Pattern Matching with Error Codes

```ruby
result = RPC.mongo.users.find_one(_id: user_id).await

case result
in Failure(RpcDo::RpcError => e) if e.code == 'NotFoundError'
  nil
in Failure(RpcDo::RpcError => e) if e.code == 'PermissionDeniedError'
  raise PermissionError, "Access denied to user #{user_id}"
in Failure(RpcDo::RpcError => e) if e.code == 'ValidationError'
  raise ArgumentError, e.message
in Failure(error)
  raise error
in Success(user)
  user
end
```

### Retry with Exponential Backoff

```ruby
def with_retry(max_attempts: 3, base_delay: 1.0, max_delay: 30.0, jitter: true)
  last_error = nil

  max_attempts.times do |attempt|
    begin
      return yield
    rescue RpcDo::ConnectionError, RpcDo::TimeoutError => e
      last_error = e
      raise if attempt == max_attempts - 1

      delay = [base_delay * (2 ** attempt), max_delay].min
      delay += rand * delay * 0.1 if jitter
      sleep delay
    rescue RpcDo::RpcError => e
      # Don't retry client errors
      raise if %w[ValidationError NotFoundError PermissionDeniedError].include?(e.code)

      last_error = e
      raise if attempt == max_attempts - 1

      delay = [base_delay * (2 ** attempt), max_delay].min
      sleep delay
    end
  end

  raise last_error
end

# Usage
user = with_retry { RPC.users.get(123).await! }
```

---

## Streaming with Enumerator

### Basic Streaming

```ruby
# Stream change events from MongoDB
RPC.mongo.users.watch.each do |change|
  puts "Change detected: #{change['operationType']}"

  if change['operationType'] == 'insert'
    new_user = change['fullDocument']
    puts "New user: #{new_user['name']}"
  end

  break if should_stop?
end
```

### Lazy Enumeration

```ruby
# Memory-efficient processing of large collections
RPC.mongo.orders.find({}).each.lazy
  .select { |o| o[:amount] > 100 }
  .map { |o| process_order(o) }
  .take(1000)
  .each { |result| save_result(result) }
```

### Async Enumeration (with async gem)

```ruby
require 'async'

Async do
  enum = RPC.events.subscribe(types: %w[user.created order.completed])

  enum.each do |event|
    case event[:type]
    when 'user.created'
      Async { handle_user_created(event[:data]) }
    when 'order.completed'
      Async { handle_order_completed(event[:data]) }
    end
  end
end
```

### Cursor-Based Pagination

```ruby
def paginate(collection, query = {}, page_size: 100)
  Enumerator.new do |yielder|
    cursor = nil

    loop do
      page = collection.find(query, limit: page_size, cursor: cursor).await!

      page[:documents].each { |doc| yielder << doc }

      break unless page[:has_more]
      cursor = page[:next_cursor]
    end
  end
end

# Usage
paginate(RPC.mongo.users, status: 'active').each do |user|
  process_user(user)
end
```

---

## Targets: Exposing Ruby Objects

Make Ruby objects callable from the remote server. Perfect for callbacks, subscriptions, and bidirectional communication.

### Simple: Include the Module

```ruby
class NotificationHandler
  include RpcDo::Target

  def on_message(content:, sender:)
    puts "[#{sender}] #{content}"
  end

  def on_disconnect(reason:)
    puts "Disconnected: #{reason}"
  end

  private

  def internal_method  # Private methods are NOT exposed
    # ...
  end
end

# Pass to server as a callback
RPC.subscribe(NotificationHandler.new).await!
```

### Lambda Targets

For simple callbacks, use lambdas:

```ruby
# Lambda syntax
RPC.on_update(->(data) { process(data) }).await!

# Block syntax (preferred for single-method callbacks)
RPC.on_event { |event| handle(event) }.await!
```

### Exporting Promises (Deferred Capabilities)

Pass a Ruby promise as a capability the server can await:

```ruby
class AsyncProcessor
  include RpcDo::Target

  def process_later(data)
    deferred = RpcDo::Deferred.new

    Thread.new do
      result = expensive_computation(data)
      deferred.resolve(result)
    rescue => e
      deferred.reject(e)
    end

    deferred.promise  # Server receives this as a capability
  end
end

# Server can call processor.process_later(data) and await the result
RPC.register_processor(AsyncProcessor.new).await!
```

### Declarative Targets (With Validation)

```ruby
class WebhookReceiver
  include RpcDo::Target

  # Explicitly declare exposed methods
  exposes :on_event, :on_error

  # Input validation
  validates :on_event do
    param :type, String
    param :payload, Hash
  end

  # Lifecycle hooks
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
    logger.error("#{code}: #{message}")
  end

  private

  def authenticate(call)
    raise RpcDo::Unauthorized unless valid_token?(call.metadata[:token])
  end

  def log_call(call, result)
    logger.info("RPC: #{call.method} -> #{result.class}")
  end
end
```

### Bidirectional Streaming Handler

```ruby
class OrderProcessor
  include RpcDo::Target

  def initialize
    @orders_processed = 0
  end

  def on_order(order)
    puts "Processing order: #{order[:id]}"

    result = process(order)
    @orders_processed += 1

    { status: 'processed', order_id: order[:id] }
  end

  def on_batch(orders)
    orders.map { |order| on_order(order) }
  end

  def dispose
    puts "Processor disposed. Processed #{@orders_processed} orders."
  end
end

# Register the processor
processor = OrderProcessor.new
subscription = RPC.orders.subscribe(processor, region: 'us-west').await!

# Server can now call processor.on_order(), etc.
# Keep alive while processing
sleep 3600

# Cleanup
subscription.cancel.await!
```

---

## Fiber-Based Async (Ruby 3.2+)

Inside an async context, promises resolve automatically via the fiber scheduler. No `.await!` needed.

```ruby
require 'async'

Async do
  RPC.async('wss://api.example.com') do |api|
    user = api.users.get(123)        # Looks sync, runs async
    profile = api.profiles.for(user) # Automatic pipelining

    puts profile[:name]              # Resolves transparently
  end
end
```

### Parallel Execution in Fibers

```ruby
require 'async'

Async do
  RPC.async('wss://api.example.com') do |api|
    # Launch concurrent tasks
    users = 3.times.map do |i|
      Async { api.users.get(i).await! }
    end

    # Collect results
    users.each { |task| puts task.wait[:name] }
  end
end
```

### Timeouts

```ruby
# Per-call timeout
RPC.users.get(123).await!(timeout: 5)

# Block timeout
RpcDo.with_timeout(10) do
  RPC.slow_operation.await!
end

# Using Ruby's Timeout module
require 'timeout'

Timeout.timeout(30) do
  result = RPC.long_running_task.await!
end
```

---

## Rails Integration

### Configuration

```ruby
# config/initializers/rpc_do.rb
RpcDo.configure do |config|
  config.token = Rails.application.credentials.rpc_do_token
  config.timeout = 30
  config.pool_size = 10
  config.on_error { |e| Rails.logger.error(e) }

  # Environment-specific endpoints
  if Rails.env.development?
    config.endpoint_suffix = '.dev.do'
  elsif Rails.env.staging?
    config.endpoint_suffix = '.staging.do'
  end
end
```

### Service Objects

```ruby
# app/services/user_service.rb
class UserService
  class << self
    def find(id)
      RPC.users.get(id).await!
    rescue RpcDo::NotFoundError
      nil
    end

    def find!(id)
      RPC.users.get(id).await!
    end

    def find_with_posts(id)
      user, posts = RpcDo.gather(
        RPC.users.get(id),
        RPC.posts.by_author(id)
      )
      { user: user, posts: posts }
    end

    def search(query, page: 1, per_page: 20)
      RPC.users.search(
        query: query,
        skip: (page - 1) * per_page,
        limit: per_page
      ).await!
    end

    def create(attributes)
      RPC.users.create(**attributes).await!
    rescue RpcDo::ValidationError => e
      raise ActiveRecord::RecordInvalid.new(e.data[:errors])
    end
  end
end
```

### Controllers

```ruby
# app/controllers/users_controller.rb
class UsersController < ApplicationController
  rescue_from RpcDo::NotFoundError, with: :not_found
  rescue_from RpcDo::PermissionError, with: :forbidden
  rescue_from RpcDo::RpcError, with: :server_error

  def index
    @users = UserService.search(params[:q], page: params[:page] || 1)
  end

  def show
    @user = UserService.find!(params[:id])
  end

  def create
    @user = UserService.create(user_params)
    redirect_to @user, notice: 'User created successfully.'
  rescue RpcDo::ValidationError => e
    @user = User.new(user_params)
    @user.errors.add(:base, e.message)
    render :new, status: :unprocessable_entity
  end

  private

  def not_found
    render file: Rails.public_path.join('404.html'), status: :not_found
  end

  def forbidden
    render file: Rails.public_path.join('403.html'), status: :forbidden
  end

  def server_error(exception)
    Rails.logger.error("RPC Error: #{exception.message}")
    render file: Rails.public_path.join('500.html'), status: :internal_server_error
  end

  def user_params
    params.require(:user).permit(:name, :email, :role)
  end
end
```

### Active Job Integration

```ruby
# app/jobs/sync_user_job.rb
class SyncUserJob < ApplicationJob
  queue_as :default
  retry_on RpcDo::ConnectionError, wait: :exponentially_longer, attempts: 5
  discard_on RpcDo::NotFoundError

  def perform(user_id)
    user = RPC.users.get(user_id).await!

    # Sync to external services
    RpcDo.gather(
      RPC.analytics.track(user_id: user_id, event: 'sync'),
      RPC.email.sync_contact(user),
      RPC.crm.update_customer(user)
    )

    Rails.logger.info("Synced user #{user_id}")
  end
end
```

### ActionCable Integration

```ruby
# app/channels/notifications_channel.rb
class NotificationsChannel < ApplicationCable::Channel
  def subscribed
    @handler = NotificationHandler.new(current_user, self)
    @subscription = RPC.notifications.subscribe(@handler, user_id: current_user.id).await!
  end

  def unsubscribed
    @subscription&.cancel&.await!
  end

  class NotificationHandler
    include RpcDo::Target

    def initialize(user, channel)
      @user = user
      @channel = channel
    end

    def on_notification(notification)
      @channel.transmit(notification)
    end
  end
end
```

### Middleware for Request Context

```ruby
# lib/middleware/rpc_context.rb
class RpcContextMiddleware
  def initialize(app)
    @app = app
  end

  def call(env)
    request_id = env['HTTP_X_REQUEST_ID'] || SecureRandom.uuid

    RpcDo.with_context(
      request_id: request_id,
      user_id: env['warden']&.user&.id
    ) do
      @app.call(env)
    end
  end
end

# config/application.rb
config.middleware.use RpcContextMiddleware
```

### Health Checks

```ruby
# app/controllers/health_controller.rb
class HealthController < ApplicationController
  def show
    checks = {
      database: check_database,
      rpc: check_rpc
    }

    status = checks.values.all? ? :ok : :service_unavailable
    render json: checks, status: status
  end

  private

  def check_rpc
    RPC.health.ping.await!(timeout: 5)
    true
  rescue => e
    Rails.logger.error("RPC health check failed: #{e.message}")
    false
  end
end
```

---

## Sinatra Integration

```ruby
require 'sinatra'
require 'rpc.do'

RpcDo.configure do |config|
  config.token = ENV['RPC_DO_TOKEN']
end

get '/users/:id' do
  content_type :json

  user = RPC.users.get(params[:id]).await!
  user.to_json
rescue RpcDo::NotFoundError
  halt 404, { error: 'User not found' }.to_json
rescue RpcDo::RpcError => e
  halt 500, { error: e.message }.to_json
end

post '/users' do
  content_type :json

  data = JSON.parse(request.body.read, symbolize_names: true)
  user = RPC.users.create(**data).await!

  status 201
  user.to_json
rescue RpcDo::ValidationError => e
  halt 422, { errors: e.data[:errors] }.to_json
end

get '/users/:id/stream' do
  stream(:keep_open) do |out|
    RPC.users.changes(params[:id]).each do |change|
      out << "data: #{change.to_json}\n\n"
    end
  end
end
```

---

## Connection Pooling

### Automatic Pooling

rpc.do automatically pools connections by service:

```ruby
# These reuse the same connection to mongo.do
RPC.mongo.users.find({}).await!
RPC.mongo.orders.find({}).await!
RPC.mongo.products.find({}).await!

# This uses a different connection (redis.do)
RPC.redis.get('key').await!
```

### Pool Configuration

```ruby
RpcDo.configure do |config|
  config.pool_size = 10           # Max connections per service
  config.pool_timeout = 30.0      # Timeout waiting for connection
  config.idle_timeout = 300.0     # Close idle connections after 5 minutes
  config.health_check_interval = 60.0  # Health check every minute
end
```

### Manual Pool Management

```ruby
# Create a dedicated pool for a service
pool = RpcDo::ConnectionPool.new(
  service: 'mongo.do',
  size: 5,
  timeout: 30.0
)

pool.with_connection do |conn|
  result = conn.users.find({}).await!
end

# Drain pool on shutdown
pool.drain
```

---

## Service Discovery

### Default Routing

By default, `RPC.{service}` routes to `{service}.do`:

```ruby
RPC.mongo     # -> wss://mongo.do/rpc
RPC.redis     # -> wss://redis.do/rpc
RPC.stripe    # -> wss://stripe.do/rpc
```

### Custom Service Registry

```ruby
# Define custom service mappings
RpcDo.configure do |config|
  config.registry.register('mongo', 'wss://custom-mongo.example.com/rpc')
  config.registry.register('internal-api', 'wss://internal.example.com/rpc')

  # Environment-based routing
  config.registry.register('database',
    dev: 'wss://dev-db.example.com/rpc',
    staging: 'wss://staging-db.example.com/rpc',
    prod: 'wss://prod-db.example.com/rpc'
  )
end

# Now routes to your custom endpoints
result = RPC.mongo.users.find({}).await!  # -> custom-mongo.example.com
```

### Environment-Based Configuration

```ruby
environment = ENV.fetch('ENVIRONMENT', 'dev')

RpcDo.configure do |config|
  config.environment = environment

  config.endpoints = {
    'dev' => { suffix: '.dev.do' },
    'staging' => { suffix: '.staging.do' },
    'prod' => { suffix: '.do' }
  }
end

# In dev: RPC.mongo -> mongo.dev.do
# In staging: RPC.mongo -> mongo.staging.do
# In prod: RPC.mongo -> mongo.do
```

---

## Testing

### Mock Services with RSpec

```ruby
require 'rspec'
require 'rpc.do'
require 'rpc.do/testing'

RSpec.describe UserService do
  include RpcDo::Testing

  before do
    mock_rpc(:users) do |mock|
      mock.stub(:get).with(123).and_return(
        id: 123,
        name: 'Test User',
        email: 'test@example.com'
      )

      mock.stub(:find).with(any_args).and_return([
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' }
      ])
    end
  end

  it 'finds a user by id' do
    user = UserService.find(123)

    expect(user[:name]).to eq('Test User')
    expect(rpc_calls(:users, :get)).to eq([[123]])
  end

  it 'searches users' do
    users = UserService.search('test')

    expect(users.length).to eq(2)
  end
end
```

### VCR-Style Recording

```ruby
# Record RPC calls in test mode
RpcDo.configure do |config|
  if ENV['RPC_RECORD']
    config.record = true
    config.record_path = 'spec/fixtures/rpc_recordings'
  end

  if ENV['RPC_REPLAY']
    config.replay = true
    config.replay_path = 'spec/fixtures/rpc_recordings'
  end
end

# In tests
RSpec.describe 'Integration', :rpc_recording do
  it 'records and replays RPC calls' do
    user = RPC.users.get(123).await!
    expect(user[:name]).to eq('Real User')
  end
end
```

### Local Test Server

```ruby
require 'rpc.do/testing'

class MockUsersService
  include RpcDo::Target

  def initialize
    @users = {
      '123' => { _id: '123', name: 'Alice' },
      '456' => { _id: '456', name: 'Bob' }
    }
  end

  def find_one(query)
    @users[query[:_id]]
  end

  def find(_query = {})
    @users.values
  end

  def insert_one(doc)
    doc[:_id] = (@users.keys.map(&:to_i).max + 1).to_s
    @users[doc[:_id]] = doc
    { inserted_id: doc[:_id] }
  end
end

RSpec.describe 'With local server' do
  let(:server) { RpcDo::Testing::LocalServer.new }
  let(:client) { RpcDo::Testing::TestClient.new(server) }

  before do
    server.register('users', MockUsersService.new)
  end

  it 'finds a user' do
    user = client.users.find_one(_id: '123').await!
    expect(user[:name]).to eq('Alice')
  end

  it 'creates a user' do
    result = client.users.insert_one(name: 'Charlie').await!
    expect(result[:inserted_id]).to be_present
  end
end
```

### Minitest Support

```ruby
require 'minitest/autorun'
require 'rpc.do'
require 'rpc.do/testing'

class UserServiceTest < Minitest::Test
  include RpcDo::Testing

  def setup
    mock_rpc(:users) do |mock|
      mock.stub(:get).with(123).and_return(id: 123, name: 'Test User')
    end
  end

  def test_find_user
    user = UserService.find(123)

    assert_equal 'Test User', user[:name]
  end
end
```

---

## Observability

### Logging

```ruby
require 'logger'

RpcDo.configure do |config|
  config.logger = Logger.new($stdout)
  config.logger.level = Logger::DEBUG

  # Or use Rails logger
  config.logger = Rails.logger
end
```

### Metrics with Prometheus

```ruby
require 'prometheus/client'

registry = Prometheus::Client.registry

rpc_calls = registry.counter(
  :rpc_calls_total,
  docstring: 'Total RPC calls',
  labels: [:service, :method, :status]
)

rpc_latency = registry.histogram(
  :rpc_call_duration_seconds,
  docstring: 'RPC call latency',
  labels: [:service, :method]
)

RpcDo.configure do |config|
  config.on_call do |call_info|
    rpc_calls.increment(
      labels: {
        service: call_info[:service],
        method: call_info[:method],
        status: call_info[:status]
      }
    )

    rpc_latency.observe(
      call_info[:duration],
      labels: {
        service: call_info[:service],
        method: call_info[:method]
      }
    )
  end
end
```

### OpenTelemetry Tracing

```ruby
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'my-app'
  c.use_all
end

tracer = OpenTelemetry.tracer_provider.tracer('rpc.do')

RpcDo.configure do |config|
  config.around_call do |call_info, &block|
    tracer.in_span(
      "rpc.#{call_info[:service]}.#{call_info[:method]}",
      kind: :client,
      attributes: {
        'rpc.service' => call_info[:service],
        'rpc.method' => call_info[:method],
        'rpc.system' => 'dotdo'
      }
    ) do |span|
      begin
        result = block.call
        span.status = OpenTelemetry::Trace::Status.ok
        result
      rescue => e
        span.status = OpenTelemetry::Trace::Status.error(e.message)
        span.record_exception(e)
        raise
      end
    end
  end
end
```

---

## The Result Monad

`Result` wraps success or failure, enabling functional error handling:

```ruby
# Result is either Success(value) or Failure(error)
result = RPC.users.get(123).await

# Transform the success value
result.fmap { |user| user[:name] }  # Success(name) or Failure(error)

# Provide a fallback for errors
result.or { |error| default_value }  # value or default_value

# Chain multiple fallible operations
result
  .flat_map { |user| RPC.posts.by_author(user[:id]).await }
  .fmap { |posts| posts.map { |p| p[:title] } }
  .or { [] }

# Pattern match (Ruby 3.0+)
case result
in Success(value) then use(value)
in Failure(RpcDo::NotFoundError) then nil
in Failure(error) then raise error
end
```

### Result Combinators

```ruby
# fmap: Transform success value
Success(5).fmap { |x| x * 2 }  # => Success(10)
Failure(error).fmap { |x| x * 2 }  # => Failure(error)

# flat_map: Chain operations that return Results
Success(5)
  .flat_map { |x| Success(x * 2) }
  .flat_map { |x| Success(x + 1) }
# => Success(11)

# or: Provide fallback for failures
Failure(error).or { |e| "default" }  # => "default"
Success(value).or { |e| "default" }  # => value

# success? / failure?: Check state
result.success?  # => true/false
result.failure?  # => true/false
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```ruby
#!/usr/bin/env ruby
# frozen_string_literal: true

#
# Complete rpc.do example: An e-commerce order system demonstrating
# pipelining, streaming, error handling, and workflow orchestration.
#

require 'rpc.do'

# Configuration
RpcDo.configure do |config|
  config.token = ENV['RPC_DO_TOKEN']
  config.timeout = 30.0
  config.retry_attempts = 3
end

# Event Handler (Target for bidirectional RPC)
class OrderEventHandler
  include RpcDo::Target

  def initialize
    @orders_received = []
  end

  def on_order_created(order)
    puts "  [Event] Order created: #{order[:id]}"
    @orders_received << order
  end

  def on_order_shipped(order)
    puts "  [Event] Order shipped: #{order[:id]}"
  end

  def on_order_delivered(order)
    puts "  [Event] Order delivered: #{order[:id]}"
  end

  def dispose
    puts "  [Event] Handler disposed. Received #{@orders_received.length} orders."
  end
end

# Business Logic
module Commerce
  class << self
    # Fetch a product with recommendations using pipelining
    # Single round trip for all data
    def get_product_with_recommendations(product_id)
      # Build pipeline - nothing sent yet
      product = RPC.products.get(product_id)
      recommendations = RPC.recommendations.for_product(product_id)
      reviews = RPC.reviews.for_product(product_id, limit: 5)

      # Single round trip resolves all
      p, r, rv = RpcDo.gather(product, recommendations, reviews)

      {
        product: p,
        recommendations: r,
        reviews: rv
      }
    end

    # Create an order with full workflow
    def create_order(user_id, items)
      puts "Creating order for user #{user_id}..."

      # Step 1: Validate stock (parallel checks)
      stock_checks = items.map { |item| RPC.products.get(item[:product_id]) }
      products = RpcDo.gather(*stock_checks)

      products.zip(items).each do |product, item|
        if product[:stock] < item[:quantity]
          raise ArgumentError, "Insufficient stock for #{product[:name]}"
        end
      end

      puts '  Stock validated'

      # Step 2: Calculate total
      total = products.zip(items).sum do |product, item|
        product[:price] * item[:quantity]
      end

      # Step 3: Create order
      order = RPC.orders.create(
        user_id: user_id,
        items: items,
        total: total
      ).await!
      puts "  Order created: #{order[:id]}"

      # Step 4: Process payment
      begin
        payment = RPC.payments.charge(
          user_id: user_id,
          amount: total,
          order_id: order[:id]
        ).await!
        puts "  Payment processed: #{payment[:id]}"
      rescue RpcDo::RpcError => e
        # Rollback order
        RPC.orders.cancel(order[:id], reason: 'payment_failed').await!
        raise
      end

      # Step 5: Update inventory (parallel)
      inventory_updates = items.map do |item|
        RPC.products.update_stock(item[:product_id], -item[:quantity])
      end
      RpcDo.gather(*inventory_updates)
      puts '  Inventory updated'

      # Step 6: Send notifications (fire and forget)
      Thread.new do
        RPC.notifications.send_order_confirmation(
          user_id: user_id,
          order_id: order[:id]
        ).await!
      end

      # Step 7: Update order status
      order = RPC.orders.update_status(order[:id], 'paid').await!
      puts "  Order status: #{order[:status]}"

      order
    end

    # Search products and transform results server-side
    def search_products_with_transform(query)
      RPC.products.search(query).remap do |p|
        {
          id: p[:id],
          name: p[:name],
          price: p[:price],
          in_stock: p[:stock] > 0
        }
      end.await!
    end
  end
end

# Error handling with pattern matching
def safe_get_user(user_id)
  case RPC.users.get(user_id).await
  in RpcDo::Success(user)
    user
  in RpcDo::Failure(RpcDo::NotFoundError)
    nil
  in RpcDo::Failure(RpcDo::PermissionError)
    raise PermissionError, "Cannot access user #{user_id}"
  in RpcDo::Failure(error)
    raise error
  end
end

# Retry helper
def with_retry(max_attempts: 3, &block)
  attempt = 0
  begin
    attempt += 1
    block.call
  rescue RpcDo::ConnectionError, RpcDo::TimeoutError => e
    raise if attempt >= max_attempts

    delay = 2**(attempt - 1) + rand
    sleep delay
    retry
  end
end

# Main Application
def main
  puts '=' * 60
  puts 'rpc.do E-Commerce Demo'
  puts '=' * 60

  # 1. Pipelining Demo
  puts "\n1. Pipelining Demo"
  puts '-' * 40

  begin
    result = Commerce.get_product_with_recommendations('prod-123')
    puts "  Product: #{result[:product][:name]}"
    puts "  Recommendations: #{result[:recommendations].length} items"
    puts "  Reviews: #{result[:reviews].length} reviews"
  rescue RpcDo::RpcError => e
    puts "  Error: #{e.message}"
  end

  # 2. Order Workflow Demo
  puts "\n2. Order Workflow Demo"
  puts '-' * 40

  begin
    order = Commerce.create_order(
      'user-456',
      [
        { product_id: 'prod-123', quantity: 2 },
        { product_id: 'prod-789', quantity: 1 }
      ]
    )
    puts "  Final order: #{order[:id]} - $#{order[:total]}"
  rescue RpcDo::RpcError => e
    puts "  Workflow failed: #{e.code} - #{e.message}"
  rescue ArgumentError => e
    puts "  Validation failed: #{e.message}"
  end

  # 3. Search with Server-Side Transform
  puts "\n3. Search with Server-Side Transform"
  puts '-' * 40

  begin
    products = Commerce.search_products_with_transform('electronics')
    products.first(3).each do |p|
      status = p[:in_stock] ? 'In Stock' : 'Out of Stock'
      puts "  #{p[:name]}: $#{p[:price]} (#{status})"
    end
  rescue RpcDo::RpcError => e
    puts "  Search failed: #{e.message}"
  end

  # 4. Error Handling Demo
  puts "\n4. Error Handling Demo"
  puts '-' * 40

  user = safe_get_user('nonexistent-user')
  if user.nil?
    puts '  User not found (handled gracefully)'
  else
    puts "  User: #{user[:name]}"
  end

  # 5. Streaming Demo
  puts "\n5. Streaming Demo"
  puts '-' * 40

  handler = OrderEventHandler.new
  puts '  (Streaming would run here in production)'
  puts '  Handler ready to receive events'

  puts "\n" + '=' * 60
  puts 'Demo Complete!'
  puts '=' * 60
end

main if __FILE__ == $PROGRAM_NAME
```

---

## Architecture

### Core Classes

```ruby
module RpcDo
  # Entry Points
  def self.configure(&block)         # Global configuration
  def self.gather(*promises)         # Parallel resolution
  def self.with_connection(url, &)   # Scoped connection
  def self.with_timeout(seconds, &)  # Timeout wrapper

  # Core
  class Client           # Manages connection, import/export tables
  class Proxy            # Dynamic proxy via method_missing
  class Promise          # Chainable, pipelined calls
  class Result           # Success/Failure monad
  class Deferred         # Create promises you resolve yourself
  module Target          # Module for exposable objects
  class Transport        # Abstract; WebSocket/HTTP implementations
  class ConnectionPool   # Connection pooling per service

  # Errors
  class Error < StandardError
  class ConnectionError < Error
  class TimeoutError < Error
  class RpcError < Error
    class NotFoundError < RpcError
    class PermissionError < RpcError
    class ValidationError < RpcError
end
```

### How the Proxy Works

```ruby
class Proxy < BasicObject
  def initialize(client, path = [])
    @client = client
    @path = path
  end

  def method_missing(name, *args, **kwargs, &block)
    if args.empty? && kwargs.empty? && block.nil?
      # Property access: extend the path
      Proxy.new(@client, @path + [name])
    else
      # Method call: return a Promise
      Promise.new(@client, @path + [name], args, kwargs)
    end
  end

  def respond_to_missing?(*)
    true  # Accept any method
  end
end
```

### How Promises Pipeline

```ruby
class Promise
  def method_missing(name, *args, **kwargs)
    # Access properties on unresolved promises
    PipelinedPromise.new(self, name, args, kwargs)
  end

  def await!
    case await
    in Success(value) then value
    in Failure(error) then raise error
    end
  end

  def await(timeout: nil)
    @client.resolve(self, timeout: timeout)
  end

  def then(&block)
    ChainedPromise.new(self, block)
  end

  def remap(&block)
    RemapPromise.new(self, block)
  end
end
```

---

## Type Signatures (RBS)

```rbs
# sig/rpc_do.rbs
module RpcDo
  def self.configure: { (Configuration) -> void } -> void
  def self.gather: [T] (*Promise[T]) -> Array[T]
  def self.with_connection: [T] (String url) { (Client) -> T } -> T

  class Client
    def initialize: (?token: String?, ?timeout: Float?) -> void
    def close: -> void
  end

  class Promise[T]
    def await!: (?timeout: Float?) -> T
    def await: (?timeout: Float?) -> Result[T, Error]
    def then: [U] { (T) -> U } -> Promise[U]
    def rescue: { (Error) -> T } -> Promise[T]
    def remap: [U] { (T) -> U } -> Promise[Array[U]]
  end

  class Result[T, E]
    def fmap: [U] { (T) -> U } -> Result[U, E]
    def flat_map: [U] { (T) -> Result[U, E] } -> Result[U, E]
    def or: { (E) -> T } -> T
    def success?: -> bool
    def failure?: -> bool
  end

  class Deferred[T]
    def resolve: (T) -> void
    def reject: (Error) -> void
    def promise: -> Promise[T]
  end

  module Target
    def exposes: (*Symbol) -> void
    def before_rpc: (Symbol) -> void
    def after_rpc: (Symbol) -> void
  end
end
```

---

## Migration from capnweb

```ruby
# Before (capnweb)
require 'capnweb'

CapnWeb.connect('wss://mongo.do') do |mongo|
  users = mongo.users.find({}).await!
end

# After (rpc.do)
require 'rpc.do'

users = RPC.mongo.users.find({}).await!
```

```ruby
# Before (multiple services)
CapnWeb.connect('wss://mongo.do') do |mongo|
  CapnWeb.connect('wss://redis.do') do |redis|
    user = mongo.users.find_one(_id: '123').await!
    redis.set("user:123", user).await!
  end
end

# After (single proxy)
require 'rpc.do'

user = RPC.mongo.users.find_one(_id: '123').await!
RPC.redis.set('user:123', user).await!
```

---

## Comparison with Other Ruby RPC Libraries

| Feature | rpc.do | gRPC-Ruby | Faraday | HTTParty |
|---------|--------|-----------|---------|----------|
| Dynamic stubs | Yes | No (codegen) | N/A | N/A |
| Pipelining | Yes | No | No | No |
| Bidirectional | Yes | Yes | No | No |
| Capability passing | Yes | No | No | No |
| Server-side map | Yes | No | No | No |
| WebSocket | Yes | No | No | No |
| HTTP batch | Yes | No | Yes | Yes |
| Zero codegen | Yes | No | Yes | Yes |
| Ruby idioms | Yes | Partial | Yes | Yes |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Simple things simple** | `RPC.mongo.find({}).await!` just works |
| **Complex things possible** | Full pipelining, streaming, workflows |
| **Zero configuration** | Environment variables, sensible defaults |
| **Ruby idioms** | Blocks, bang methods, Enumerator, pattern matching |
| **Service mesh ready** | Connection pooling, circuit breakers, retries |
| **Observable** | Hooks for metrics, tracing, logging |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](https://rubygems.org/gems/capnweb) | Low-level capability-based RPC |
| [mongo.do](https://rubygems.org/gems/mongo.do) | MongoDB-specific client |
| [database.do](https://rubygems.org/gems/database.do) | Multi-database client |
| [agents.do](https://rubygems.org/gems/agents.do) | AI agents framework |

---

## License

MIT
