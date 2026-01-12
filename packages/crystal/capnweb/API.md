# Cap'n Web Crystal Client API

> A beautifully typed RPC client that feels native to Crystal

```crystal
# The essence of capnweb: Ruby syntax, compile-time safety, zero-cost pipelining
name = api.authenticate(token).profile.name.await  # One round trip, fully typed
```

---

## Design Philosophy

This API embraces what makes Crystal beautiful:

1. **Type inference that flows** - Write expressive code, receive static guarantees
2. **If it compiles, it works** - Invalid pipelines are compile errors, not runtime surprises
3. **Fibers and channels are first-class** - CSP concurrency without ceremony
4. **Ruby elegance, C performance** - Zero-cost abstractions via macros
5. **Nil is a type, not a crash** - `String | Nil` is explicit and handled

---

## Quick Start

```crystal
require "capnweb"

# Define your API contract
CapnWeb.interface Api do
  def users : UserService
  def authenticate(token : String) : AuthedApi
end

CapnWeb.interface UserService do
  def get(id : Int64) : User
  def list(limit : Int32 = 100) : Array(User)
  def create(name : String, email : String) : User
end

struct User
  include JSON::Serializable
  property id : Int64
  property name : String
  property email : String
end

# Connect and call
CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api)
  user = api.users.get(123).await
  puts user.name
end
```

---

## Core API

### Connections

```crystal
# Simple connection with block (auto-closes)
CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api)
  # ...
end

# Manual connection management
session = CapnWeb.connect("wss://api.example.com")
api = session.stub(Api)
# ... use api ...
session.close

# With configuration
session = CapnWeb::Session.new(
  transport: CapnWeb::WebSocket.new("wss://api.example.com"),
  timeout: 30.seconds,
  on_disconnect: ->(err) { Log.error { "Lost connection: #{err}" } },
  reconnect: CapnWeb::Reconnect.exponential(max: 5)
)

# HTTP batch transport (for environments without WebSocket)
session = CapnWeb::Session.new(
  transport: CapnWeb::HttpBatch.new("https://api.example.com/rpc")
)
```

### Defining Interfaces

Interfaces define your API contract. The macro generates fully-typed stub classes.

```crystal
# Services return other services or values
CapnWeb.interface Api do
  def users : UserService
  def posts : PostService
  def authenticate(token : String) : AuthedApi
  def public_profile(username : String) : Profile?
end

# Methods with parameters and return types
CapnWeb.interface UserService do
  def get(id : Int64) : User
  def find_by_email(email : String) : User?
  def list(limit : Int32 = 100, offset : Int32 = 0) : Array(User)
  def create(name : String, email : String) : User
  def update(id : Int64, name : String? = nil, email : String? = nil) : User
  def delete(id : Int64) : Nil
end

# Authenticated APIs with capability-based access
CapnWeb.interface AuthedApi do
  def profile : Profile
  def friend_ids : Array(Int64)
  def settings : Settings
  def logout : Nil
end

CapnWeb.interface Profile do
  def name : String
  def bio : String
  def avatar_url : String?
  def update(bio : String? = nil, avatar_url : String? = nil) : Nil
end

# Value types are regular Crystal structs
struct User
  include JSON::Serializable
  property id : Int64
  property name : String
  property email : String
  property created_at : Time
end

struct Settings
  include JSON::Serializable
  property theme : String
  property notifications_enabled : Bool
  property timezone : String
end
```

### Making Calls

Every method call returns `Promise(T)`. Call `.await` to get the value.

```crystal
api = session.stub(Api)

# Simple call
user = api.users.get(123).await
puts user.name  # Fully typed: String

# With type inference throughout
users = api.users.list(limit: 10).await
users.each { |u| puts "#{u.name} <#{u.email}>" }

# Nullable returns
profile = api.public_profile("alice").await
if profile
  puts profile.name
else
  puts "User not found"
end

# Chained service access
api.users.get(123).await          # => User
api.authenticate(token).await     # => AuthedApi
```

---

## Pipelining

The killer feature: chain calls through promises without awaiting. The entire chain executes in **one round trip**.

```crystal
# WITHOUT pipelining: 3 round trips
authed = api.authenticate(token).await      # Round trip 1
profile = authed.profile.await               # Round trip 2
name = profile.name.await                    # Round trip 3

# WITH pipelining: 1 round trip!
name = api.authenticate(token)  # Promise(AuthedApi)
          .profile              # Promise(Profile) - pipelined
          .name                 # Promise(String) - pipelined
          .await                # String - single round trip
```

### How It Works

`Promise(T)` forwards method calls to create pipelined promises:

