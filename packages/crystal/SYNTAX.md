# Cap'n Web Crystal Client: Syntax Exploration

This document explores **four divergent approaches** to designing an idiomatic Crystal client for Cap'n Web RPC. Each approach represents a different philosophy about how Crystal developers should interact with the library, leveraging Crystal's unique combination of Ruby-like expressiveness and static type safety.

---

## Background: What Makes Crystal Unique

Crystal occupies a fascinating design space with features that inform our API design:

- **Ruby-like Syntax with Static Typing**: Familiar syntax, but the compiler catches type errors at compile time
- **Fibers and Channels (CSP)**: Lightweight concurrency with `spawn`, `Channel(T)`, and `select`
- **Compile-time Macros**: Powerful metaprogramming that generates code at compile time
- **Union Types**: `String | Nil` is a first-class type, enabling precise nil tracking
- **Type Inference**: Write Ruby-like code, get statically typed guarantees
- **C Bindings**: Direct FFI for high-performance native integration
- **No Runtime Reflection**: Like Rust, we cannot intercept arbitrary method calls at runtime

The challenge for Cap'n Web: The protocol allows calling *any* method on a remote stub, but Crystal's type system wants to know all methods at compile time. Unlike Ruby's `method_missing`, Crystal requires static dispatch.

---

## Prior Art: How Crystal Libraries Do It

### HTTP::Client (stdlib)
```crystal
response = HTTP::Client.get("https://api.example.com/users/1")
JSON.parse(response.body)
```
- Simple, synchronous API
- Explicit response handling

### Kemal (Web Framework)
```crystal
get "/users/:id" do |env|
  id = env.params.url["id"]
  User.find(id).to_json
end
```
- DSL-based routing
- Block-based handlers

### Lucky (Full-stack Framework)
```crystal
class Users::Show < BrowserAction
  get "/users/:user_id" do
    user = UserQuery.find(user_id)
    html ShowPage, user: user
  end
end
```
- Class-based with macros
- Strong type safety
- Code generation for type-safe params

### Grip (Microframework)
```crystal
class UserController < Grip::Controllers::Http
  def get(context : Context) : Context
    context.json({"user" => "data"})
  end
end
```
- OOP-style controllers
- Typed contexts

---

## Approach 1: "Macro-Generated Stubs" (The Lucky Way)

**Philosophy**: Define your API contract using macros. The compiler generates fully-typed stub classes. Maximum type safety with IDE autocompletion. This feels like Lucky or Avram -- compile-time code generation for type safety.

### Connection/Session Creation

```crystal
require "capnweb"

# Connect to server (returns a Session)
session = CapnWeb.connect("wss://api.example.com")

# Get typed stub for the root API
api = session.stub(Api)

# Or with configuration
session = CapnWeb::Session.new(
  transport: CapnWeb::WebSocket.new("wss://api.example.com"),
  timeout: 30.seconds,
  on_disconnect: ->(err : CapnWeb::Error) { Log.error { err.message } }
)

# Block-based session (auto-closes)
CapnWeb.connect("wss://api.example.com") do |api|
  user = api.users.get(123).await
  puts user.name
end
```

### Defining Remote Interfaces

```crystal
require "capnweb"

# Define the API contract using macros
CapnWeb.interface Api do
  def authenticate(token : String) : AuthedApi
  def users : UserService
  def public_user(id : Int64) : User
end

CapnWeb.interface AuthedApi do
  def profile : Profile
  def friend_ids : Array(Int64)
end

CapnWeb.interface UserService do
  def get(id : Int64) : User
  def list : Array(User)
  def create(name : String, email : String) : User
end

CapnWeb.interface Profile do
  def name : String
  def bio : String
  def update(bio : String) : Nil
end

# Value types are regular Crystal structs/classes
struct User
  include JSON::Serializable
  property id : Int64
  property name : String
  property email : String
end

# The macro generates:
# - ApiStub, AuthedApiStub, UserServiceStub, ProfileStub
# - Full type inference for method calls
# - RpcPromise(T) return types that support pipelining
```

### Making RPC Calls

