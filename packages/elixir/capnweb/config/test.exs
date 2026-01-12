# Test configuration
import Config

config :logger, level: :warning

config :dotdo_capnweb,
  default_timeout: 10_000

# Conformance test configuration can be overridden via environment variables:
# TEST_SERVER_URL - URL of the test server
# TEST_SPEC_DIR - Directory containing conformance YAML specs
