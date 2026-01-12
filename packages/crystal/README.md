# capnweb

[![GitHub release](https://img.shields.io/github/release/capnweb/capnweb-crystal.svg)](https://github.com/capnweb/capnweb-crystal/releases)
[![Docs](https://img.shields.io/badge/docs-available-brightgreen.svg)](https://capnweb.github.io/capnweb-crystal/)

**Capability-based RPC for Crystal that feels like it was born from the language.**

```crystal
# One line. One round trip. Fully typed.
name = api.authenticate(token).profile.name.await
```

Crystal sits at a unique intersection: Ruby's elegance with static typing, fibers for concurrency, and compile-time guarantees. This library embraces all of it.

---

## Why Crystal Developers Will Love This

- **Type inference that flows** - Chain through promises and the compiler knows exactly what you get
- **`macro method_missing`** - Pipelining is invisible; just chain methods
- **Fibers and channels first-class** - `spawn`, `Channel`, and `select` work exactly as expected
- **CSP integration** - Every promise is a channel; use `select` for racing
- **Compile-time catches everything** - Wrong method? Wrong type? Compiler error.
- **Ruby syntax** - Blocks, procs, `do/end`, snake_case - it all feels familiar

```crystal
require "capnweb"

CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api)

  # Pipelining through promises - single round trip
  profile = api.authenticate(token).profile.await

  # Parallel calls with fibers
  spawn { puts api.users.get(1).await.name }
  spawn { puts api.users.get(2).await.name }

  # CSP-style select
  select
  when user = api.users.get(3).receive
    puts user.name
  when timeout(5.seconds)
    puts "Timed out"
  end
end
```

If it compiles, it works.

---

## Installation

Add to your `shard.yml`:

```yaml
dependencies:
  capnweb:
    github: capnweb/capnweb-crystal
    version: ~> 1.0
```

Then run:

```bash
shards install
```

---

## Quick Start

### 1. Define Your API Contract

Interfaces define the shape of remote services. The `CapnWeb.interface` macro generates typed stubs automatically.

```crystal
require "capnweb"

# Interfaces define the shape of remote services
CapnWeb.interface Api do
  def users : UserService
  def authenticate(token : String) : AuthedApi
end

CapnWeb.interface UserService do
  def get(id : Int64) : User
  def list(limit : Int32 = 100) : Array(User)
  def create(name : String, email : String) : User
end

CapnWeb.interface AuthedApi do
  def profile : Profile
  def friend_ids : Array(Int64)
end

CapnWeb.interface Profile do
  def name : String
  def bio : String
  def update(bio : String) : Nil
end

# Value types are plain Crystal structs
struct User
  include JSON::Serializable
  property id : Int64
  property name : String
  property email : String
end
```

### 2. Connect and Call

```crystal
session = CapnWeb.connect("wss://api.example.com")
api = session.stub(Api)

begin
  # Every call returns Promise(T) - await to get the value
  user = api.users.get(123).await
  puts user.name  # => "Alice"

  # Type inference flows through
  api.users.list.await.each do |user|
    puts "#{user.name} <#{user.email}>"
  end
ensure
  session.close
end
```

### 3. Use Block Syntax for Auto-Close (Recommended)

The block form ensures proper cleanup even if exceptions occur:

```crystal
CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api)
  user = api.users.get(123).await
  puts user.name
end  # Session closes automatically, even on exception
```

---

## Pipelining

The killer feature. Chain calls through unresolved promises - the entire chain executes in **one network round trip**.

### Without Pipelining (3 round trips)

```crystal
authed = api.authenticate(token).await   # Round trip 1
profile = authed.profile.await            # Round trip 2
name = profile.name.await                 # Round trip 3
```

### With Pipelining (1 round trip)

```crystal
name = api.authenticate(token)  # Promise(AuthedApi)
          .profile              # Promise(Profile) - pipelined
          .name                 # Promise(String) - pipelined
          .await                # Single round trip for all three
```

### How It Works: `macro method_missing`

`Promise(T)` uses Crystal's `macro method_missing` to forward method calls based on `T`'s interface. When you call a method on `Promise(Profile)`, the macro checks if `Profile` has that method and creates a new pipelined promise:

```crystal
# This is what happens under the hood:
class Promise(T)
  macro method_missing(call)
    {% if T.has_method?(call.name) %}
      # Return type comes from T's method signature
      {% return_type = T.methods.find(&.name.==(call.name)).return_type %}
      pipeline_call(
        {{call.name.stringify}},
        {{call.args.splat}}
      ) # => Promise({{return_type}})
    {% else %}
      {% raise "No method '#{call.name}' on #{T}" %}
    {% end %}
  end
end
```

This gives you:
- **Compile-time safety** - Call a non-existent method and the compiler rejects it
- **Full type inference** - The return type propagates automatically
- **Zero runtime overhead** - Method dispatch is resolved at compile time

### Parallel Pipelines

Branch from a single promise to fetch multiple values in one round trip:

```crystal
auth = api.authenticate(token)  # Not awaited yet

# Both branch from auth - still ONE round trip
name_promise = auth.profile.name
friends_promise = auth.friend_ids

# Await together
name, friends = CapnWeb.await(name_promise, friends_promise)
```

### Pipeline Blocks for Complex Branching

When you need to build multiple branches from a shared prefix, use `pipeline`:

```crystal
result = api.authenticate(token).pipeline do |auth|
  # All branches are built from the same pipelined promise
  {
    name:    auth.profile.name,
    bio:     auth.profile.bio,
    friends: auth.friend_ids,
  }
end

puts result[:name]     # String
puts result[:friends]  # Array(Int64)
```

This is equivalent to the parallel pipelines example but with cleaner syntax when you have many branches.

---

## Fibers and Channels (CSP)

Crystal's CSP concurrency model integrates naturally with Cap'n Web.

### Concurrent Calls with Fibers

```crystal
# Fire off parallel requests
spawn do
  user = api.users.get(1).await
  puts "User 1: #{user.name}"
end

spawn do
  user = api.users.get(2).await
  puts "User 2: #{user.name}"
end

Fiber.yield  # Let spawned fibers run
```

### Channel Interface

Every promise exposes a channel for CSP-style composition:

```crystal
# Get the underlying channel
ch = api.users.get(123).channel
user = ch.receive

# Or use receive directly
user = api.users.get(123).receive
```

### Select for First-Ready

Race multiple operations and handle whichever completes first:

```crystal
user1 = api.users.get(1)
user2 = api.users.get(2)

select
when u = user1.receive
  puts "Got user 1 first: #{u.name}"
when u = user2.receive
  puts "Got user 2 first: #{u.name}"
when timeout(5.seconds)
  puts "Timed out waiting"
end
```

### Fan-Out Pattern

Fetch many resources concurrently:

```crystal
ids = [1_i64, 2_i64, 3_i64, 4_i64, 5_i64]
results = Channel(User).new(capacity: ids.size)

ids.each do |id|
  spawn do
    user = api.users.get(id).await
    results.send(user)
  end
end

users = Array(User).new(ids.size) { results.receive }
puts "Fetched #{users.size} users"
```

### Combining Pipelines with Select

Pipelining and CSP work together beautifully:

```crystal
auth = api.authenticate(token)
profile_name = auth.profile.name
friend_count = auth.friend_ids

select
when name = profile_name.receive
  puts "Name resolved first: #{name}"
when ids = friend_count.receive
  puts "Friends resolved first: #{ids.size} friends"
when timeout(10.seconds)
  raise CapnWeb::TimeoutError.new("Timed out")
end
```

---

## Streaming and Iteration

For large result sets or real-time data, Cap'n Web supports streaming through Crystal's `Iterator` interface.

### Iterator-Based Streaming

```crystal
CapnWeb.interface DataService do
  def events : Iterator(Event)
  def large_dataset : Iterator(Record)
end

# Lazy iteration - data streams as you consume
api.data.events.await.each do |event|
  puts "Event: #{event.type}"
  break if event.type == "end"
end

# Take only what you need
first_100 = api.data.large_dataset.await.first(100).to_a
```

### Streaming with Channels

For real-time event streams, combine iterators with channels:

```crystal
class StreamProcessor
  include CapnWeb::Target

  getter events = Channel(Event).new(capacity: 100)

  @[CapnWeb::Export]
  def on_event(event : Event) : Nil
    events.send(event)
  end
end

processor = StreamProcessor.new
api.subscribe(processor).await

# Process events as they arrive
spawn do
  loop do
    select
    when event = processor.events.receive
      handle(event)
    when timeout(30.seconds)
      puts "No events in 30s"
    end
  end
end
```

### Remapping (Server-Side Transforms)

Use `remap` to transform data on the server before it crosses the network - reducing bandwidth and latency:

```crystal
# Transform on server: only send what you need
names = api.users.list.remap { |user| user.name }.await
# => Array(String) - only names transferred, not full User objects

# Chain with pipelining
friend_names = api.authenticate(token)
                  .friends
                  .remap { |friend| friend.profile.display_name }
                  .await
```

The `remap` operation is particularly powerful for:
- Extracting specific fields from large objects
- Filtering sensitive data before transmission
- Aggregating or transforming collections server-side

---

## Error Handling

Crystal supports both exception-based and result-based error handling. Cap'n Web provides both.

### Exceptions (Ruby Style)

```crystal
begin
  user = api.users.get(123).await
  puts user.name
rescue ex : CapnWeb::NotFoundError
  puts "User not found"
rescue ex : CapnWeb::PermissionError
  puts "Access denied: #{ex.message}"
rescue ex : CapnWeb::ConnectionError
  puts "Lost connection"
rescue ex : CapnWeb::TimeoutError
  puts "Request timed out"
rescue ex : CapnWeb::RpcError
  puts "RPC failed [#{ex.code}]: #{ex.message}"
end
```

### Result Type (Explicit)

For code that prefers explicit error handling:

```crystal
result = api.users.get(123).try_await

case result
when CapnWeb::Ok
  puts result.value.name
when CapnWeb::Err
  puts "Error: #{result.error.message}"
end
```

### Timeouts

```crystal
# Per-call timeout
user = api.users.get(123).await(timeout: 5.seconds)

# Session-level default
session = CapnWeb::Session.new(
  transport: CapnWeb::WebSocket.new(url),
  timeout: 30.seconds
)
```

### Chainable Error Recovery

```crystal
# Provide a fallback on error
user = api.users.get(123)
         .rescue(CapnWeb::NotFoundError) { |_| User.guest }
         .await

# Works through pipelines
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

  class ConnectionError < Error; end
  class DisconnectedError < ConnectionError; end
  class TimeoutError < Error; end

  class RpcError < Error
    getter code : String
    getter details : JSON::Any?
  end

  class NotFoundError < RpcError; end
  class PermissionError < RpcError; end
  class ValidationError < RpcError; end
end
```

---

## Resource Management

Proper cleanup is essential for production applications. Crystal's `ensure` and block syntax make this straightforward.

### Session Cleanup with `ensure`

Always close sessions, even when exceptions occur:

```crystal
session = CapnWeb.connect("wss://api.example.com")
api = session.stub(Api)

begin
  user = api.users.get(123).await
  process(user)
rescue ex : CapnWeb::Error
  Log.error { "RPC failed: #{ex.message}" }
  raise
ensure
  session.close  # Always executed
end
```

### Block Syntax (Preferred)

The block form handles cleanup automatically:

```crystal
CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api)
  # Work with api...
end  # Guaranteed cleanup
```

### Fiber Cleanup

When spawning fibers, ensure they can be properly terminated:

```crystal
class StreamListener
  @running = true
  @fiber : Fiber?

  def start(api : Api)
    @fiber = spawn do
      while @running
        select
        when event = api.events.subscribe.receive
          handle(event)
        when timeout(1.second)
          # Check if we should stop
        end
      end
    end
  end

  def stop
    @running = false
    @fiber.try(&.resume) if Fiber.current != @fiber
  end
end

# Usage with ensure
listener = StreamListener.new
begin
  listener.start(api)
  # Main application logic...
ensure
  listener.stop
end
```

### Channel Cleanup

Close channels when done to signal completion:

```crystal
results = Channel(User).new(capacity: 10)

spawn do
  ids.each do |id|
    results.send(api.users.get(id).await)
  end
  results.close  # Signal no more data
end

# Consume until closed
while user = results.receive?
  process(user)
end
```

### Connection Lifecycle Hooks

Handle disconnections gracefully:

```crystal
session = CapnWeb::Session.new(
  transport: CapnWeb::WebSocket.new("wss://api.example.com"),
  on_disconnect: ->(err : CapnWeb::Error) {
    Log.error { "Disconnected: #{err.message}" }
    # Trigger reconnection logic
  },
  on_reconnect: -> {
    Log.info { "Reconnected" }
    # Re-establish subscriptions
  }
)
```

---

## Implementing RPC Targets

Cap'n Web is bidirectional. You can expose local objects for the server to call.

### Define a Target Interface

```crystal
CapnWeb.target NotificationHandler do
  def on_message(content : String, sender_id : Int64) : Nil
  def on_typing(user_id : Int64) : Nil
  def on_disconnect(reason : String) : Nil
end
```

### Implement the Target

```crystal
class MyNotificationHandler
  include NotificationHandler

  def on_message(content : String, sender_id : Int64) : Nil
    puts "[#{sender_id}] #{content}"
  end

  def on_typing(user_id : Int64) : Nil
    puts "User #{user_id} is typing..."
  end

  def on_disconnect(reason : String) : Nil
    puts "Disconnected: #{reason}"
  end
end
```

### Register with the Server

```crystal
handler = MyNotificationHandler.new
api.notifications.subscribe(handler).await

# The server can now call methods on your handler
```

### Inline Targets with Procs

For simple callbacks:

```crystal
api.on_event(
  on_message: ->(content : String, sender : Int64) {
    puts "#{sender}: #{content}"
  },
  on_disconnect: ->(reason : String) {
    puts "Bye: #{reason}"
  }
).await
```

### Channel-Based Targets

For CSP-style processing of incoming calls:

```crystal
class StreamProcessor
  include CapnWeb::Target

  getter data = Channel(JSON::Any).new(capacity: 100)

  @[CapnWeb::Export]
  def on_chunk(chunk : JSON::Any) : Nil
    data.send(chunk)
  end
end

processor = StreamProcessor.new
api.stream(processor).await

# Process in a fiber with proper cleanup
spawn do
  while chunk = processor.data.receive?
    process(chunk)
  end
end
```

---

## Type Annotations

Crystal's type inference flows throughout. Explicit annotations are optional but supported.

```crystal
# Inferred types
user = api.users.get(123).await       # user : User
name = user.name                       # name : String
ids = api.auth(token).friend_ids.await # ids : Array(Int64)

# Explicit when needed
promise : Promise(User) = api.users.get(123)
users : Array(User) = api.users.list.await

# Union types for nullable returns
profile : Profile? = api.public_profile("alice").await
if profile
  puts profile.name
end

# The interface macro enforces return types at compile time
CapnWeb.interface UserService do
  def get(id : Int64) : User              # Must return User
  def find(email : String) : User?        # May return nil
  def list : Array(User)                  # Returns array
  def delete(id : Int64) : Nil            # Returns nothing
end
```

---

## Multi-Await

Await multiple promises efficiently:

```crystal
# Await heterogeneous promises (returns tuple)
user, posts, settings = CapnWeb.await(
  api.users.get(123),
  api.posts.for_user(123),
  api.settings.get
)

# Await array of same type
promises = ids.map { |id| api.users.get(id) }
users = CapnWeb.await_all(promises)  # => Array(User)

# Await first to complete
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
  transport: CapnWeb::WebSocket.new("wss://api.example.com"),
  timeout: 30.seconds,
  connect_timeout: 10.seconds,

  # Automatic reconnection
  reconnect: CapnWeb::Reconnect.exponential(
    initial: 1.second,
    max: 30.seconds,
    max_attempts: 10
  ),

  # Lifecycle hooks
  on_connect: -> { Log.info { "Connected" } },
  on_disconnect: ->(err : CapnWeb::Error) { Log.error { err.message } },
  on_reconnect: -> { Log.info { "Reconnected" } }
)
```

### Transport Options

```crystal
# WebSocket with headers
ws = CapnWeb::WebSocket.new(
  url: "wss://api.example.com",
  headers: HTTP::Headers{
    "Authorization" => "Bearer #{token}",
  }
)

# HTTP batch transport (for serverless/stateless)
http = CapnWeb::HttpBatch.new(
  url: "https://api.example.com/rpc",
  headers: HTTP::Headers{"Authorization" => "Bearer #{token}"},
  batch_delay: 10.milliseconds
)
```

---

## Security Considerations

### Token Handling

Never hardcode tokens. Use environment variables or secure vaults:

```crystal
token = ENV["API_TOKEN"]? || raise "API_TOKEN required"

CapnWeb.connect("wss://api.example.com") do |session|
  api = session.stub(Api).authenticate(token).await
  # ...
end
```

### Capability Principle of Least Authority

Only pass the capabilities each component needs:

```crystal
# Good: Pass only what's needed
def process_user(user_service : UserService)
  user_service.get(123).await
end

# Avoid: Passing full API when only UserService is needed
def process_user(api : Api)
  api.users.get(123).await
end
```

### Validate Callbacks

When implementing targets, validate incoming data:

```crystal
class SecureHandler
  include NotificationHandler

  def on_message(content : String, sender_id : Int64) : Nil
    # Validate before processing
    raise CapnWeb::ValidationError.new("Content too long") if content.size > 10_000
    raise CapnWeb::ValidationError.new("Invalid sender") if sender_id < 0

    process_message(content, sender_id)
  end
end
```

---

## Platform Integration

### CLI Applications

```crystal
require "capnweb"
require "option_parser"

url = "wss://api.example.com"
token = ""

OptionParser.parse do |parser|
  parser.on("-t TOKEN", "--token=TOKEN", "API token") { |t| token = t }
  parser.on("-u URL", "--url=URL", "API URL") { |u| url = u }
end

token = ENV["API_TOKEN"] if token.empty?
raise "Token required" if token.empty?

CapnWeb.connect(url) do |session|
  api = session.stub(Api).authenticate(token).await
  puts api.profile.name.await
end
```

### Kemal Web Framework

```crystal
require "kemal"
require "capnweb"

# Shared connection pool
API_POOL = CapnWeb::Pool.new(
  url: "wss://api.example.com",
  size: 10
)

get "/users/:id" do |env|
  id = env.params.url["id"].to_i64

  API_POOL.with do |session|
    api = session.stub(Api)
    user = api.users.get(id).await
    user.to_json
  end
rescue CapnWeb::NotFoundError
  env.response.status_code = 404
  {error: "User not found"}.to_json
end

at_exit { API_POOL.close }

Kemal.run
```

### Lucky Framework

```crystal
# src/actions/users/show.cr
class Users::Show < BrowserAction
  get "/users/:id" do
    CapnWeb.connect(ENV["API_URL"]) do |session|
      api = session.stub(Api)
      user = api.users.get(id.to_i64).await
      json UserSerializer.new(user)
    end
  rescue CapnWeb::NotFoundError
    head :not_found
  end
end
```

---

## Complete Example

A chat application demonstrating all major features:

```crystal
require "capnweb"

# ─── Interface Definitions ─────────────────────────────────────────────

CapnWeb.interface ChatApi do
  def authenticate(token : String) : AuthedChat
end

CapnWeb.interface AuthedChat do
  def profile : UserProfile
  def rooms : RoomService
  def subscribe(handler : ChatHandler) : Nil
end

CapnWeb.interface UserProfile do
  def name : String
  def avatar_url : String?
  def update(name : String? = nil) : Nil
end

CapnWeb.interface RoomService do
  def list : Array(Room)
  def join(room_id : Int64) : Room
  def create(name : String) : Room
end

CapnWeb.interface Room do
  def name : String
  def send_message(content : String) : Nil
  def history(limit : Int32 = 50) : Array(Message)
end

CapnWeb.target ChatHandler do
  def on_message(room_id : Int64, sender : String, content : String) : Nil
  def on_user_joined(room_id : Int64, username : String) : Nil
  def on_user_left(room_id : Int64, username : String) : Nil
end

# ─── Data Types ────────────────────────────────────────────────────────

struct Room
  include JSON::Serializable
  property id : Int64
  property name : String
end

struct Message
  include JSON::Serializable
  property id : Int64
  property sender : String
  property content : String
  property sent_at : Time
end

# ─── Handler Implementation ────────────────────────────────────────────

class MyChatHandler
  include ChatHandler

  def on_message(room_id : Int64, sender : String, content : String) : Nil
    puts "[Room #{room_id}] #{sender}: #{content}"
  end

  def on_user_joined(room_id : Int64, username : String) : Nil
    puts "[Room #{room_id}] #{username} joined"
  end

  def on_user_left(room_id : Int64, username : String) : Nil
    puts "[Room #{room_id}] #{username} left"
  end
end

# ─── Application ───────────────────────────────────────────────────────

class ChatApp
  @chat : AuthedChat
  @session : CapnWeb::Session
  @handler : MyChatHandler

  def initialize(token : String)
    @session = CapnWeb.connect("wss://chat.example.com")
    api = @session.stub(ChatApi)

    # Authenticate and get profile in one round trip via pipelining
    @chat = api.authenticate(token).await
    puts "Logged in as #{@chat.profile.name.await}"

    @handler = MyChatHandler.new
    @chat.subscribe(@handler).await
  end

  def join_room(room_id : Int64)
    room = @chat.rooms.join(room_id).await
    puts "Joined room: #{room.name}"

    # Fetch history
    room.history(limit: 10).await.each do |msg|
      puts "  [#{msg.sent_at}] #{msg.sender}: #{msg.content}"
    end
  end

  def send(room_id : Int64, content : String)
    @chat.rooms.join(room_id).send_message(content).await
  end

  def close
    @session.close
  end
end

# ─── Main ──────────────────────────────────────────────────────────────

token = ENV["CHAT_TOKEN"]? || raise "CHAT_TOKEN required"
app = ChatApp.new(token)

begin
  app.join_room(1_i64)
  app.send(1_i64, "Hello from Crystal!")

  # Keep running to receive messages
  sleep
rescue ex : CapnWeb::Error
  STDERR.puts "Error: #{ex.message}"
  exit 1
ensure
  app.close
end
```

---

## How the Macros Work

The `CapnWeb.interface` macro generates a stub class with full type information:

```crystal
CapnWeb.interface UserService do
  def get(id : Int64) : User
  def list : Array(User)
end

# Generates something like:
class UserServiceStub < CapnWeb::Stub
  def get(id : Int64) : Promise(User)
    pipeline_call("get", id)
  end

  def list : Promise(Array(User))
    pipeline_call("list")
  end
end

module UserService
  abstract def get(id : Int64) : User
  abstract def list : Array(User)
end
```

`Promise(T)` uses Crystal's `macro method_missing` to forward calls based on `T`'s interface, enabling type-safe pipelining.

---

## Protocol Details

Cap'n Web uses JSON with special encodings for non-JSON types:

| Type | Encoding |
|------|----------|
| `undefined` | `["undefined"]` |
| `Bytes` | `["bytes", "base64..."]` |
| `BigInt` | `["bigint", "123456789"]` |
| `Time` | `["date", 1749342170815]` |
| `Error` | `["error", "TypeError", "message"]` |
| Array literal | `[["a", "b", "c"]]` |
| Stub reference | `["import", id, path, args]` |
| Promise pipeline | `["pipeline", id, path, args]` |
| Remap operation | `["remap", id, path, captures, instructions]` |

The protocol is fully bidirectional - both sides can call methods on objects exported by the other.

---

## API Quick Reference

```crystal
# Connect
session = CapnWeb.connect(url)
CapnWeb.connect(url) { |session| ... }

# Get typed stub
api = session.stub(MyApi)

# Make calls (returns Promise(T))
promise = api.method(args)

# Await
value = promise.await
value = promise.await(timeout: 5.seconds)

# Pipeline (chain through promises)
value = api.a.b.c.await  # One round trip

# Pipeline block
result = api.a.pipeline { |a| {x: a.b, y: a.c} }

# Remap (server-side transform)
names = api.users.list.remap { |u| u.name }.await

# Multi-await
a, b, c = CapnWeb.await(p1, p2, p3)
arr = CapnWeb.await_all(promises)

# Channels
ch = promise.channel
value = promise.receive

# Select
select
when v = promise.receive
  ...
when timeout(5.seconds)
  ...
end

# Error handling
begin
  value = promise.await
rescue ex : CapnWeb::NotFoundError
  ...
end

# Or result-style
case promise.try_await
when CapnWeb::Ok   then result.value
when CapnWeb::Err  then result.error
end

# Targets
api.subscribe(my_handler).await

# Close (prefer block syntax)
session.close
```

---

## Why This Design

| Decision | Rationale |
|----------|-----------|
| `Promise(T)` with `method_missing` | Invisible pipelining through method chaining |
| Macro-generated stubs | Full compile-time type checking |
| Both exceptions and `Result` | Match developer preference and use case |
| Channel-backed promises | Native CSP integration with `select` |
| Block syntax for sessions | Guaranteed cleanup via Crystal idioms |
| `remap` for transforms | Server-side processing reduces bandwidth |
| `Iterator` for streams | Lazy evaluation matches Crystal conventions |

---

This is Cap'n Web for Crystal: Ruby's elegance, static guarantees, CSP concurrency, and the performance of native code.