```crystal
# Calls return RpcPromise(T) - must await to get value
user = api.users.get(123).await
puts user.name  # => "Alice"

# Type inference works throughout
users = api.users.list.await
users.each { |u| puts u.email }

# Chained navigation
profile = api.authenticate(token).await.profile.await
name = profile.name.await

# Fiber-based concurrency (spawn multiple calls)
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

### Pipelining Syntax

The key insight: `RpcPromise(T)` implements the same interface as `T` for pipelining.

```crystal
# WITHOUT pipelining (3 round trips)
authed = api.authenticate(token).await
profile = authed.profile.await
name = profile.name.await

# WITH pipelining (1 round trip!)
# Chain through promises without awaiting
name = api.authenticate(token)  # RpcPromise(AuthedApi)
          .profile              # RpcPromise(Profile) - pipelined!
          .name                 # RpcPromise(String) - pipelined!
          .await                # String - single round trip

# Multiple pipelined values
authed = api.authenticate(token)  # Not awaited yet

# Both of these pipeline through `authed`
name_promise = authed.profile.name
friends_promise = authed.friend_ids

# Await multiple promises (still just one round trip!)
name, friends = CapnWeb.await(name_promise, friends_promise)

# Or use select for first-ready semantics
select
when result = name_promise.receive
  puts "Name: #{result}"
when result = friends_promise.receive
  puts "Friends: #{result.size}"
end
```

### Error Handling

```crystal
# Crystal uses exceptions (with begin/rescue)
begin
  user = api.users.get(123).await
  puts user.name
rescue ex : CapnWeb::NotFoundError
  puts "User not found: #{ex.message}"
rescue ex : CapnWeb::ConnectionError
  puts "Connection lost: #{ex.message}"
rescue ex : CapnWeb::RpcError
  puts "RPC failed: #{ex.message}"
end

# Or use Result-style with try
result = api.users.get(123).try_await
case result
when .success?
  puts result.value.name
when .failure?
  puts result.error.message
end

# Timeout handling
begin
  user = api.users.get(123).await(timeout: 5.seconds)
rescue ex : CapnWeb::TimeoutError
  puts "Request timed out"
end

# Chain error handling
api.users.get(123)
   .map { |u| u.name.upcase }
   .rescue { |_| "Unknown" }
   .await
```

### Exposing Local Objects as RPC Targets

```crystal
# Use macro to define target interface
CapnWeb.target NotificationHandler do
  def on_message(content : String, sender_id : Int64) : Nil
  def on_disconnect(reason : String) : Nil
end

# Implement the target
class MyNotificationHandler
  include NotificationHandler

  def on_message(content : String, sender_id : Int64) : Nil
    puts "Message from #{sender_id}: #{content}"
  end

  def on_disconnect(reason : String) : Nil
    puts "Disconnected: #{reason}"
  end
end

# Pass to server
handler = MyNotificationHandler.new
api.subscribe(handler).await

# The handler will receive calls from the server

# Alternative: inline target using blocks
api.subscribe(
  on_message: ->(content : String, sender_id : Int64) {
    puts "#{sender_id}: #{content}"
  },
  on_disconnect: ->(reason : String) {
    puts "Bye: #{reason}"
  }
).await
```

### Pros & Cons

**Pros:**
- Maximum compile-time type safety
- Full IDE autocompletion and refactoring
- Pipelining is natural (chain through promises)
- Errors caught at compile time
- Zero runtime overhead for type checking

**Cons:**
- Must define interface macros upfront
- Cannot call undefined methods (no dynamic dispatch)
- More boilerplate for large APIs
- Macro errors can be cryptic

---

## Approach 2: "Dynamic JSON Builder" (The Flexible Way)

**Philosophy**: Trade type safety for flexibility. Stubs are dynamic JSON builders where any method call is valid. Type checking happens at runtime when deserializing. This feels more like raw HTTP clients or loosely-typed APIs.

### Connection/Session Creation

```crystal
require "capnweb"

# Simple connection
client = CapnWeb::Client.connect("wss://api.example.com")
api = client.stub

# Or with options
client = CapnWeb::Client.new(
  url: "wss://api.example.com",
  timeout: 30.seconds,
  headers: HTTP::Headers{"Authorization" => "Bearer #{token}"}
)

# HTTP batch mode
client = CapnWeb::Client.batch("https://api.example.com/rpc")
```

### Making RPC Calls

```crystal
# Get the dynamic stub
api = client.stub

# Call any method -- returns JSON::Any wrapped in RpcPromise
result = api.call("getUser", 123).await
puts result["name"].as_s  # Manual JSON navigation

