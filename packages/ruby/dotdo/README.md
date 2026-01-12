# platform.do

The official Ruby SDK for the DotDo platform. This gem provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform.do` is the highest-level SDK in the DotDo stack, built on top of:

- **[rpc.do](../rpc)** - Type-safe RPC client
- **[capnweb.do](../capnweb)** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Ruby API.

```
+------------------+
|   platform.do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc.do       |  <-- RPC client layer
+------------------+
|   capnweb.do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **Thread Safety**: Safe for use in multi-threaded applications
- **Fiber/Async Support**: Works with async-io and Falcon
- **Rails Integration**: Easy integration with Rails applications

## Installation

Add to your Gemfile:

```ruby
gem 'platform.do', '~> 0.1'
```

Then run:

```bash
bundle install
```

Or install directly:

```bash
gem install platform.do
```

## Quick Start

### Basic Usage

```ruby
require 'platform_do'

# Create a client
client = PlatformDo::Client.new(api_key: ENV['DOTDO_API_KEY'])

# Make an RPC call
result = client.call('ai.generate', {
  prompt: 'Hello, world!',
  model: 'claude-3'
})

puts result['text']

# Clean up
client.close
```

### Block Form

```ruby
require 'platform_do'

PlatformDo::Client.with(api_key: ENV['DOTDO_API_KEY']) do |client|
  result = client.call('ai.generate', { prompt: 'Hello!' })
  puts result['text']
end
# Connection automatically closed
```

## Configuration

### Client Options

```ruby
client = PlatformDo::Client.new(
  # Authentication
  api_key: 'your-api-key',        # API key authentication
  access_token: 'oauth-token',     # OAuth bearer token
  headers: { 'X-Custom' => 'val' }, # Custom headers

  # Endpoint
  endpoint: 'wss://api.dotdo.dev/rpc',

  # Connection Pool
  pool_size: 10,                   # Maximum connections
  pool_timeout: 30,                # Connection acquire timeout (seconds)

  # Retry Policy
  max_retries: 3,                  # Number of retry attempts
  retry_delay: 0.1,                # Initial retry delay (seconds)
  retry_max_delay: 30,             # Maximum retry delay
  retry_multiplier: 2.0,           # Exponential backoff multiplier

  # Request Settings
  timeout: 30,                     # Default request timeout (seconds)

  # Debug
  debug: false,                    # Enable debug logging
  logger: Logger.new($stdout)      # Custom logger
)
```

### Environment Variables

```bash
# Authentication
export DOTDO_API_KEY=your-api-key
export DOTDO_ACCESS_TOKEN=oauth-token

# Endpoint
export DOTDO_ENDPOINT=wss://api.dotdo.dev/rpc

# Connection Pool
export DOTDO_POOL_SIZE=10
export DOTDO_POOL_TIMEOUT=30

# Retry
export DOTDO_MAX_RETRIES=3
export DOTDO_RETRY_DELAY=0.1

# Request
export DOTDO_TIMEOUT=30

# Debug
export DOTDO_DEBUG=true
```

### Rails Configuration

Create `config/initializers/platform_do.rb`:

```ruby
PlatformDo.configure do |config|
  config.api_key = Rails.application.credentials.dotdo[:api_key]
  config.endpoint = ENV.fetch('DOTDO_ENDPOINT', 'wss://api.dotdo.dev/rpc')
  config.pool_size = ENV.fetch('DOTDO_POOL_SIZE', 10).to_i
  config.timeout = ENV.fetch('DOTDO_TIMEOUT', 30).to_i
  config.debug = Rails.env.development?
  config.logger = Rails.logger
end
```

Then use the global client:

```ruby
# In your application code
result = PlatformDo.call('ai.generate', { prompt: 'Hello!' })
```

## Authentication

### API Key

```ruby
client = PlatformDo::Client.new(api_key: 'your-api-key')
```

### OAuth Token

```ruby
client = PlatformDo::Client.new(access_token: 'oauth-access-token')
```

### Custom Headers

```ruby
client = PlatformDo::Client.new(
  api_key: 'your-api-key',
  headers: {
    'X-Tenant-ID' => 'tenant-123',
    'X-Request-ID' => SecureRandom.uuid
  }
)
```

### Dynamic Authentication

