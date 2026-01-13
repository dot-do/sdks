# Ruby Installation

The Ruby SDK provides idiomatic Ruby access to Cap'n Web RPC.

## Installation

```bash
gem install capnweb
```

Or add to your Gemfile:

```ruby
gem 'capnweb', '~> 0.1'
```

Then run:

```bash
bundle install
```

## Requirements

- Ruby 3.1 or later
- `async` gem (installed automatically)
- `websocket-client` gem (installed automatically)

## Basic Usage

### Client

```ruby
require 'capnweb'

CapnWeb.connect('wss://api.example.com') do |api|
  # Make RPC calls
  greeting = api.greet('World').await!
  puts greeting  # "Hello, World!"

  # Get user data
  user = api.get_user(123).await!
  puts "User: #{user['name']}"
end
```

### Async/Await Style

```ruby
require 'capnweb'
require 'async'

Async do
  api = CapnWeb.connect('wss://api.example.com')

  greeting = await api.greet('World')
  puts greeting

  user = await api.get_user(123)
  puts "User: #{user['name']}"
ensure
  api.close
end
```

### Promise Pipelining

```ruby
require 'capnweb'

CapnWeb.connect('wss://api.example.com') do |api|
  # Pipeline calls in a single round trip
  user = api.get_user(123)  # Don't await yet
  profile = api.get_profile(user.id).await!  # Pipelined!

  puts "Profile: #{profile['name']}"
end
```

## Server Implementation

```ruby
require 'capnweb'
require 'webrick'
require 'webrick/websocket'

class MyApi < CapnWeb::RpcTarget
  def greet(name)
    "Hello, #{name}!"
  end

  def get_user(id)
    {
      id: id,
      name: 'Alice',
      email: 'alice@example.com'
    }
  end
end

server = WEBrick::HTTPServer.new(Port: 8080)

server.mount_proc '/api' do |req, res|
  CapnWeb.serve_websocket(req, res, MyApi.new)
end

trap('INT') { server.shutdown }
server.start
```

## Error Handling

```ruby
require 'capnweb'

CapnWeb.connect('wss://api.example.com') do |api|
  begin
    result = api.risky_operation.await!
  rescue CapnWeb::RpcError => e
    puts "RPC failed: #{e.message}"
  rescue CapnWeb::ConnectionError => e
    puts "Connection lost: #{e.message}"
  end
end
```

## Configuration Options

```ruby
CapnWeb.connect(
  'wss://api.example.com',
  timeout: 30,  # Connection timeout in seconds
  reconnect: true,  # Auto-reconnect on disconnect
  headers: { 'X-Custom' => 'header' }  # Custom headers
) do |api|
  # ...
end
```

## HTTP Batch Mode

```ruby
require 'capnweb'

CapnWeb.http_batch('https://api.example.com') do |api|
  # Queue up calls
  greeting1 = api.greet('Alice')
  greeting2 = api.greet('Bob')

  # Batch sent when awaited
  results = [greeting1, greeting2].map(&:await!)
  puts results  # ["Hello, Alice!", "Hello, Bob!"]
end
```

## Integration with Rails

```ruby
# config/initializers/capnweb.rb
Rails.application.config.capnweb = {
  url: ENV['CAPNWEB_URL'],
  timeout: 30
}

# app/services/api_client.rb
class ApiClient
  def self.connection
    @connection ||= CapnWeb.connect(
      Rails.application.config.capnweb[:url],
      timeout: Rails.application.config.capnweb[:timeout]
    )
  end

  def self.greet(name)
    connection.greet(name).await!
  end
end
```

## Integration with Sinatra

```ruby
require 'sinatra'
require 'sinatra/websocket'
require 'capnweb'

class MyApi < CapnWeb::RpcTarget
  def greet(name)
    "Hello, #{name}!"
  end
end

get '/api' do
  if request.websocket?
    request.websocket do |ws|
      CapnWeb.serve(ws, MyApi.new)
    end
  end
end
```

## Troubleshooting

### Async Errors

Ensure you're using `await!` or the block form:

```ruby
# WRONG - missing await
greeting = api.greet('World')
puts greeting  # This is a Promise, not a String!

# CORRECT - with await
greeting = api.greet('World').await!
puts greeting
```

### Type Errors

Ruby returns Hashes, not typed objects:

```ruby
user = api.get_user(123).await!
# user is a Hash
puts user['name']  # Use string keys
# or
puts user[:name]   # Use symbol keys (depends on server)
```

### Connection Issues

Check that the URL is correct and the server is running:

```ruby
begin
  CapnWeb.connect('wss://api.example.com') do |api|
    # ...
  end
rescue CapnWeb::ConnectionError => e
  puts "Failed to connect: #{e.message}"
end
```