# Or specify expected type with turbofish-style
user = api.call("getUser", 123).await(User)
puts user.name  # Type-safe after deserialization

# Fluent property access
name = api
  .get("users")       # Property access
  .call("find", 123)  # Method call
  .get("profile")     # Navigate into result
  .get("name")        # Get property
  .await(String)

# Dynamic method chaining
response = api.users.get(123).profile.name.await(String)
```

### Pipelining Syntax

Pipelining is natural: build the chain, then await.

```crystal
# This entire chain is ONE round trip
profile_name = api
  .call("authenticate", token)   # Step 1
  .call("getProfile")            # Step 2 (pipelined)
  .get("displayName")            # Step 3 (pipelined)
  .await(String)

# Fork pipelining: multiple leaves from one stem
auth = api.call("authenticate", token)  # Not sent yet

# Both of these pipeline through `auth`
user_id, friends = CapnWeb.await(
  auth.call("getUserId").as(Int64),
  auth.call("getFriendIds").as(Array(Int64))
)

# Batch multiple independent calls
users = CapnWeb.batch(
  api.users.get(1),
  api.users.get(2),
  api.users.get(3)
).await(Array(User))
```

### Error Handling

```crystal
# Errors are raised on await
begin
  result = api.call("getUser", 123).await
rescue ex : CapnWeb::RpcError
  case ex.code
  when "NOT_FOUND"
    puts "User not found"
  when "PERMISSION_DENIED"
    puts "Access denied"
  else
    raise ex
  end
end

# Type coercion errors
begin
  user = api.call("getUser", 123).await(User)
rescue ex : JSON::SerializableError
  puts "Response didn't match User schema: #{ex.message}"
end

# Error context
result = api.call("getUser", 123)
           .context("fetching user 123")
           .await
```

### Exposing Local Objects as RPC Targets

```crystal
# Function-based targets using Hash
target = CapnWeb::Target.build do |t|
  t.method("greet") do |name : String|
    "Hello, #{name}!"
  end

  t.method("add") do |a : Int32, b : Int32|
    a + b
  end
end

client.export("calculator", target)

# Or object-based with annotations
class Calculator
  include CapnWeb::Target

  @[CapnWeb::Export]
  def add(a : Int32, b : Int32) : Int32
    a + b
  end

  @[CapnWeb::Export]
  def multiply(a : Int32, b : Int32) : Int32
    a * b
  end

  # Methods without annotation are NOT exposed
  def internal_helper
    # ...
  end
end

client.export("calculator", Calculator.new)
```

### Pros & Cons

**Pros:**
- No interface definitions needed
- Can call any remote method
- Great for exploratory APIs or dynamic schemas
- Less boilerplate
- Easy to get started

**Cons:**
- Runtime type errors (not caught at compile time)
- No IDE autocompletion for remote methods
- Manual JSON navigation can be tedious
- Type annotations scattered through call sites

---

## Approach 3: "Channel-Based CSP" (The Crystal Way)

**Philosophy**: Embrace Crystal's CSP concurrency model. RPC calls communicate through channels. Fibers handle async naturally. This feels like idiomatic Crystal with `select`, `spawn`, and channels -- the way Crystal devs expect concurrent code to work.

### Connection/Session Creation

```crystal
require "capnweb"

# Connection returns a channel-backed session
session = CapnWeb::Session.dial("wss://api.example.com")

# Messages flow through channels
api = session.stub(Api)

# Explicit channel for receiving server-initiated calls
incoming = Channel(CapnWeb::Call).new
session.on_call(incoming)

spawn do
  loop do
    call = incoming.receive
    case call.method
    when "notify"
      puts "Notification: #{call.args[0]}"
      call.respond(nil)
    else
      call.reject(CapnWeb::MethodNotFoundError.new(call.method))
    end
  end
end
```

### Making RPC Calls

```crystal
# Calls return channels (receive to await)
ch = api.users.get(123).channel
user = ch.receive  # Blocks fiber until response

# Or use the convenient .await
user = api.users.get(123).await

# Spawn concurrent calls
results = Channel(User).new(capacity: 3)

[1, 2, 3].each do |id|
  spawn do
    user = api.users.get(id).await
    results.send(user)
  end
end

# Collect results
users = Array(User).new(3) { results.receive }

