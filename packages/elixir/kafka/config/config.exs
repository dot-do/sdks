import Config

# Default configuration for DotDo.Kafka
config :kafka_do,
  default_timeout: 30_000,
  pool_size: 10

# Import environment specific config
import_config "#{config_env()}.exs"
