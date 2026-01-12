# Cap'n Web Ruby API

The definitive syntax for idiomatic Ruby RPC.

---

## Design Philosophy

This API synthesizes four explored approaches into one coherent design:

- **Blocks for lifecycle** (from Approach 1) - Ruby's signature feature
- **Method chaining with `method_missing`** (from Approach 1) - Natural pipelining
- **Result monads for safety** (from Approach 2) - Predictable error handling
- **Fiber-native async** (from Approach 3) - Modern Ruby 3.2+ concurrency
- **Declarative targets** (from Approach 4) - Clean callback registration

The result: write code that reads like prose, runs like lightning.

---

## Quick Start

```ruby
require 'capnweb'

# Simple: connect, call, done
CapnWeb.connect('wss://api.example.com') do |api|
  user = api.users.get(123).await!
  puts user.name
end
```

---

## Connection

### Block-Scoped Sessions (Preferred)

```ruby
# WebSocket - auto-closes when block exits
CapnWeb.connect('wss://api.example.com') do |api|
  # Your code here
end

# HTTP batch mode - batches calls, sends on block exit
CapnWeb.batch('https://api.example.com/rpc') do |api|
  user = api.users.get(123)
  friends = api.users.get(123).friends
  # Single HTTP request sent here
end
```

### Long-Lived Connections

```ruby
api = CapnWeb.connect('wss://api.example.com')
# ... use api ...
api.close
```

### Configuration

```ruby
CapnWeb.configure do |c|
  c.timeout = 30
  c.pool_size = 5
  c.on_error { |e| Rails.logger.error(e) }
end
```

---

## Making Calls

Every method call on a stub returns a `Promise`. Resolve it your way.

### The Bang Method: `await!`

Blocks until resolved. Raises on error. Use when you want exceptions.

```ruby
user = api.users.get(123).await!
```

### The Safe Method: `await`

Returns a `Result` monad. Never raises. Use when you want control.

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
in Failure(CapnWeb::NotFoundError) then create_user
in Failure(e) then raise e
end
```

---

## Pipelining

Method chains automatically pipeline. No intermediate network round-trips.

```ruby
# One network call, not three
name = api.users
          .get(123)
          .profile
          .display_name
          .await!
```

### Explicit Parallel Calls

```ruby
# Fetch multiple resources in parallel, single round-trip
user, friends, notifications = CapnWeb.gather(
  api.users.get(123),
  api.users.get(123).friends,
  api.notifications.unread
)
```

### Chained Transformations

```ruby
# Server-side pipelining with .then
api.authenticate(token)
   .get_user_id
   .then { |id| api.profiles.get(id) }
   .await!
```

---

## Async (Ruby 3.2+)

Inside an async context, calls resolve automatically. No `await!` needed.

```ruby
CapnWeb.async('wss://api.example.com') do |api|
  user = api.users.get(123)        # Looks sync, runs async
  profile = api.profiles.for(user) # Automatic pipelining

  puts profile.name                # Resolves here
end
```

### Parallel Execution

```ruby
CapnWeb.async do |api|
  users = CapnWeb.gather(
    api.users.get(1),
    api.users.get(2),
    api.users.get(3)
  )
end
```

### Timeouts

```ruby
api.users.get(123).await!(timeout: 5)

# Or in async context
CapnWeb.with_timeout(5) do
  api.slow_operation
end
```

---

## Error Handling

### Exception Style

```ruby
begin
  user = api.users.get(123).await!
rescue CapnWeb::NotFoundError => e
  user = default_user
rescue CapnWeb::ConnectionError => e
  retry_later
end
```

### Result Style

```ruby
api.users.get(123).await
  .fmap { |user| user.name.upcase }
  .or { |_error| "Unknown" }
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
  CapnWeb::ConnectionError
  CapnWeb::TimeoutError
  CapnWeb::RpcError
    CapnWeb::NotFoundError
    CapnWeb::PermissionError
    CapnWeb::ValidationError
```

---

## Exposing Local Objects (Targets)

Make Ruby objects callable from the remote server.

### Simple: Module Inclusion

```ruby
class NotificationHandler
  include CapnWeb::Target

  def on_message(content:, sender:)
    puts "#{sender}: #{content}"
  end

  def on_disconnect(reason:)
    puts "Disconnected: #{reason}"
  end

  private

  def internal_method  # Not exposed
  end
end

# Pass to server
api.subscribe(NotificationHandler.new).await!
```

### Lambda Targets

```ruby
api.on_update(->(data) { process(data) }).await!
```

### Declarative Targets (For Validation)

```ruby
class WebhookReceiver < CapnWeb::Target
  exposes :on_event, :on_error

  validates :on_event do
    param :type, String
    param :payload, Hash
  end

  before_rpc :authenticate

  def on_event(type:, payload:)
    # Handle event
  end

  private

  def authenticate(call)
    raise CapnWeb::Unauthorized unless valid_token?(call.metadata[:token])
  end