# Select for first-ready or timeout
ch1 = api.users.get(1).channel
ch2 = api.users.get(2).channel
timeout = Channel(Nil).new

spawn do
  sleep 5.seconds
  timeout.send(nil)
end

select
when user = ch1.receive
  puts "Got user 1 first: #{user.name}"
when user = ch2.receive
  puts "Got user 2 first: #{user.name}"
when timeout.receive
  puts "Timed out waiting for response"
end
```

### Pipelining Syntax

Pipeline building integrates with channel semantics.

```crystal
# Build pipeline (returns Pipeline(T) which has a channel)
pipeline = api.authenticate(token)
              .profile
              .name

# The pipeline is sent when you access the channel or await
name_ch = pipeline.channel
name = name_ch.receive

# Or simply
name = pipeline.await

# Parallel pipelines with select
auth = api.authenticate(token)

profile_name = auth.profile.name
friend_count = auth.friend_ids.map(&.size)

# Both pipeline through auth
select
when name = profile_name.receive
  puts "Name: #{name}"
when count = friend_count.receive
  puts "#{count} friends"
end

# Or await both
name, count = CapnWeb.select(profile_name, friend_count)

# Fan-out pattern
friend_ids = api.users.get(123).friend_ids.await
friend_profiles = Channel(Profile).new(capacity: friend_ids.size)

friend_ids.each do |id|
  spawn do
    profile = api.profiles.get(id).await
    friend_profiles.send(profile)
  end
end
```

### Error Handling

```crystal
# Channels can receive Result(T, Error)
ch = api.users.get(123).result_channel

case result = ch.receive
when CapnWeb::Ok
  puts result.value.name
when CapnWeb::Err
  puts "Error: #{result.error.message}"
end

# Or use select with error channel
response = api.users.get(123)
errors = response.errors

select
when user = response.receive
  puts user.name
when err = errors.receive
  puts "Failed: #{err.message}"
end

# Supervision pattern for long-running connections
supervisor = CapnWeb::Supervisor.new

supervisor.worker(:api) do
  loop do
    begin
      session = CapnWeb::Session.dial(url)
      process_messages(session)
    rescue ex : CapnWeb::ConnectionError
      Log.error { "Connection lost, reconnecting..." }
      sleep 1.second
    end
  end
end

supervisor.start
```

### Exposing Local Objects as RPC Targets

```crystal
# Targets receive calls through a channel
class StreamProcessor
  include CapnWeb::Target

  @buffer = [] of JSON::Any
  @flush_ch = Channel(Nil).new

  def initialize(@session : CapnWeb::Session)
    spawn process_loop
  end

  @[CapnWeb::Export]
  def on_data(chunk : JSON::Any) : Nil
    @buffer << chunk
    @flush_ch.send(nil) if @buffer.size >= 100
  end

  @[CapnWeb::Export]
  def flush : Int32
    count = @buffer.size
    persist(@buffer)
    @buffer.clear
    count
  end

  private def process_loop
    loop do
      select
      when @flush_ch.receive
        persist(@buffer)
        @buffer.clear
      when timeout(10.seconds)
        persist(@buffer) unless @buffer.empty?
        @buffer.clear
      end
    end
  end
end

# Register with session
processor = StreamProcessor.new(session)
session.export("stream", processor)
```

### Pros & Cons

**Pros:**
- Idiomatic Crystal concurrency model
- `select` provides powerful async composition
- Natural fit for bidirectional RPC
- Familiar to Crystal developers
- Good for high-concurrency scenarios

**Cons:**
- More verbose than simple await
- Channel management can be complex
- Need to handle channel closing/cleanup
- Learning curve for CSP patterns

---

## Approach 4: "Compile-Time Pipeline DSL" (The Zero-Cost Way)

**Philosophy**: Use Crystal's macro system to its fullest. Define pipelines declaratively, and the compiler generates optimal code with zero runtime overhead. Type safety is enforced at compile time, and invalid pipelines don't compile.

### Connection/Session Creation

```crystal
require "capnweb"

# Define schema at compile time
CapnWeb.schema do
  service Api do
    rpc authenticate(token : String) : AuthedApi
    rpc public_user(id : Int64) : User

    service users : UserService
  end

  service UserService do
    rpc get(id : Int64) : User
    rpc list : Array(User)
    rpc create(params : UserParams) : User
  end

  service AuthedApi do
    rpc profile : Profile
    rpc friend_ids : Array(Int64)
  end

  service Profile do
    rpc name : String
    rpc bio : String
    rpc update(bio : String) : Nil
  end

  record User, id : Int64, name : String, email : String
  record UserParams, name : String, email : String
