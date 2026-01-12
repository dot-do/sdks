# capnweb

[![Gem Version](https://badge.fury.io/rb/capnweb.svg)](https://rubygems.org/gems/capnweb)

**Capability-based RPC that feels like Ruby.**

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  name = api.users.get(123).profile.display_name.await!
end
```

One gem. One block. One round trip. That's it.

---

## Installation

```bash
gem install capnweb
```

Or add to your Gemfile:

```ruby
gem 'capnweb'
```

Requires Ruby 2.7+. For pattern matching: 3.0+. For fiber-based async: 3.2+.

---

## Quick Start

```ruby
require 'capnweb'

CapnWeb.connect('wss://api.example.com') do |api|
  # Call methods
  user = api.users.get(123).await!

  # Chain through properties and methods - still one request
  avatar_url = api.users.get(123).profile.avatar.url.await!

  # Pass keyword arguments naturally
  new_user = api.users.create(
    name: 'Alice',
    email: 'alice@example.com',
    roles: ['admin', 'developer']
  ).await!
end
```

Every method call returns a `Promise`. Call `.await!` to resolve. Chain without awaiting, and it pipelines automatically.

---

## Why Blocks?

Blocks are Ruby's idiom for scoped resources:

```ruby
File.open(path) { |f| ... }           # File auto-closes
Mutex.synchronize { ... }              # Lock auto-releases
CapnWeb.connect(url) { |api| ... }     # Connection auto-closes
```

The connection lives within the block. No cleanup code. No forgotten `.close` calls.

---

## Pipelining Without Thinking

The magic of Cap'n Web: **chain calls before awaiting, and they pipeline**.

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  # These lines build a pipeline - nothing sent yet
  auth = api.authenticate(token)           # Promise - not sent
  user = auth.current_user                 # Chains through auth
  profile = user.profile                   # Chains through user

  # NOW we send everything - one round trip
  result = profile.await!
end
```

Compare to the traditional approach:

```ruby
# Traditional - THREE round trips
auth = api.authenticate(token).await!    # Wait...
user = auth.current_user.await!          # Wait...
profile = user.profile.await!            # Wait...
```

Cap'n Web sends the entire call graph in one request. The server resolves dependencies internally.

---

## Bang Methods Signal Danger

Following Ruby conventions:

```ruby
.await!   # Might raise an exception
.await    # Returns a Result, never raises
```

Just like `save` vs `save!`, `find` vs `find!`.

---

## Parallel Calls with `gather`

Fetch multiple resources simultaneously:

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  user, posts, notifications = CapnWeb.gather(
    api.users.get(123),
    api.posts.recent(limit: 10),
    api.notifications.unread
  )

  puts "#{user.name} has #{notifications.count} unread notifications"
end
```

All three requests fly in parallel; results come back together.

---

## HTTP Batch Mode

For environments without WebSocket support, batch calls into a single HTTP POST:

```ruby
CapnWeb.batch('https://api.example.com/rpc') do |api|
  # Queue up calls - nothing sent yet
  user_promise = api.users.get(123)
  posts_promise = api.posts.by_author(123)

  # Await multiple promises - one HTTP request when block exits
  user, posts = CapnWeb.gather(user_promise, posts_promise)
end
```

---

## Server-Side Mapping with `remap`

Transform collections on the server before they hit the wire:

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  # Get all user names - server maps, you receive strings
  names = api.users.list.remap { |u| u.name }.await!

  # Complex transforms with captured references
  enriched = api.user_ids.remap { |id|
    {
      id: id,
      profile: api.profiles.get(id),
      avatar: api.avatars.get(id)
    }
  }.await!
end
```

The block runs on the server. References like `api.profiles` are captured and sent along. One round trip returns all the data.

---

## Error Handling

### Exception Style (Bang Methods)

```ruby
begin
  user = api.users.get(123).await!
rescue CapnWeb::NotFoundError => e
  puts "User not found: #{e.message}"
rescue CapnWeb::PermissionError => e
  puts "Access denied: #{e.message}"
rescue CapnWeb::ConnectionError => e
  puts "Network error: #{e.message}"
rescue CapnWeb::RpcError => e
  puts "Server error: #{e.message}"
end
```

### Result Style (Safe Methods)

Never raises. Returns a `Result` monad.

```ruby
result = api.users.get(123).await

case result
in CapnWeb::Success(user)
  puts user.name
in CapnWeb::Failure(error)
  puts error.message
end
```

### Pattern Matching (Ruby 3.0+)

```ruby
case api.users.get(123).await
in Success(user) then process(user)
in Failure(CapnWeb::NotFoundError) then create_default_user
in Failure(error) then raise error
end
```

### Functional Chains

```ruby
api.users.get(123).await
  .fmap { |user| user.name.upcase }
  .or { |_error| 'Unknown' }
```

### Inline Rescue

```ruby
user = api.users.get(123)
          .rescue { |_e| default_user }
          .await!
```

### Error Hierarchy

```
CapnWeb::Error
  CapnWeb::ConnectionError     # Network/transport failures
  CapnWeb::TimeoutError        # Request timed out
  CapnWeb::RpcError            # Remote errors
    CapnWeb::NotFoundError     # Resource not found
    CapnWeb::PermissionError   # Access denied
    CapnWeb::ValidationError   # Invalid arguments
```

---

## Fiber-Based Async (Ruby 3.2+)

Inside an async context, promises resolve automatically via the fiber scheduler. No `.await!` needed.

```ruby
CapnWeb.async('wss://api.example.com') do |api|
  user = api.users.get(123)        # Looks sync, runs async
  profile = api.profiles.for(user) # Automatic pipelining

  puts profile.name                # Resolves transparently
end
```

### Parallel Execution in Fibers

```ruby
CapnWeb.async('wss://api.example.com') do |api|
  users = CapnWeb.gather(
    api.users.get(1),
    api.users.get(2),
    api.users.get(3)
  )

  users.each { |u| puts u.name }
end
```

### Timeouts

```ruby
# Per-call timeout
api.users.get(123).await!(timeout: 5)

# Block timeout
CapnWeb.with_timeout(10) do
  api.slow_operation.await!
end
```

---

## Exposing Local Objects (Targets)

Make Ruby objects callable from the remote server. Perfect for callbacks, subscriptions, and bidirectional communication.

### Simple: Include the Module

```ruby
class NotificationHandler
  include CapnWeb::Target

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
api.subscribe(NotificationHandler.new).await!
```

### Lambda Targets

For simple callbacks, use lambdas:

```ruby
# Lambda syntax
api.on_update(->(data) { process(data) }).await!

# Block syntax (preferred for single-method callbacks)
api.on_event { |event| handle(event) }.await!
```

Use lambdas when you need to pass around the callback as a value. Use blocks when the callback is immediately consumed.

### Exporting Promises (Deferred Capabilities)

Pass a Ruby promise as a capability the server can await:

```ruby
class AsyncProcessor
  include CapnWeb::Target

  def process_later(data)
    deferred = CapnWeb::Deferred.new

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
api.register_processor(AsyncProcessor.new).await!
```

The server receives a promise it can pipeline through or await, even though the computation happens in your Ruby process.

### Declarative Targets (With Validation)

```ruby
class WebhookReceiver
  include CapnWeb::Target

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
    raise CapnWeb::Unauthorized unless valid_token?(call.metadata[:token])
  end

  def log_call(call, result)
    logger.info("RPC: #{call.method} -> #{result.class}")
  end
end
```

---

## How BasicObject Proxying Works

Stubs use `BasicObject` and `method_missing` to forward any method:

```ruby
class Stub < BasicObject
  def initialize(session, path = [])
    @session = session
    @path = path
  end

  def method_missing(name, *args, **kwargs, &block)
    if args.empty? && kwargs.empty? && block.nil?
      # Property access: extend the path
      Stub.new(@session, @path + [name])
    else
      # Method call: return a Promise
      Promise.new(@session, @path + [name], args, kwargs)
    end
  end

  def respond_to_missing?(*)
    true  # Accept any method
  end
end
```

This is why `api.users.get(123).profile.name` works without code generation - each `.` creates a new stub extending the path.

---

## How Promise Pipelining Works

Promises support method chaining before resolution:

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
    @session.resolve(self, timeout: timeout)
  end

  def then(&block)
    ChainedPromise.new(self, block)
  end
end
```

When you write `api.users.get(123).profile.name.await!`, the chain builds a tree of operations. The final `.await!` sends everything in one request.

---

## The Result Monad

`Result` wraps success or failure, enabling functional error handling:

```ruby
# Result is either Success(value) or Failure(error)
result = api.users.get(123).await

# Transform the success value
result.fmap { |user| user.name }  # Success(name) or Failure(error)

# Provide a fallback for errors
result.or { |error| default_value }  # value or default_value

# Chain multiple fallible operations
result
  .flat_map { |user| api.posts.by_author(user.id).await }
  .fmap { |posts| posts.map(&:title) }
  .or { [] }

# Pattern match (Ruby 3.0+)
case result
in Success(value) then use(value)
in Failure(CapnWeb::NotFoundError) then nil
in Failure(error) then raise error
end
```

---

## Resource Management

### Block-Scoped Cleanup

```ruby
# Preferred: connection auto-closes
CapnWeb.connect(url) do |api|
  api.users.get(123).await!
end  # Connection closed here

# If you need manual control
api = CapnWeb.connect(url)
begin
  api.users.get(123).await!
ensure
  api.close
end
```

### Fiber Lifecycle

When using `CapnWeb.async`, each fiber has its own context:

```ruby
CapnWeb.async('wss://api.example.com') do |api|
  # Main fiber

  Fiber.schedule do
    # Child fiber - shares the connection
    api.background_task.await!
  end

  api.main_task.await!
end  # All fibers complete, connection closes
```

---

## Security

### Private Methods Stay Private

Only public methods are exposed on targets:

```ruby
class SecureTarget
  include CapnWeb::Target

  def public_method    # Exposed
    internal_helper
  end

  private

  def internal_helper  # NOT exposed
    # ...
  end
end
```

### Token Authentication

```ruby
CapnWeb.connect(url, headers: { 'Authorization' => "Bearer #{token}" }) do |api|
  # Authenticated session
end
```

### Capability-Based Security

The server controls what operations are available. If you don't have a reference to a capability, you can't call it:

```ruby
# Server gives you a user-scoped API
session = api.authenticate(token).await!
my_posts = session.my_posts  # Only YOUR posts

# You can't access other users' posts unless the server
# explicitly gives you that capability
```

---

## Configuration

### Global Configuration

```ruby
CapnWeb.configure do |c|
  c.timeout = 30                           # Default timeout in seconds
  c.pool_size = 5                          # Connection pool size
  c.retry_count = 3                        # Auto-retry on connection errors
  c.on_error { |e| Rails.logger.error(e) } # Global error handler
end
```

### Per-Connection Options

```ruby
CapnWeb.connect(url,
  timeout: 60,
  headers: { 'Authorization' => token },
  reconnect: true
) do |api|
  # ...
end
```

---

## Rails Integration

```ruby
# Gemfile
gem 'capnweb'

# config/initializers/capnweb.rb
CapnWeb.configure do |c|
  c.default_url = ENV['API_URL']
  c.timeout = 30
  c.on_error { |e| Rails.logger.error(e) }
end

# app/services/user_service.rb
class UserService
  def self.find(id)
    CapnWeb.connect do |api|
      api.users.get(id).await!
    end
  end

  def self.find_with_posts(id)
    CapnWeb.connect do |api|
      user, posts = CapnWeb.gather(
        api.users.get(id),
        api.posts.by_author(id)
      )
      { user: user, posts: posts }
    end
  end
end

# app/controllers/users_controller.rb
class UsersController < ApplicationController
  def show
    @user = UserService.find(params[:id])
  rescue CapnWeb::NotFoundError
    head :not_found
  end
end
```

---

## Sinatra Integration

```ruby
require 'sinatra'
require 'capnweb'

CapnWeb.configure do |c|
  c.default_url = ENV['API_URL']
end

get '/users/:id' do
  CapnWeb.connect do |api|
    @user = api.users.get(params[:id]).await!
    erb :user
  end
rescue CapnWeb::NotFoundError
  halt 404
end
```

---

## With the Async Gem

For high-concurrency applications, combine with the `async` gem:

```ruby
require 'async'
require 'capnweb'

Async do
  CapnWeb.async('wss://api.example.com') do |api|
    # True non-blocking IO
    users = api.users.list.await!

    # Parallel fiber execution
    Async do |task|
      users.each do |user|
        task.async do
          api.enrich(user).await!
        end
      end
    end
  end
end
```

---

## Type Annotations

### Sorbet

```ruby
# typed: strict
extend T::Sig

class UserService
  sig { params(id: Integer).returns(User) }
  def fetch_user(id)
    CapnWeb.connect(API_URL) do |api|
      api.users.get(id).await!
    end
  end
end

# With Promise types
sig { params(id: Integer).returns(CapnWeb::Promise[User]) }
def fetch_user_async(id)
  api.users.get(id)
end
```

### RBS Type Definitions

```rbs
# sig/capnweb.rbs
module CapnWeb
  def self.connect: (String url) -> Session
                  | [T] (String url) { (Stub) -> T } -> T

  class Promise[T]
    def await!: (?timeout: Integer) -> T
    def await: (?timeout: Integer) -> Result[T, Error]
    def then: [U] { (T) -> U } -> Promise[U]
    def rescue: { (Error) -> T } -> Promise[T]
    def remap: [U] { (T) -> U } -> Promise[Array[U]]
  end

  class Result[T, E]
    def fmap: [U] { (T) -> U } -> Result[U, E]
    def flat_map: [U] { (T) -> Result[U, E] } -> Result[U, E]
    def or: { (E) -> T } -> T
  end

  class Deferred[T]
    def resolve: (T) -> void
    def reject: (Error) -> void
    def promise: -> Promise[T]
  end
end
```

---

## Complete Example

A chat application demonstrating all major features:

```ruby
require 'capnweb'

# Callback handler for incoming messages
class ChatHandler
  include CapnWeb::Target

  def initialize(username)
    @username = username
  end

  def on_message(channel:, from:, content:)
    puts "[##{channel}] #{from}: #{content}" unless from == @username
  end

  def on_user_joined(channel:, username:)
    puts "* #{username} joined ##{channel}"
  end

  def on_user_left(channel:, username:)
    puts "* #{username} left ##{channel}"
  end
end

# Connect and interact
CapnWeb.connect('wss://chat.example.com') do |api|
  # Authenticate (pipelined with next call)
  session = api.authenticate(ENV['CHAT_TOKEN'])
               .current_session
               .await!

  puts "Connected as #{session.user.name}"

  # Set up message handler
  handler = ChatHandler.new(session.user.name)
  api.subscribe(handler).await!

  # Join a channel
  channel = api.channels.join('ruby-lovers').await!

  # Fetch history and members in parallel
  history, members = CapnWeb.gather(
    channel.messages(limit: 50),
    channel.members
  )

  puts "#{members.count} users online"
  history.each { |msg| puts "[#{msg.time}] #{msg.from}: #{msg.content}" }

  # Use remap to extract just the member names server-side
  member_names = channel.members.remap { |m| m.name }.await!
  puts "Online: #{member_names.join(', ')}"

  # Send a message
  api.messages.send(
    channel: 'ruby-lovers',
    content: "Hello from Cap'n Web!"
  ).await!

  # Keep connection alive for incoming messages
  puts "Listening for messages (Ctrl+C to quit)..."
  loop { sleep 1 }
rescue Interrupt
  puts "\nDisconnecting..."
end
```

---

## Architecture

### Core Classes

```ruby
module CapnWeb
  # Entry Points
  def self.connect(url, &block)     # WebSocket session
  def self.batch(url, &block)       # HTTP batch session
  def self.async(url, &block)       # Fiber-based async
  def self.gather(*promises)        # Parallel resolution
  def self.configure(&block)        # Global configuration

  # Core
  class Session      # Manages connection, import/export tables
  class Stub         # Dynamic proxy via method_missing
  class Promise      # Chainable, pipelined calls
  class Result       # Success/Failure monad
  class Deferred     # Create promises you resolve yourself
  class Target       # Module for exposable objects
  class Transport    # Abstract; WebSocket/HTTP implementations

  # Errors
  class Error < StandardError
  class ConnectionError < Error
  class TimeoutError < Error
  class RpcError < Error
end
```

---

## Protocol

Cap'n Web uses JSON over WebSocket (or batched HTTP POST). Key features:

- **Bidirectional**: Both sides can call each other
- **Pipelining**: Chain calls without waiting for intermediate results
- **Capability-based**: Pass object references, not just data
- **Promise-based**: Lazy evaluation with automatic batching
- **Remap**: Server-side mapping for efficient data transforms

See [protocol.md](../../protocol.md) for the wire format specification.

---

## Comparison with Other Ruby RPC Libraries

| Feature | Cap'n Web | gRPC-Ruby | Faraday | HTTParty |
|---------|-----------|-----------|---------|----------|
| Dynamic stubs | Yes | No (codegen) | N/A | N/A |
| Pipelining | Yes | No | No | No |
| Bidirectional | Yes | Yes | No | No |
| Capability passing | Yes | No | No | No |
| Server-side map | Yes | No | No | No |
| WebSocket | Yes | No | No | No |
| HTTP batch | Yes | No | Yes | Yes |
| Zero codegen | Yes | No | Yes | Yes |

---

## License

MIT

---

## Philosophy

> "The goal: A library that feels like it was born in Ruby, not ported to it."

A Ruby developer sees this and immediately understands:

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  user = api.users.get(123).await!
  puts user.name
end
```

No documentation needed. No surprises. Just Ruby.