end
```

---

## Complete Example

```ruby
require 'capnweb'

class ChatHandler
  include CapnWeb::Target

  def on_message(content:, from:)
    puts "[#{from}] #{content}"
  end
end

CapnWeb.connect('wss://chat.example.com') do |api|
  # Authenticate and get user in one pipeline
  user = api.authenticate(ENV['TOKEN'])
            .current_user
            .await!

  # Subscribe to messages
  api.subscribe(ChatHandler.new).await!

  # Send a message
  api.messages.send(
    channel: 'general',
    content: 'Hello from Ruby!'
  ).await!

  # Fetch recent messages in parallel
  messages, members = CapnWeb.gather(
    api.channels.get('general').messages(limit: 50),
    api.channels.get('general').members
  )

  messages.each { |m| puts m.content }
end
```

---

## Why This is Idiomatic Ruby

### 1. Blocks Define Scope

```ruby
CapnWeb.connect(url) do |api|
  # Connection lives here, auto-closes after
end
```

Just like `File.open`, `DB.transaction`, `Mutex#synchronize`.

### 2. Method Chaining Reads Like English

```ruby
api.users.get(123).profile.avatar_url.await!
```

Not `api.call(:users, :get, {id: 123}).then(:profile).then(:avatar_url)`.

### 3. Bang Methods Signal Danger

```ruby
.await!  # Might raise - you've been warned
.await   # Safe, returns Result
```

Follows `save` vs `save!`, `find` vs `find!` convention.

### 4. Duck Typing with Optional Safety

```ruby
# Just works
user = api.users.get(123).await!

# With type hints (Sorbet/RBS)
sig { params(id: Integer).returns(User) }
def fetch_user(id)
  api.users.get(id).await!
end
```

### 5. Sensible Defaults, Full Control Available

```ruby
# Simple
api.users.get(123).await!

# With options
api.users.get(123).await!(timeout: 5)

# Full control
result = api.users.get(123).await
```

---

## Core Architecture

```ruby
module CapnWeb
  # Entry points
  def self.connect(url, &block)    # WebSocket session
  def self.batch(url, &block)      # HTTP batch session
  def self.async(url = nil, &block) # Fiber-based async
  def self.gather(*promises)       # Parallel resolution
  def self.configure(&block)       # Global config

  # Core classes
  class Session       # Manages connection lifecycle
  class Stub          # Dynamic proxy via method_missing
  class Promise       # Chainable, supports .await/.await!
  class Result        # Success/Failure monad
  class Target        # Module for exposable objects
  class Transport     # Abstract; WebSocket/HTTP implementations

  # Errors
  class Error < StandardError
  class ConnectionError < Error
  class TimeoutError < Error
  class RpcError < Error
  class NotFoundError < RpcError
  class PermissionError < RpcError
end
```

### Stub Implementation (Simplified)

```ruby
class Stub < BasicObject
  def initialize(session, path = [])
    @session = session
    @path = path
  end

  def method_missing(name, *args, **kwargs, &block)
    if args.empty? && kwargs.empty? && block.nil?
      # Property access - extend path
      Stub.new(@session, @path + [name])
    else
      # Method call - return promise
      Promise.new(@session, @path + [name], args, kwargs)
    end
  end

  def respond_to_missing?(*)
    true
  end
end
```

### Promise Implementation (Simplified)

```ruby
class Promise
  def initialize(session, path, args, kwargs)
    @session = session
    @call = { path: path, args: args, kwargs: kwargs }
    @resolved = false
    @value = nil
  end

  def await!
    result = await
    case result
    when Success then result.value
    when Failure then raise result.error
    end
  end

  def await(timeout: nil)
    return @value if @resolved
    @value = @session.execute(@call, timeout: timeout)
    @resolved = true
    @value
  end

  def then(&block)
    Pipeline.new(self, block)
  end

  def rescue(&block)
    RescuedPromise.new(self, block)
  end

  def method_missing(name, *args, **kwargs)
    # Pipelining: property access on unresolved promise
    PipelinedPromise.new(self, name, args, kwargs)
  end
end
```

---

## File Structure

```
lib/
  capnweb.rb              # Main entry point
  capnweb/
    version.rb
    configuration.rb
    session.rb
    stub.rb
    promise.rb
    result.rb
    target.rb
    pipeline.rb
    errors.rb
    transport/
      base.rb
      websocket.rb
      http_batch.rb
    async/
      scheduler.rb
sig/
  capnweb.rbs             # Type definitions
```

---

## The Beauty Test

A Ruby developer sees this code and immediately understands it:

```ruby
CapnWeb.connect('wss://api.example.com') do |api|
  user = api.users.get(123).await!
  puts user.name
end
```

No documentation needed. No surprises. Just Ruby.