end

# Connect with typed root
session = CapnWeb.connect("wss://api.example.com", Api)
api = session.root  # : Api
```

### Making RPC Calls

```crystal
# Every operation is fully typed at compile time
user = api.users.get(123).resolve
# user : User (compiler knows!)

# Type errors are compile errors
# api.users.get("not an id")  # Error: expected Int64, got String

# Chain with full type inference
name = api.authenticate(token)
          .profile
          .name
          .resolve  # : String

# The type of each step is known
authed = api.authenticate(token)  # : Pipeline(AuthedApi)
profile = authed.profile          # : Pipeline(Profile)
name = profile.name               # : Pipeline(String)
```

### Pipelining Syntax

Pipelines are first-class types with compile-time optimization.

```crystal
# Define reusable pipelines with the pipeline macro
CapnWeb.pipeline FetchUserProfile do
  # Input type and output type are inferred
  step auth = authenticate(token)
  step user_id = auth.user_id
  step profile = profiles.get(user_id)

  # Return type is automatically Profile
  profile
end

# Use it
result = FetchUserProfile.call(api, token: my_token)
# result : Profile

# Inline pipeline DSL
profile = api.pipeline do |p|
  auth = p.authenticate(token)
  user_id = p.on(auth).user_id
  p.profiles.get(user_id)
end
# Executes in ONE round trip, type is Profile

# Parallel pipeline branches
name, friends = api.pipeline do |p|
  auth = p.authenticate(token)

  # Both branch from auth
  name = p.on(auth).profile.name
  friends = p.on(auth).friend_ids

  {name, friends}  # Tuple return
end
# name : String, friends : Array(Int64)

# Map operation (server-side transformation)
friend_profiles = api.pipeline do |p|
  ids = p.users.get(123).friend_ids

  # Map executes on server for each id
  p.map(ids) do |id|
    p.profiles.get(id)
  end
end
# friend_profiles : Array(Profile)
```

### Error Handling

```crystal
# Result types with compile-time tracking
result = api.users.get(123).resolve
case result
in CapnWeb::Success(user)
  puts user.name
in CapnWeb::Failure(error)
  puts error.message
end

# Pipeline-level error handling
profile = api.pipeline do |p|
  auth = p.authenticate(token)
           .rescue(CapnWeb::AuthError) { p.anonymous_auth }

  p.on(auth).profile
    .rescue(CapnWeb::NotFoundError) { p.default_profile }
end

# Type-safe error matching
api.users.get(123)
   .on_error(CapnWeb::NotFoundError) { |e|
     Log.warn { "User not found: #{e.id}" }
     nil
   }
   .on_error(CapnWeb::PermissionError) { |e|
     raise AuthorizationError.new(e.message)
   }
   .resolve

# Compile-time retry policy
@[CapnWeb::Retry(times: 3, backoff: :exponential)]
def fetch_with_retry(api, id)
  api.users.get(id).resolve
end
```

### Exposing Local Objects as RPC Targets

```crystal
# Define target schema
CapnWeb.target_schema NotificationHandler do
  rpc on_message(content : String, sender : String) : Nil
  rpc on_error(code : Int32, message : String) : Nil
  rpc on_disconnect(reason : String) : Nil
end

# Implement with compile-time checking
class MyNotificationHandler
  include NotificationHandler

  def on_message(content : String, sender : String) : Nil
    puts "#{sender}: #{content}"
  end

  def on_error(code : Int32, message : String) : Nil
    Log.error { "[#{code}] #{message}" }
  end

  def on_disconnect(reason : String) : Nil
    cleanup
  end

  # Compiler error if you forget to implement a method!
  # Compiler error if signature doesn't match!
end

# Export with type safety
handler = MyNotificationHandler.new
api.subscribe(handler).resolve

# The compiler verifies handler implements NotificationHandler
```

### Advanced: C Bindings for Performance

```crystal
# For extreme performance, bind to a C/Rust implementation
@[Link("capnweb_native")]
lib LibCapnWeb
  fun session_create(url : LibC::Char*) : Void*
  fun session_call(session : Void*, method : LibC::Char*, args : LibC::Char*) : LibC::Char*
  fun session_destroy(session : Void*)