```crystal
auth_promise = api.authenticate(token)  # Promise(AuthedApi)

# Calling .profile on Promise(AuthedApi) creates Promise(Profile)
# The call is queued, not sent yet
profile_promise = auth_promise.profile

# Calling .name on Promise(Profile) creates Promise(String)
name_promise = profile_promise.name

# Only when you await does the pipeline execute
name = name_promise.await  # All three calls sent together
```

### Parallel Pipelines

Branch from a single promise to fetch multiple values in parallel:

```crystal
# One auth, two parallel fetches - still ONE round trip
auth = api.authenticate(token)

name_promise = auth.profile.name
friends_promise = auth.friend_ids

# Await both together
name, friends = CapnWeb.await(name_promise, friends_promise)
# name : String
# friends : Array(Int64)
```

### Pipeline Blocks

For complex pipelines, use a block:

```crystal
result = api.pipeline do |p|
  auth = p.authenticate(token)

  {
    name: p.on(auth).profile.name,
    friends: p.on(auth).friend_ids,
    theme: p.on(auth).settings.theme
  }
end
# result : NamedTuple(name: String, friends: Array(Int64), theme: String)
# All fetched in ONE round trip
```

---

## Concurrency with Fibers and Channels

Crystal's CSP model integrates naturally.

### Spawning Concurrent Calls

```crystal
# Fire off multiple calls concurrently
spawn do
  user = api.users.get(1).await
  puts "User 1: #{user.name}"
end

spawn do
  user = api.users.get(2).await
  puts "User 2: #{user.name}"
end

# Let fibers run
Fiber.yield
```

### Channel Interface

Every promise exposes a channel for CSP-style composition:

```crystal
# Get the underlying channel
ch = api.users.get(123).channel  # Channel(User)
user = ch.receive

# Or use receive directly on promise
user = api.users.get(123).receive
```

### Select for First-Ready

```crystal
user1 = api.users.get(1)
user2 = api.users.get(2)

select
when u = user1.receive
  puts "Got user 1 first: #{u.name}"
when u = user2.receive
  puts "Got user 2 first: #{u.name}"
when timeout(5.seconds)
  puts "Timed out"
end
```

### Fan-Out Pattern

```crystal
ids = [1, 2, 3, 4, 5]
results = Channel(User).new(capacity: ids.size)

ids.each do |id|
  spawn do
    user = api.users.get(id).await
    results.send(user)
  end
end

users = Array(User).new(ids.size) { results.receive }
```

### Select with Pipelines

Combine pipelining and select:

```crystal
auth = api.authenticate(token)
profile_name = auth.profile.name
friend_count = auth.friend_ids

# Race between pipeline results
select
when name = profile_name.receive
  puts "Name loaded: #{name}"
when ids = friend_count.receive
  puts "#{ids.size} friends loaded"
when timeout(10.seconds)
  raise CapnWeb::TimeoutError.new("Pipeline timed out")
end
```

---

## Error Handling

### Exception-Based (Ruby Style)

```crystal
begin
  user = api.users.get(123).await
  puts user.name
rescue ex : CapnWeb::NotFoundError
  puts "User not found"
rescue ex : CapnWeb::PermissionError
  puts "Access denied: #{ex.message}"
rescue ex : CapnWeb::ConnectionError
  puts "Connection lost"
rescue ex : CapnWeb::TimeoutError
  puts "Request timed out"
rescue ex : CapnWeb::RpcError
  puts "RPC failed [#{ex.code}]: #{ex.message}"
end
```

### Result-Based (Explicit)

```crystal
result = api.users.get(123).try_await

case result
when CapnWeb::Ok
  puts result.value.name
when CapnWeb::Err
  case result.error
  when CapnWeb::NotFoundError
    puts "Not found"
  else
    puts "Error: #{result.error.message}"
  end
end
```

### Timeouts

```crystal
# Per-call timeout
user = api.users.get(123).await(timeout: 5.seconds)

# Session-level default timeout
session = CapnWeb::Session.new(
  transport: transport,
  timeout: 30.seconds
)
```

### Chainable Error Handling

```crystal
user = api.users.get(123)
         .rescue(CapnWeb::NotFoundError) { |_| User.guest }
         .await

name = api.authenticate(token)
          .profile
          .name
          .rescue { |_| "Anonymous" }
          .await
```

### Error Types

```crystal
module CapnWeb
  abstract class Error < Exception; end

  # Connection errors
  class ConnectionError < Error; end
  class DisconnectedError < ConnectionError; end
  class TimeoutError < Error; end

  # RPC errors (from server)
  class RpcError < Error
    getter code : String
    getter details : JSON::Any?
  end

  class NotFoundError < RpcError; end
  class PermissionError < RpcError; end
  class ValidationError < RpcError; end
  class InternalError < RpcError; end
end
```

---

## Exposing Local Objects (Callbacks)

Cap'n Web is bidirectional. The server can call methods on objects you provide.

