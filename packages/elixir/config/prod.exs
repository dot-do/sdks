# Production configuration
import Config

config :logger, level: :info

config :capnweb,
  default_timeout: 30_000,
  reconnect_interval: 5_000,
  max_reconnect_attempts: 20
