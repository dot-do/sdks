# Configuration for CapnWeb
import Config

# Default configuration
config :capnweb,
  default_timeout: 30_000,
  reconnect_interval: 1_000,
  max_reconnect_attempts: 10

# Import environment-specific config
import_config "#{config_env()}.exs"