end

# Wrap in Crystal types
class NativeSession
  def initialize(url : String)
    @ptr = LibCapnWeb.session_create(url)
  end

  def call(method : String, args : JSON::Any) : JSON::Any
    result = LibCapnWeb.session_call(@ptr, method, args.to_json)
    JSON.parse(String.new(result))
  end

  def finalize
    LibCapnWeb.session_destroy(@ptr)
  end
end
```

### Pros & Cons

**Pros:**
- Maximum compile-time safety
- Zero runtime overhead for type checking
- Invalid code doesn't compile
- Self-documenting (types show API structure)
- Optimal code generation

**Cons:**
- Requires full schema definition upfront
- Complex macro DSL to learn
- Compile errors can be verbose
- Less flexible than dynamic approaches
- Longer compile times for large schemas

---

## Comparison Matrix

| Feature | Approach 1: Macro Stubs | Approach 2: Dynamic | Approach 3: CSP | Approach 4: Pipeline DSL |
|---------|------------------------|---------------------|-----------------|--------------------------|
| **Type Safety** | Compile-time | Runtime | Compile-time | Compile-time |
| **Pipelining** | Natural chaining | Builder pattern | Channel composition | Macro DSL |
| **Dynamic Calls** | No | Yes | No | No |
| **IDE Support** | Excellent | Limited | Excellent | Excellent |
| **Learning Curve** | Medium | Easy | Medium-Hard | Hard |
| **Performance** | Zero-cost | Small overhead | Channel overhead | Zero-cost |
| **Flexibility** | Medium | High | Medium | Low |
| **Boilerplate** | Medium | Low | Medium | High |
| **Concurrency Model** | Fiber-aware | Manual | CSP/Channels | Declarative |
| **Crystal Feel** | Lucky-like | HTTP::Client-like | Native Crystal | DSL-heavy |

---

## Recommended Hybrid Approach

After analyzing all four approaches, an idiomatic `capnweb` shard would combine the best elements:

### Primary API: Macro-Generated Stubs (Approach 1)

```crystal
require "capnweb"

# Define API contract
CapnWeb.interface Api do
  def users : UserService
  def authenticate(token : String) : AuthedApi
end

CapnWeb.interface UserService do
  def get(id : Int64) : User
  def list : Array(User)
end

# Connect with typed stub
session = CapnWeb.connect("wss://api.example.com")
api = session.stub(Api)

# Typed calls with full IDE support
user = api.users.get(123).await
```

### Pipelining: Natural Chaining (Approach 1 + 4)

```crystal
# Pipeline through promises
name = api.authenticate(token)
          .profile
          .name
          .await  # Single round trip

# Or use explicit pipeline block for complex cases
result = api.pipeline do |p|
  auth = p.authenticate(token)
  {
    name: p.on(auth).profile.name,
    friends: p.on(auth).friend_ids
  }
end
```

### Concurrency: CSP Integration (Approach 3)

```crystal
# Fiber-friendly with channels
spawn do
  user = api.users.get(1).await
  process(user)
end

# Select for first-ready
select
when user = api.users.get(1).receive
  puts "Got user 1"
when user = api.users.get(2).receive
  puts "Got user 2"
when timeout(5.seconds)
  puts "Timed out"
end
```

### Fallback: Dynamic Calls (Approach 2)

```crystal
# When you need to call unknown methods
dynamic = api.as_dynamic
result = dynamic.call("newExperimentalMethod", arg1, arg2).await(JSON::Any)
```

### Targets: Interface + Implementation

```crystal
CapnWeb.target Callback do
  def on_event(data : JSON::Any) : Nil
end

class MyCallback
  include Callback

  def on_event(data : JSON::Any) : Nil
    puts "Event: #{data}"
  end
end

api.subscribe(MyCallback.new).await
```

---

## Implementation Notes

### Shard Structure

```
capnweb/
  shard.yml
  src/
    capnweb.cr           # Main entry, macros
    capnweb/
      version.cr
      session.cr         # Session management
      transport/
        websocket.cr     # WebSocket transport
        http_batch.cr    # HTTP batch transport
      stub.cr            # RpcStub base
      promise.cr         # RpcPromise(T)
      target.cr          # RpcTarget base
      pipeline.cr        # Pipeline DSL
      channel.cr         # Channel integration
      error.cr           # Error types
      json/
        expression.cr    # Expression serialization
        types.cr         # Type encoding (bytes, date, etc.)
  spec/
    spec_helper.cr
    session_spec.cr
    pipeline_spec.cr
    ...
