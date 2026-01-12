# {{name}}.do

{{description}}

## Installation

Add this line to your application's Gemfile:

```ruby
gem '{{name}}.do'
```

And then execute:

```bash
bundle install
```

Or install it yourself as:

```bash
gem install {{name}}.do
```

## Usage

```ruby
require '{{name}}.do'

client = {{Name}}Do::Client.new(api_key: ENV['DOTDO_KEY'])

# Connect and use the service
rpc = client.connect
result = rpc.example
puts result
```

## API Reference

### `{{Name}}Do::Client`

The main client class for interacting with the {{name}}.do service.

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `api_key` | `String` | `nil` | API key for authentication |
| `base_url` | `String` | `https://{{name}}.do` | Base URL for the service |

#### Methods

- `connect` - Connect to the service and return an RPC client
- `disconnect` - Disconnect from the service

## Running Tests

```bash
bundle exec rspec
```

## Development

After checking out the repo, run `bin/setup` to install dependencies. Then, run `rake spec` to run the tests.

## License

MIT