```ruby
client = PlatformDo::Client.new do |config|
  config.auth_provider = -> {
    # Fetch fresh token
    { 'Authorization' => "Bearer #{fetch_token}" }
  }
end
```

## Connection Pooling

The SDK uses connection pooling for efficiency:

```ruby
client = PlatformDo::Client.new(
  api_key: 'key',
  pool_size: 20,       # Maximum concurrent connections
  pool_timeout: 60     # Wait up to 60s for available connection
)
```

### Pool Behavior

1. Connections are created on-demand up to `pool_size`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, requests wait up to `pool_timeout`
4. Dead connections are automatically removed from the pool

### Pool Statistics

```ruby
stats = client.pool_stats
puts "Available: #{stats[:available]}"
puts "In use: #{stats[:in_use]}"
puts "Total: #{stats[:total]}"
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```ruby
client = PlatformDo::Client.new(
  api_key: 'key',
  max_retries: 5,
  retry_delay: 0.2,        # Start with 200ms
  retry_max_delay: 60,     # Cap at 60 seconds
  retry_multiplier: 2.0    # Double each time
)
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Custom Retry Logic

```ruby
client = PlatformDo::Client.new(api_key: 'key') do |config|
  config.retry_policy = PlatformDo::RetryPolicy.new(
    max_retries: 5,
    should_retry: ->(error, attempt) {
      # Custom retry logic
      error.is_a?(PlatformDo::ConnectionError) && attempt < 5
    }
  )
end
```

## Making RPC Calls

### Basic Call

```ruby
result = client.call('method.name', { param: 'value' })
```

### With Timeout Override

```ruby
result = client.call(
  'ai.generate',
  { prompt: 'Long task...' },
  timeout: 120  # 2 minute timeout for this call
)
```

### With Options Hash

```ruby
result = client.call(
  'ai.generate',
  { prompt: 'Hello' },
  timeout: 60,
  headers: { 'X-Priority' => 'high' }
)
```

### Streaming Responses

```ruby
client.stream('ai.generate', { prompt: 'Hello' }) do |chunk|
  print chunk
  $stdout.flush
end
```

## Error Handling

### Exception Hierarchy

```ruby
PlatformDo::Error                  # Base error
  PlatformDo::AuthError            # Authentication failed
  PlatformDo::ConnectionError      # Connection issues
  PlatformDo::TimeoutError         # Request timed out
  PlatformDo::RateLimitError       # Rate limit exceeded
  PlatformDo::RpcError             # RPC method error
  PlatformDo::PoolExhaustedError   # No available connections
```

### Error Handling Example

```ruby
begin
  result = client.call('ai.generate', { prompt: 'Hello' })
rescue PlatformDo::AuthError => e
  puts "Authentication failed: #{e.message}"
  # Re-authenticate or check API key
rescue PlatformDo::RateLimitError => e
  puts "Rate limited. Retry after: #{e.retry_after}s"
  sleep(e.retry_after)
  retry
rescue PlatformDo::TimeoutError
  puts "Request timed out"
  # Maybe try with longer timeout
rescue PlatformDo::RpcError => e
  puts "RPC error (#{e.code}): #{e.message}"
rescue PlatformDo::Error => e
  puts "DotDo error: #{e.message}"
  raise
end
```

## Collections API

### Working with Collections

```ruby
users = client.collection('users')

# Create a document
users.set('user-123', {
  name: 'Alice',
  email: 'alice@example.com'
})

# Read a document
user = users.get('user-123')
puts user

# Update a document
users.update('user-123', { name: 'Alice Smith' })

# Delete a document
users.delete('user-123')
```

### Querying Collections

```ruby
users = client.collection('users')

# Build a query
results = users.query
  .where(:status, :==, 'active')
  .where(:age, :>=, 18)
  .order_by(:created_at, :desc)
  .limit(10)
  .offset(0)
  .execute

results.each do |user|
  puts user
end
```

### Query with Block

```ruby
results = users.query do |q|
  q.where(:status, :==, 'active')
  q.order_by(:created_at, :desc)
  q.limit(10)
end

results.each { |user| puts user[:name] }
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `:==`    | Equal to |
| `:!=`    | Not equal to |
| `:<`     | Less than |
| `:<=`    | Less than or equal |
| `:>`     | Greater than |
| `:>=`    | Greater than or equal |
| `:in`    | In array |
| `:not_in`| Not in array |

## Async Support

### With Async Gem

```ruby
require 'platform_do'
require 'async'