```

### Key Types

```crystal
# A session manages one RPC connection
class Session
  getter transport : Transport
  getter imports : ImportTable
  getter exports : ExportTable

  def stub(t : T.class) : T forall T
  def export(name : String, target : Target)
  def close
end

# A promise that supports pipelining
class RpcPromise(T)
  @session : Session
  @import_id : Int64
  @path : Array(String | Int32)

  # Await the result
  def await : T
  def await(timeout : Time::Span) : T

  # Channel interface for CSP
  def channel : Channel(T)
  def receive : T

  # Pipelining: forward method calls
  macro method_missing(call)
    # Generate pipelined call
  end
end

# Base for RPC targets
abstract class Target
  abstract def handle_call(method : String, args : Array(JSON::Any)) : JSON::Any
end

# Error hierarchy
abstract class CapnWebError < Exception; end
class ConnectionError < CapnWebError; end
class RpcError < CapnWebError
  getter code : String
  getter details : JSON::Any?
end
class NotFoundError < RpcError; end
class PermissionError < RpcError; end
class TimeoutError < CapnWebError; end
```

### Macro Implementation Sketch

```crystal
macro interface(name, &block)
  # Generate stub class
  class {{name}}Stub < CapnWeb::Stub
    {% for method in block.body.expressions %}
      {% if method.is_a?(Def) %}
        def {{method.name}}({{method.args.splat}}) : RpcPromise({{method.return_type}})
          pipeline_call({{method.name.stringify}}, {{method.args.map(&.name)}})
        end
      {% end %}
    {% end %}
  end

  # Generate interface module for targets
  module {{name}}
    {% for method in block.body.expressions %}
      {% if method.is_a?(Def) %}
        abstract def {{method.name}}({{method.args.splat}}) : {{method.return_type}}
      {% end %}
    {% end %}
  end
end
```

### Feature Flags (shard.yml)

```yaml
name: capnweb
version: 0.1.0

dependencies:
  http:
    github: crystal-lang/crystal
  json:
    github: crystal-lang/crystal

development_dependencies:
  spectator:
    github: icy-arctic-fox/spectator

# Optional transports
websocket:
  github: crystal-lang/http

# For native bindings
native:
  link: capnweb_native
```

---

## Open Questions

1. **Nil handling**: How to represent `undefined` from JavaScript? Use `Nil`? A custom `Undefined` type?

2. **BigInt**: Crystal has `BigInt`, but should we use it for all large integers or only when needed?

3. **Bytes**: Use `Bytes` (Slice(UInt8)) or `Array(UInt8)` for binary data?

4. **Streaming**: How to handle streaming responses? `Iterator(T)`? `Channel(T)`?

5. **Cancellation**: Should dropping an `RpcPromise` cancel the request? How to implement cooperative cancellation?

6. **Session lifecycle**: How to handle reconnection? Should `Session` auto-reconnect?

7. **Thread safety**: Crystal is single-threaded with fibers, but what about multi-fiber safety for shared sessions?

---

## What Makes a Crystal Developer Say "Beautiful"

1. **Type inference that just works** -- Write Ruby-like code, get static guarantees
2. **Compile-time catches everything** -- If it compiles, it works
3. **Macros for DRY** -- Define once, generate everywhere
4. **Channels and select** -- CSP concurrency that scales
5. **Performance by default** -- No hidden allocations or boxing
6. **Ruby syntax** -- Familiar and readable
7. **Nil safety** -- No null pointer exceptions ever

The goal: A shard that feels like it was born from Crystal's type system, not fighting against it. The stub looks like a local object, the pipeline looks like method chaining, and the concurrency looks like idiomatic Crystal fibers and channels.

---

## Next Steps

1. Implement Approach 1 (macro-generated stubs) as the primary API
2. Add CSP integration (Approach 3) for concurrency
3. Include dynamic fallback (Approach 2) for exploratory use
4. Write comprehensive specs with mock WebSocket server
5. Benchmark against raw HTTP to measure overhead
6. Publish to shards.info as `capnweb`