### Define Target Interfaces

```crystal
CapnWeb.target NotificationHandler do
  def on_message(content : String, sender_id : Int64) : Nil
  def on_typing(user_id : Int64) : Nil
  def on_disconnect(reason : String) : Nil
end
```

### Implement Targets

```crystal
class MyNotificationHandler
  include NotificationHandler

  def on_message(content : String, sender_id : Int64) : Nil
    puts "Message from #{sender_id}: #{content}"
  end

  def on_typing(user_id : Int64) : Nil
    puts "User #{user_id} is typing..."
  end

  def on_disconnect(reason : String) : Nil
    puts "Disconnected: #{reason}"
    cleanup
  end

  private def cleanup
    # ...
  end
end
```

### Pass to Server

```crystal
handler = MyNotificationHandler.new
api.subscribe(handler).await  # Server can now call handler methods
```

### Inline Targets with Blocks

For simple callbacks, use proc syntax:

```crystal
api.subscribe(
  on_message: ->(content : String, sender_id : Int64) {
    puts "#{sender_id}: #{content}"
  },
  on_typing: ->(user_id : Int64) {
    puts "Typing: #{user_id}"
  },
  on_disconnect: ->(reason : String) {
    puts "Bye: #{reason}"
  }
).await
```

### Channel-Based Targets

For CSP-style target handling:

```crystal
class StreamTarget
  include CapnWeb::Target

  getter data_channel = Channel(JSON::Any).new(capacity: 100)

  @[CapnWeb::Export]
  def on_data(chunk : JSON::Any) : Nil
    data_channel.send(chunk)
  end
end

target = StreamTarget.new
api.stream(target).await

# Process data in a fiber
spawn do
  loop do
    chunk = target.data_channel.receive
    process(chunk)
  end
end
```

---

## Dynamic Calls

When you need to call methods not in your interface (experimental APIs, etc.):

```crystal
# Get a dynamic stub
dynamic = session.dynamic_stub

# Call any method
result = dynamic.call("experimentalMethod", arg1, arg2).await(JSON::Any)

# Or with expected type
user = dynamic.call("getUser", 123).await(User)

# Navigate dynamically
name = dynamic
  .get("users")
  .call("find", 123)
  .get("profile")
  .get("name")
  .await(String)
```

---

## Type Reference

### Promise(T)

The core type for async operations with pipelining.

```crystal
class Promise(T)
  # Await the result (blocks fiber)
  def await : T
  def await(timeout : Time::Span) : T

  # Result-based await
  def try_await : Result(T, CapnWeb::Error)

  # Channel interface for CSP
  def channel : Channel(T)
  def receive : T

  # Pipelining: forwards method calls to create new promises
  # (macro-generated based on T's interface)

  # Transformations
  def map(&block : T -> U) : Promise(U) forall U
  def flat_map(&block : T -> Promise(U)) : Promise(U) forall U

  # Error handling
  def rescue(&block : CapnWeb::Error -> T) : Promise(T)
  def rescue(error_type : E.class, &block : E -> T) : Promise(T) forall E
end
```

### Session

Manages the connection and stub creation.

```crystal
class Session
  # Create stubs
  def stub(interface : T.class) : T forall T
  def dynamic_stub : DynamicStub

  # Export local targets
  def export(name : String, target : Target)

  # Lifecycle
  def close : Nil
  def closed? : Bool

  # Events
  def on_disconnect(&block : CapnWeb::Error ->)
  def on_reconnect(&block : ->)
end
```

### Result(T, E)

For explicit error handling.

```crystal
alias Result(T, E) = Ok(T) | Err(E)

struct Ok(T)
  getter value : T
  def success? : Bool = true
  def failure? : Bool = false
end

struct Err(E)
  getter error : E
  def success? : Bool = false
  def failure? : Bool = true
end
```

---

## Multi-Await

Await multiple promises efficiently.

```crystal
# Await all (returns tuple)
user, posts, settings = CapnWeb.await(
  api.users.get(123),
  api.posts.list(user_id: 123),
  api.settings.get
)

# Await array of same type
promises = ids.map { |id| api.users.get(id) }
users = CapnWeb.await_all(promises)  # => Array(User)

# Await first ready
result = CapnWeb.await_first(
  api.cache.get(key),
  api.database.get(key)
)
```

---

## Configuration

### Session Options

```crystal
session = CapnWeb::Session.new(
  # Transport (required)
  transport: CapnWeb::WebSocket.new(url),

  # Timeouts
  timeout: 30.seconds,           # Default call timeout
  connect_timeout: 10.seconds,   # Connection timeout

  # Reconnection
  reconnect: CapnWeb::Reconnect.exponential(
    initial: 1.second,
    max: 30.seconds,
    max_attempts: 10
  ),

  # Hooks
  on_connect: -> { Log.info { "Connected" } },
  on_disconnect: ->(err : CapnWeb::Error) { Log.error { err } },
  on_reconnect: -> { Log.info { "Reconnected" } },

  # Logging
  logger: Log.for("capnweb")
)
```