Async do
  client = PlatformDo::Client.new(api_key: ENV['DOTDO_API_KEY'])

  # Concurrent requests
  tasks = 3.times.map do |i|
    Async do
      client.call('ai.generate', { prompt: "Task #{i}" })
    end
  end

  results = tasks.map(&:wait)
  puts results
ensure
  client.close
end
```

### With Concurrent Ruby

```ruby
require 'platform_do'
require 'concurrent'

client = PlatformDo::Client.new(api_key: ENV['DOTDO_API_KEY'])

# Thread pool for concurrent requests
pool = Concurrent::FixedThreadPool.new(5)

futures = 10.times.map do |i|
  Concurrent::Future.execute(executor: pool) do
    client.call('ai.generate', { prompt: "Request #{i}" })
  end
end

results = futures.map(&:value)
puts results

client.close
pool.shutdown
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```ruby
# Auth is handled automatically
client = PlatformDo::Client.new(api_key: ENV['DOTDO_API_KEY'])
```

### Usage Metrics

```ruby
# Platform tracks usage automatically
# View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```ruby
# Usage is metered and billed through the platform
# Configure billing at https://platform.do/billing
```

### Centralized Logging

```ruby
# Enable debug mode for verbose logging
client = PlatformDo::Client.new(
  api_key: 'key',
  debug: true,
  logger: Logger.new($stdout)
)
```

## Best Practices

### 1. Use Block Form for Automatic Cleanup

```ruby
# Good - automatic cleanup
PlatformDo::Client.with(api_key: 'key') do |client|
  client.call('method', params)
end

# Also good - explicit cleanup
client = PlatformDo::Client.new(api_key: 'key')
begin
  client.call('method', params)
ensure
  client.close
end
```

### 2. Reuse Client Instances

```ruby
# Good - single client instance
class MyService
  def initialize
    @client = PlatformDo::Client.new(api_key: ENV['DOTDO_API_KEY'])
  end

  def generate(prompt)
    @client.call('ai.generate', { prompt: prompt })
  end

  def close
    @client.close
  end
end

# Bad - new client per request
def bad_generate(prompt)
  client = PlatformDo::Client.new(api_key: 'key')
  client.call('ai.generate', { prompt: prompt })
  # Connection leaked!
end
```

### 3. Handle Specific Errors

```ruby
# Good - specific error handling
begin
  client.call('method', params)
rescue PlatformDo::RateLimitError => e
  sleep(e.retry_after)
  retry
rescue PlatformDo::AuthError
  refresh_credentials
  retry
rescue PlatformDo::Error
  raise
end

# Bad - catch-all
begin
  client.call('method', params)
rescue StandardError
  # Swallowing all errors
end
```

### 4. Use Symbols for Keys

```ruby
# Good - Ruby convention
client.call('ai.generate', { prompt: 'Hello', model: 'claude-3' })

# Also works but less idiomatic
client.call('ai.generate', { 'prompt' => 'Hello', 'model' => 'claude-3' })
```

## API Reference

### PlatformDo::Client

```ruby
class Client
  # Initialize a new client
  def initialize(**options, &block)

  # Make an RPC call
  def call(method, params = {}, **options)

  # Stream a response
  def stream(method, params = {}, &block)

  # Get a collection reference
  def collection(name)

  # Get pool statistics
  def pool_stats

  # Close all connections
  def close

  # Block form with automatic cleanup
  def self.with(**options, &block)
end
```

### PlatformDo::Collection

```ruby
class Collection
  def get(id)
  def set(id, data)
  def update(id, data)
  def delete(id)
  def query(&block)
end
```

### PlatformDo::Query

```ruby
class Query
  def where(field, operator, value)
  def order_by(field, direction = :asc)
  def limit(n)
  def offset(n)
  def execute
  def first
end
```

## Requirements

- Ruby 3.1+
- WebSocket support (included)

## Development

```bash
# Install dependencies
bundle install

# Run tests
bundle exec rspec

# Run linter
bundle exec rubocop

# Build gem
gem build platform.do.gemspec
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/ruby)
- [RubyGems](https://rubygems.org/gems/platform.do)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
