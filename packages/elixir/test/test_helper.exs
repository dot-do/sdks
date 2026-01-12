# Configure ExUnit
ExUnit.configure(
  exclude: [:skip],
  formatters: [ExUnit.CLIFormatter]
)

ExUnit.start()