### Transport Options

```crystal
# WebSocket transport
ws = CapnWeb::WebSocket.new(
  url: "wss://api.example.com",
  headers: HTTP::Headers{
    "Authorization" => "Bearer #{token}",
    "X-Request-Id" => UUID.random.to_s
  },
  tls: OpenSSL::SSL::Context::Client.new
)

# HTTP batch transport
http = CapnWeb::HttpBatch.new(
  url: "https://api.example.com/rpc",
  headers: HTTP::Headers{"Authorization" => "Bearer #{token}"},
  batch_delay: 10.milliseconds,  # Batch calls within window
  max_batch_size: 100
)
```

---

## Complete Example

```crystal
require "capnweb"

# Define API contract
CapnWeb.interface Api do
  def authenticate(token : String) : AuthedApi
  def public_users : PublicUserService
end

CapnWeb.interface AuthedApi do
  def profile : Profile
  def friends : FriendService
  def notifications : NotificationService
end

CapnWeb.interface Profile do
  def name : String
  def bio : String
  def update(name : String? = nil, bio : String? = nil) : Nil
end

CapnWeb.interface FriendService do
  def list : Array(User)
  def add(user_id : Int64) : Nil
  def remove(user_id : Int64) : Nil
end

CapnWeb.interface NotificationService do
  def subscribe(handler : NotificationHandler) : Nil
  def unsubscribe : Nil
end

CapnWeb.target NotificationHandler do
  def on_notification(title : String, body : String) : Nil
end

struct User
  include JSON::Serializable
  property id : Int64
  property name : String
end

# Main application
class App
  @session : CapnWeb::Session
  @api : Api

  def initialize(token : String)
    @session = CapnWeb.connect("wss://api.example.com")

    # Pipeline: authenticate and get profile in one round trip
    root = @session.stub(Api)
    @api = root.authenticate(token).await

    setup_notifications
  end

  def profile_and_friends
    # Parallel pipeline: one round trip for both
    profile_name, friends = CapnWeb.await(
      @api.profile.name,
      @api.friends.list
    )

    puts "#{profile_name}'s friends:"
    friends.each { |f| puts "  - #{f.name}" }
  end

  private def setup_notifications
    handler = NotificationHandlerImpl.new
    @api.notifications.subscribe(handler).await
  end

  def close
    @session.close
  end
end

class NotificationHandlerImpl
  include NotificationHandler

  def on_notification(title : String, body : String) : Nil
    puts "[#{title}] #{body}"
  end
end

# Run
begin
  app = App.new(ENV["API_TOKEN"])
  app.profile_and_friends

  # Keep running for notifications
  sleep
rescue ex : CapnWeb::Error
  STDERR.puts "Error: #{ex.message}"
  exit 1
ensure
  app.try &.close
end
```

---

## Shard Installation

```yaml
# shard.yml
dependencies:
  capnweb:
    github: capnweb/capnweb-crystal
    version: ~> 1.0
```

```crystal
require "capnweb"
```

---

## Why Crystal Developers Will Love This

1. **Looks like Ruby, runs like C** - Familiar syntax with native performance
2. **Type safety without ceremony** - Inference handles the boilerplate
3. **Pipelining is just method chaining** - No special syntax to learn
4. **Fibers and channels work naturally** - CSP without fighting the type system
5. **Compile-time catches mistakes** - Bad pipelines don't compile
6. **Nil is explicit** - `User?` means maybe nil, `User` means never nil
7. **Macros generate the boring parts** - Define interface once, get stubs free

---

## API Summary

```crystal
# Connect
session = CapnWeb.connect(url)
session = CapnWeb.connect(url) { |s| ... }

# Get typed stub
api = session.stub(MyApi)

# Make calls (returns Promise)
promise = api.method(args)

# Await results
value = promise.await
value = promise.await(timeout: 5.seconds)

# Pipeline (chain through promises)
value = api.a.b.c.await  # One round trip

# Parallel await
a, b = CapnWeb.await(promise_a, promise_b)

# CSP integration
select
when v = promise.receive
  # ...
when timeout(5.seconds)
  # ...
end

# Error handling
begin
  value = promise.await
rescue ex : CapnWeb::NotFoundError
  # ...
end

# Or result-style
case promise.try_await
when CapnWeb::Ok then ...
when CapnWeb::Err then ...
end

# Expose callbacks
api.subscribe(my_handler).await
```

This is Cap'n Web for Crystal: beautiful, typed, and fast.
