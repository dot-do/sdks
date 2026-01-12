# rpc-do

[![GitHub release](https://img.shields.io/github/release/dot-do/rpc-crystal.svg)](https://github.com/dot-do/rpc-crystal/releases)
[![Docs](https://img.shields.io/badge/docs-available-brightgreen.svg)](https://dot-do.github.io/rpc-crystal/)

**The magic proxy that makes any `.do` service feel like local Crystal code.**

```crystal
require "rpc-do"

api = RpcDo.connect("wss://mongo.do")

# Call any method - no schema required
users = api.$.users.find({active: true}).await
profile = api.$.users.find_one({id: 123}).profile.settings.await
```

One require. One connection. Zero boilerplate.

---

## What is rpc-do?

`rpc-do` is the managed RPC layer for the `.do` ecosystem in Crystal. It sits between raw [capnweb](https://github.com/dot-do/capnweb-crystal) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `api.$.anything.you.want` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Authenticate seamlessly** - Built-in token and header support
5. **Use Crystal idioms** - Fibers, Channels, `select`, macros - all first-class

```
Your Crystal Code
       |
       v
  +----------+     +------------+     +-------------+
  |  rpc-do  | --> |  capnweb   | --> | *.do Server |
  +----------+     +------------+     +-------------+
       |
       +--- Magic proxy (api.$.method)
       +--- Auto-routing (mongo.do, kafka.do, etc.)
       +--- Promise pipelining
       +--- Fiber-aware async
       +--- Channel-based CSP integration
```

---

## rpc-do vs capnweb

| Feature | capnweb | rpc-do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| Token/header auth | Manual | Built-in |
| Promise pipelining | Yes | Yes (enhanced) |
| Server-side `remap` | Yes | Yes (enhanced) |
| Channel/CSP integration | Yes | Yes (enhanced) |
| Connection pooling | No | Yes |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc-do** when you're calling `.do` services and want maximum flexibility with Crystal idioms.

---

## Installation

Add to your `shard.yml`:

```yaml
dependencies:
  rpc-do:
    github: dot-do/rpc-crystal
    version: ~> 0.1
```

Then run:

```bash
shards install
```

Requires Crystal 1.10.0 or later.

---

## Quick Start

### Basic Connection

```crystal
require "rpc-do"

# Connect to any .do service
client = RpcDo.connect("wss://api.example.do")

# Call methods via the $ proxy
result = client.$.hello("World").await
puts result  # => "Hello, World!"

# Close when done
client.close
```

### Block Syntax (Recommended)

The block form ensures proper cleanup even if exceptions occur:

```crystal
RpcDo.connect("wss://api.example.do") do |client|
  result = client.$.hello("World").await
  puts result
end  # Connection closes automatically
```

### With Authentication

```crystal
client = RpcDo.connect("wss://api.example.do",
  token: "your-api-key",
  headers: HTTP::Headers{
    "X-Custom-Header" => "value",
    "X-Request-ID" => UUID.random.to_s
  }
)

# Authenticated calls
user = client.$.users.me.await
```

### With Typed Interfaces

For compile-time type safety, define interfaces:

```crystal
require "rpc-do"

# Define your service contract
RpcDo.interface MyService do
  def square(x : Int32) : Int32
  def users : UserService
end

RpcDo.interface UserService do
  def get(id : Int64) : User
  def list : Array(User)
  def create(name : String, email : String) : User
end

struct User
  include JSON::Serializable
  property id : Int64
  property name : String
  property email : String
end

# Type-safe client
RpcDo.connect("wss://api.example.do") do |client|
  api = client.typed(MyService)

  # Full type inference
  num = api.square(5).await           # Int32
  user = api.users.get(123).await     # User
  users = api.users.list.await        # Array(User)
end
```

---

## The Magic Proxy

The `$` property returns a magic proxy that intercepts all property access and method calls, sending them as RPC requests.

### How It Works

```crystal
client = RpcDo.connect("wss://api.example.do")

# Every property access is recorded
client.$                    # proxy
client.$.users              # proxy with path ["users"]
client.$.users.get          # proxy with path ["users", "get"]
client.$.users.get(123)     # RPC call to "get" with args [123]
```

The proxy doesn't know what methods exist on the server. It records the path and sends it when you call a method.

### Nested Access

Access deeply nested APIs naturally:

```crystal
# All of these work
client.$.users.get(123).await
client.$.users.profiles.settings.theme.get.await
client.$.api.v2.admin.users.deactivate(user_id).await
```

### Dynamic Keys

Use bracket notation for dynamic property names:

```crystal
table_name = "users"
result = client.$[table_name].find({active: true}).await

# Equivalent to
result = client.$.users.find({active: true}).await
```

### Method Naming Conventions

Crystal uses snake_case by convention. The proxy automatically handles this:

```crystal
# These are equivalent:
client.$.find_by_email("test@example.com").await
client.$.findByEmail("test@example.com").await  # Converted to snake_case for you
```

---

## Pipelining

The killer feature: chain calls through promises without awaiting. The entire chain executes in **one network round trip**.

### The Problem

Traditional RPC requires waiting for each response:

```crystal
# BAD: Three round trips
session = client.$.authenticate(token).await      # Wait...
user_id = session.get_user_id.await               # Wait...
profile = client.$.get_user_profile(user_id).await  # Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```crystal
# GOOD: One round trip
session = client.$.authenticate(token)           # RpcPromise
user_id = session.get_user_id                    # RpcPromise (pipelined)
profile = client.$.get_user_profile(user_id)     # RpcPromise (pipelined)

# Only awaiting triggers the network request
result = profile.await
```

### How Pipelining Works

1. **Recording phase**: Method calls return `RpcPromise(T)` objects without sending anything
2. **Batching**: When you `await`, rpc-do collects all recorded operations
3. **Single request**: Everything is sent as one batched request
4. **Server resolution**: The server evaluates dependencies and returns results

```crystal
# Build the pipeline (no network yet)
auth = client.$.authenticate(token)
user = auth.get_user
profile = user.profile
settings = profile.settings

# Send and await (one round trip)
result = settings.await
```

### Parallel Pipelines

Fork a pipeline to fetch multiple things at once:

```crystal
# Start with authentication
session = client.$.authenticate(token)

# Branch into parallel requests (still one round trip!)
user_promise = session.get_user
permissions_promise = session.get_permissions
settings_promise = session.get_settings

# Await all together
user, permissions, settings = RpcDo.await(
  user_promise,
  permissions_promise,
  settings_promise
)
```

### Pipeline Blocks for Complex Branching

When you need to build multiple branches from a shared prefix:

```crystal
result = client.$.authenticate(token).pipeline do |auth|
  {
    name:    auth.profile.name,
    bio:     auth.profile.bio,
    friends: auth.friend_ids,
    theme:   auth.settings.theme
  }
end

puts result[:name]     # String
puts result[:friends]  # Array(Int64)
puts result[:theme]    # String
```

---

## Fibers and Channels (CSP)

Crystal's CSP concurrency model integrates naturally with rpc-do.

### Concurrent Calls with Fibers

```crystal
# Fire off parallel requests
spawn do
  user = client.$.users.get(1).await
  puts "User 1: #{user["name"]}"
end

spawn do
  user = client.$.users.get(2).await
  puts "User 2: #{user["name"]}"
end

Fiber.yield  # Let spawned fibers run
```

### Channel Interface

Every promise exposes a channel for CSP-style composition:

```crystal
# Get the underlying channel
ch = client.$.users.get(123).channel
user = ch.receive

# Or use receive directly on promise
user = client.$.users.get(123).receive
```

### Select for First-Ready

Race multiple operations and handle whichever completes first:

```crystal
user1 = client.$.users.get(1)
user2 = client.$.users.get(2)

select
when u = user1.receive
  puts "Got user 1 first: #{u["name"]}"
when u = user2.receive
  puts "Got user 2 first: #{u["name"]}"
when timeout(5.seconds)
  puts "Timed out waiting"
end
```

### Fan-Out Pattern

Fetch many resources concurrently:

```crystal
ids = [1_i64, 2_i64, 3_i64, 4_i64, 5_i64]
results = Channel(JSON::Any).new(capacity: ids.size)

ids.each do |id|
  spawn do
    user = client.$.users.get(id).await
    results.send(user)
  end
end

users = Array(JSON::Any).new(ids.size) { results.receive }
puts "Fetched #{users.size} users"
```

### Combining Pipelines with Select

Pipelining and CSP work together beautifully:

```crystal
auth = client.$.authenticate(token)
profile_name = auth.profile.name
friend_count = auth.friend_ids

select
when name = profile_name.receive
  puts "Name resolved first: #{name}"
when ids = friend_count.receive
  puts "Friends resolved first: #{ids.as_a.size} friends"
when timeout(10.seconds)
  raise RpcDo::TimeoutError.new("Timed out")
end
```

---

## Streaming and Iteration

For large result sets or real-time data, rpc-do supports streaming through Crystal's `Iterator` interface.

### Iterator-Based Streaming

```crystal
RpcDo.interface DataService do
  def events : Iterator(Event)
  def large_dataset : Iterator(Record)
end

api = client.typed(DataService)

# Lazy iteration - data streams as you consume
api.events.await.each do |event|
  puts "Event: #{event.type}"
  break if event.type == "end"
end

# Take only what you need
first_100 = api.large_dataset.await.first(100).to_a
```

### Streaming with Channels

For real-time event streams, combine iterators with channels:

```crystal
class StreamProcessor
  include RpcDo::Target

  getter events = Channel(JSON::Any).new(capacity: 100)

  @[RpcDo::Export]
  def on_event(event : JSON::Any) : Nil
    events.send(event)
  end
end

processor = StreamProcessor.new
client.$.subscribe(processor).await

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

---

## Server-Side Remapping

Transform collections on the server to avoid N+1 round trips and reduce bandwidth.

### The N+1 Problem

```crystal
# BAD: N+1 round trips
user_ids = client.$.list_user_ids.await.as_a.map(&.as_i64)
profiles = [] of JSON::Any
user_ids.each do |id|
  profiles << client.$.get_profile(id).await  # N round trips!
end
```

### The Solution: remap

```crystal
# GOOD: 1 round trip total
profiles = client.$.list_user_ids.remap { |id| client.$.get_profile(id) }.await

# Or with explicit syntax
profiles = client.$.users.list.remap { |user| user.profile.display_name }.await
# => Array(String) - only names transferred, not full User objects
```

### How remap Works

1. **Expression capture**: Your block is analyzed at compile time
2. **Server execution**: The transformation runs on the server for each element
3. **Single response**: Only the transformed results are sent back

```crystal
# Transform on server: only send what you need
names = client.$.users.list.remap { |user| user.name }.await
# => Array(String) - only names transferred

# Chain with pipelining
friend_names = client.$.authenticate(token)
                     .friends
                     .remap { |friend| friend.profile.display_name }
                     .await
```

### Remap for Filtering and Aggregation

```crystal
# Filter sensitive data before transmission
public_users = client.$.users.list.remap do |user|
  {name: user.name, avatar: user.avatar_url}
end.await

# Aggregate server-side
stats = client.$.events.list.remap { |e| e.category }.await
category_counts = stats.tally
```

---

## Capabilities

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object.

### Creating Capabilities

```crystal
# Server returns a capability reference
counter = client.$.make_counter(10).await

# counter is now a proxy to the remote Counter object
puts counter.capability_id  # e.g., 1

# Call methods on the capability
value = counter.value.await          # 10
new_value = counter.increment(5).await  # 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```crystal
# Create two counters
counter1 = client.$.make_counter(10).await
counter2 = client.$.make_counter(20).await

# Pass counter1 to a method
result = client.$.add_counters(counter1, counter2).await
puts result  # 30
```

### Capability Lifecycle

Capabilities are automatically serialized when passed over RPC:

```crystal
# When you pass a capability...
client.$.do_something(counter).await

# rpc-do converts it to: { "$ref": counter.capability_id }
# The server knows to look up that capability and use the object
```

### Typed Capabilities

For compile-time safety with capabilities:

```crystal
RpcDo.interface Counter do
  def value : Int64
  def increment(by : Int64) : Int64
  def decrement(by : Int64) : Int64
end

RpcDo.interface MyApi do
  def make_counter(initial : Int64) : Counter
end

api = client.typed(MyApi)
counter = api.make_counter(10).await  # Counter capability

# Full type checking on capability methods
val = counter.value.await        # Int64
new_val = counter.increment(5).await  # Int64
```

---

## Error Handling

Crystal supports both exception-based and result-based error handling. rpc-do provides both.

### Exceptions (Ruby Style)

```crystal
begin
  user = client.$.users.get(123).await
  puts user["name"]
rescue ex : RpcDo::NotFoundError
  puts "User not found"
rescue ex : RpcDo::PermissionError
  puts "Access denied: #{ex.message}"
rescue ex : RpcDo::ConnectionError
  puts "Lost connection"
rescue ex : RpcDo::TimeoutError
  puts "Request timed out"
rescue ex : RpcDo::RpcError
  puts "RPC failed [#{ex.code}]: #{ex.message}"
end
```

### Result Type (Explicit)

For code that prefers explicit error handling:

```crystal
result = client.$.users.get(123).try_await

case result
when RpcDo::Ok
  puts result.value["name"]
when RpcDo::Err
  puts "Error: #{result.error.message}"
end
```

### Timeouts

```crystal
# Per-call timeout
user = client.$.users.get(123).await(timeout: 5.seconds)

# Client-level default
client = RpcDo.connect("wss://api.example.do",
  timeout: 30.seconds,
  connect_timeout: 10.seconds
)
```

### Chainable Error Recovery

```crystal
# Provide a fallback on error
user = client.$.users.get(123)
             .rescue(RpcDo::NotFoundError) { |_| guest_user }
             .await

# Works through pipelines
name = client.$.authenticate(token)
             .profile
             .name
             .rescue { |_| "Anonymous" }
             .await
```

### Error Types

```crystal
module RpcDo
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
  class CapabilityError < RpcError
    getter capability_id : Int64?
  end
end
```

---

## Exposing Local Objects (Callbacks)

rpc-do is bidirectional. You can expose local objects for the server to call.

### Define a Target Interface

```crystal
RpcDo.target NotificationHandler do
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
client.$.notifications.subscribe(handler).await

# The server can now call methods on your handler
```

### Inline Targets with Procs

For simple callbacks:

```crystal
client.$.on_event(
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
class StreamTarget
  include RpcDo::Target

  getter data = Channel(JSON::Any).new(capacity: 100)

  @[RpcDo::Export]
  def on_chunk(chunk : JSON::Any) : Nil
    data.send(chunk)
  end
end

target = StreamTarget.new
client.$.stream(target).await

# Process in a fiber with proper cleanup
spawn do
  while chunk = target.data.receive?
    process(chunk)
  end
end
```

---

## Connection Pooling

For high-throughput applications, use connection pools:

```crystal
# Create a pool
pool = RpcDo::Pool.new(
  url: "wss://api.example.do",
  size: 10,
  timeout: 30.seconds
)

# Borrow connections
pool.with do |client|
  user = client.$.users.get(123).await
  process(user)
end  # Connection returns to pool

# Close all connections
pool.close
```

### Thread-Safe Access

The pool is fiber-safe and handles concurrent access:

```crystal
pool = RpcDo::Pool.new(url: "wss://api.example.do", size: 5)

100.times do |i|
  spawn do
    pool.with do |client|
      result = client.$.process(i).await
      puts "Result #{i}: #{result}"
    end
  end
end

Fiber.yield
pool.close
```

---

## Multi-Await

Await multiple promises efficiently.

```crystal
# Await heterogeneous promises (returns tuple)
user, posts, settings = RpcDo.await(
  client.$.users.get(123),
  client.$.posts.for_user(123),
  client.$.settings.get
)

# Await array of same type
promises = ids.map { |id| client.$.users.get(id) }
users = RpcDo.await_all(promises)  # => Array(JSON::Any)

# Await first to complete
result = RpcDo.await_first(
  client.$.cache.get(key),
  client.$.database.get(key)
)
```

---

## Configuration

### Client Options

```crystal
client = RpcDo::Client.new(
  # Transport (required)
  transport: RpcDo::WebSocket.new("wss://api.example.do"),

  # Authentication
  token: ENV["API_TOKEN"],
  headers: HTTP::Headers{
    "Authorization" => "Bearer #{ENV["API_TOKEN"]}",
    "X-Request-ID" => UUID.random.to_s
  },

  # Timeouts
  timeout: 30.seconds,
  connect_timeout: 10.seconds,

  # Reconnection
  reconnect: RpcDo::Reconnect.exponential(
    initial: 1.second,
    max: 30.seconds,
    max_attempts: 10
  ),

  # Hooks
  on_connect: -> { Log.info { "Connected" } },
  on_disconnect: ->(err : RpcDo::Error) { Log.error { err.message } },
  on_reconnect: -> { Log.info { "Reconnected" } },

  # Logging
  logger: Log.for("rpc-do")
)
```

### Transport Options

```crystal
# WebSocket transport
ws = RpcDo::WebSocket.new(
  url: "wss://api.example.do",
  headers: HTTP::Headers{
    "Authorization" => "Bearer #{token}",
  },
  tls: OpenSSL::SSL::Context::Client.new
)

# HTTP batch transport (for serverless/stateless)
http = RpcDo::HttpBatch.new(
  url: "https://api.example.do/rpc",
  headers: HTTP::Headers{"Authorization" => "Bearer #{token}"},
  batch_delay: 10.milliseconds,
  max_batch_size: 100
)
```

---

## Framework Integration

### Kemal Web Framework

```crystal
require "kemal"
require "rpc-do"

# Shared connection pool
API_POOL = RpcDo::Pool.new(
  url: "wss://api.example.do",
  size: 10
)

get "/users/:id" do |env|
  id = env.params.url["id"].to_i64

  API_POOL.with do |client|
    user = client.$.users.get(id).await
    user.to_json
  end
rescue RpcDo::NotFoundError
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
    RpcDo.connect(ENV["API_URL"]) do |client|
      user = client.$.users.get(id.to_i64).await
      json UserSerializer.new(user)
    end
  rescue RpcDo::NotFoundError
    head :not_found
  end
end
```

### Amber Framework

```crystal
class UserController < Amber::Controller::Base
  def show
    RpcDo.connect(Amber.settings.api_url) do |client|
      user = client.$.users.get(params[:id].to_i64).await
      respond_with { json user }
    end
  rescue RpcDo::NotFoundError
    respond_with(404) { json({error: "Not found"}) }
  end
end
```

### CLI Applications

```crystal
require "rpc-do"
require "option_parser"

url = "wss://api.example.do"
token = ""

OptionParser.parse do |parser|
  parser.on("-t TOKEN", "--token=TOKEN", "API token") { |t| token = t }
  parser.on("-u URL", "--url=URL", "API URL") { |u| url = u }
end

token = ENV["API_TOKEN"] if token.empty?
raise "Token required" if token.empty?

RpcDo.connect(url, token: token) do |client|
  puts client.$.profile.name.await
end
```

---

## Macro Metaprogramming

Crystal's powerful macro system is fully leveraged in rpc-do.

### How Interface Macros Work

The `RpcDo.interface` macro generates a stub class with full type information:

```crystal
RpcDo.interface UserService do
  def get(id : Int64) : User
  def list : Array(User)
end

# Generates something like:
class UserServiceStub < RpcDo::Stub
  def get(id : Int64) : RpcPromise(User)
    pipeline_call("get", id)
  end

  def list : RpcPromise(Array(User))
    pipeline_call("list")
  end
end

module UserService
  abstract def get(id : Int64) : User
  abstract def list : Array(User)
end
```

### Promise Method Forwarding

`RpcPromise(T)` uses Crystal's `macro method_missing` to forward calls based on `T`'s interface:

```crystal
class RpcPromise(T)
  macro method_missing(call)
    {% if T.has_method?(call.name) %}
      {% return_type = T.methods.find(&.name.==(call.name)).return_type %}
      pipeline_call(
        {{call.name.stringify}},
        {{call.args.splat}}
      ) # => RpcPromise({{return_type}})
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

### Custom Type Serialization

Use macros to define custom serialization:

```crystal
RpcDo.type_serializer Money do
  def to_rpc(value : Money) : JSON::Any
    JSON::Any.new({
      "amount" => JSON::Any.new(value.cents),
      "currency" => JSON::Any.new(value.currency)
    })
  end

  def from_rpc(json : JSON::Any) : Money
    Money.new(
      cents: json["amount"].as_i64,
      currency: json["currency"].as_s
    )
  end
end
```

---

## Resource Management

Proper cleanup is essential for production applications.

### Session Cleanup with `ensure`

Always close connections, even when exceptions occur:

```crystal
client = RpcDo.connect("wss://api.example.do")

begin
  user = client.$.users.get(123).await
  process(user)
rescue ex : RpcDo::Error
  Log.error { "RPC failed: #{ex.message}" }
  raise
ensure
  client.close  # Always executed
end
```

### Block Syntax (Preferred)

The block form handles cleanup automatically:

```crystal
RpcDo.connect("wss://api.example.do") do |client|
  # Work with client...
end  # Guaranteed cleanup
```

### Fiber Cleanup

When spawning fibers, ensure they can be properly terminated:

```crystal
class StreamListener
  @running = true
  @fiber : Fiber?

  def start(client : RpcDo::Client)
    @fiber = spawn do
      while @running
        select
        when event = client.$.events.subscribe.receive
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
  listener.start(client)
  # Main application logic...
ensure
  listener.stop
end
```

### Channel Cleanup

Close channels when done to signal completion:

```crystal
results = Channel(JSON::Any).new(capacity: 10)

spawn do
  ids.each do |id|
    results.send(client.$.users.get(id).await)
  end
  results.close  # Signal no more data
end

# Consume until closed
while user = results.receive?
  process(user)
end
```

---

## Complete Example

A chat application demonstrating all major features:

```crystal
require "rpc-do"

# ---- Interface Definitions ----

RpcDo.interface ChatApi do
  def authenticate(token : String) : AuthedChat
end

RpcDo.interface AuthedChat do
  def profile : UserProfile
  def rooms : RoomService
  def subscribe(handler : ChatHandler) : Nil
end

RpcDo.interface UserProfile do
  def name : String
  def avatar_url : String?
  def update(name : String? = nil) : Nil
end

RpcDo.interface RoomService do
  def list : Array(Room)
  def join(room_id : Int64) : RoomCapability
  def create(name : String) : RoomCapability
end

RpcDo.interface RoomCapability do
  def name : String
  def send_message(content : String) : Nil
  def history(limit : Int32 = 50) : Array(Message)
end

RpcDo.target ChatHandler do
  def on_message(room_id : Int64, sender : String, content : String) : Nil
  def on_user_joined(room_id : Int64, username : String) : Nil
  def on_user_left(room_id : Int64, username : String) : Nil
end

# ---- Data Types ----

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

# ---- Handler Implementation ----

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

# ---- Application ----

class ChatApp
  @client : RpcDo::Client
  @chat : AuthedChat
  @handler : MyChatHandler

  def initialize(token : String)
    @client = RpcDo.connect("wss://chat.example.do")
    api = @client.typed(ChatApi)

    # Authenticate and get profile in one round trip via pipelining
    @chat = api.authenticate(token).await
    puts "Logged in as #{@chat.profile.name.await}"

    @handler = MyChatHandler.new
    @chat.subscribe(@handler).await
  end

  def join_room(room_id : Int64)
    room = @chat.rooms.join(room_id).await
    puts "Joined room: #{room.name.await}"

    # Fetch history
    room.history(limit: 10).await.each do |msg|
      puts "  [#{msg.sent_at}] #{msg.sender}: #{msg.content}"
    end
  end

  def send_message(room_id : Int64, content : String)
    @chat.rooms.join(room_id).send_message(content).await
  end

  def close
    @client.close
  end
end

# ---- Main ----

token = ENV["CHAT_TOKEN"]? || raise "CHAT_TOKEN required"
app = ChatApp.new(token)

begin
  app.join_room(1_i64)
  app.send_message(1_i64, "Hello from Crystal!")

  # Keep running to receive messages
  sleep
rescue ex : RpcDo::Error
  STDERR.puts "Error: #{ex.message}"
  exit 1
ensure
  app.close
end
```

---

## Dynamic vs Typed Usage

rpc-do supports both dynamic (schema-free) and typed (compile-time checked) APIs.

### Dynamic Mode

Perfect for exploration, prototyping, or dynamic APIs:

```crystal
RpcDo.connect("wss://api.example.do") do |client|
  # Call any method - no type checking
  result = client.$.some.deeply.nested.method(arg1, arg2).await

  # Navigate JSON results
  name = result["user"]["profile"]["name"].as_s

  # Dynamic key access
  table = "users"
  data = client.$[table].find({active: true}).await
end
```

### Typed Mode

For production code with compile-time safety:

```crystal
RpcDo.interface MyApi do
  def users : UserService
  def authenticate(token : String) : AuthSession
end

RpcDo.connect("wss://api.example.do") do |client|
  api = client.typed(MyApi)

  # Compiler catches type errors
  user = api.users.get(123).await  # => User
  # api.users.get("invalid")       # Compile error: expected Int64

  # Full autocomplete in IDEs
  session = api.authenticate(token).await
end
```

### Mixed Mode

Use both in the same codebase:

```crystal
RpcDo.connect("wss://api.example.do") do |client|
  # Typed for stable APIs
  api = client.typed(MyApi)
  users = api.users.list.await

  # Dynamic for experimental features
  beta_result = client.$.experimental.new_feature.await
end
```

---

## Protocol Details

rpc-do uses JSON with special encodings for non-JSON types:

| Type | Encoding |
|------|----------|
| `Nil` (undefined) | `["undefined"]` |
| `Bytes` | `["bytes", "base64..."]` |
| `BigInt` | `["bigint", "123456789"]` |
| `Time` | `["date", 1749342170815]` |
| `Exception` | `["error", "TypeError", "message"]` |
| Array literal | `[["a", "b", "c"]]` |
| Stub reference | `["import", id, path, args]` |
| Promise pipeline | `["pipeline", id, path, args]` |
| Remap operation | `["remap", id, path, captures, instructions]` |

The protocol is fully bidirectional - both sides can call methods on objects exported by the other.

---

## API Quick Reference

```crystal
# Connect
client = RpcDo.connect(url)
RpcDo.connect(url) { |client| ... }

# Connection with options
client = RpcDo.connect(url,
  token: "...",
  headers: HTTP::Headers{"X-Custom" => "value"},
  timeout: 30.seconds
)

# Dynamic calls via $ proxy
result = client.$.method(args).await
result = client.$.path.to.method(args).await
result = client.$[dynamic_key].method.await

# Typed stubs
api = client.typed(MyInterface)
result = api.method(args).await

# Await
value = promise.await
value = promise.await(timeout: 5.seconds)

# Pipeline (chain through promises)
value = client.$.a.b.c.await  # One round trip

# Pipeline block
result = client.$.a.pipeline { |a| {x: a.b, y: a.c} }

# Remap (server-side transform)
names = client.$.users.list.remap { |u| u.name }.await

# Multi-await
a, b, c = RpcDo.await(p1, p2, p3)
arr = RpcDo.await_all(promises)
first = RpcDo.await_first(p1, p2)

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
rescue ex : RpcDo::NotFoundError
  ...
end

# Or result-style
case promise.try_await
when RpcDo::Ok   then result.value
when RpcDo::Err  then result.error
end

# Targets
client.$.subscribe(my_handler).await

# Connection pool
pool = RpcDo::Pool.new(url: url, size: 10)
pool.with { |client| ... }

# Close (prefer block syntax)
client.close
```

---

## Type Reference

### RpcPromise(T)

The core type for async operations with pipelining.

```crystal
class RpcPromise(T)
  # Await the result (blocks fiber)
  def await : T
  def await(timeout : Time::Span) : T

  # Result-based await
  def try_await : Result(T, RpcDo::Error)

  # Channel interface for CSP
  def channel : Channel(T)
  def receive : T

  # Pipelining: forwards method calls to create new promises
  # (macro-generated based on T's interface)

  # Transformations
  def map(&block : T -> U) : RpcPromise(U) forall U
  def flat_map(&block : T -> RpcPromise(U)) : RpcPromise(U) forall U

  # Server-side transform
  def remap(&block : T -> U) : RpcPromise(Array(U)) forall U

  # Error handling
  def rescue(&block : RpcDo::Error -> T) : RpcPromise(T)
  def rescue(error_type : E.class, &block : E -> T) : RpcPromise(T) forall E
end
```

### Client

Manages the connection and stub creation.

```crystal
class RpcDo::Client
  # Get magic proxy
  def $ : DynamicProxy

  # Create typed stubs
  def typed(interface : T.class) : T forall T

  # Get self reference (capability ID 0)
  def get_self : CapabilityRef

  # Export local targets
  def export(name : String, target : Target)

  # Lifecycle
  def close : Nil
  def closed? : Bool

  # Events
  def on_disconnect(&block : RpcDo::Error ->)
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

## Security Considerations

### Token Handling

Never hardcode tokens. Use environment variables or secure vaults:

```crystal
token = ENV["API_TOKEN"]? || raise "API_TOKEN required"

RpcDo.connect("wss://api.example.do", token: token) do |client|
  api = client.typed(Api).authenticate(token).await
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
    raise RpcDo::ValidationError.new("Content too long") if content.size > 10_000
    raise RpcDo::ValidationError.new("Invalid sender") if sender_id < 0

    process_message(content, sender_id)
  end
end
```

---

## Why This Design

| Decision | Rationale |
|----------|-----------|
| Magic `$` proxy | Schema-free exploration, rapid prototyping |
| `RpcPromise(T)` with `method_missing` | Invisible pipelining through method chaining |
| Macro-generated stubs | Full compile-time type checking when needed |
| Both exceptions and `Result` | Match developer preference and use case |
| Channel-backed promises | Native CSP integration with `select` |
| Block syntax for connections | Guaranteed cleanup via Crystal idioms |
| `remap` for transforms | Server-side processing reduces bandwidth |
| Connection pooling | Production-ready high-throughput support |

---

## Why Crystal Developers Will Love This

1. **Looks like Ruby, runs like C** - Familiar syntax with native performance
2. **Type safety without ceremony** - Use `$` for dynamic, add types when needed
3. **Pipelining is just method chaining** - No special syntax to learn
4. **Fibers and channels work naturally** - CSP without fighting the type system
5. **Compile-time catches mistakes** - Bad typed pipelines don't compile
6. **Nil is explicit** - `User?` means maybe nil, `User` means never nil
7. **Macros generate the boring parts** - Define interface once, get stubs free
8. **If it compiles, it works** - The Crystal philosophy applies to RPC too

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb-do](https://github.com/dot-do/capnweb-crystal) | The underlying RPC protocol for Crystal |
| [dotdo](https://github.com/dot-do/dotdo-crystal) | Core utilities for `.do` services |
| [mongo-do](https://github.com/dot-do/mongo-crystal) | MongoDB client built on rpc-do |
| [database-do](https://github.com/dot-do/database-crystal) | Generic database client |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.

```crystal
# Run tests
crystal spec

# Run linter
crystal tool ameba

# Build documentation
crystal docs
```
