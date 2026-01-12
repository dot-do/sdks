defmodule DotDo.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source_url "https://github.com/dotdo/dotdo-elixir"

  def project do
    [
      app: :dotdo,
      version: @version,
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),

      # Hex
      description: "DotDo platform SDK for Elixir - Authentication, connection pooling, and retry logic",
      package: package(),

      # Docs
      name: "DotDo",
      docs: docs(),

      # Test
      test_paths: ["test"],
      test_pattern: "*_test.exs",
      elixirc_paths: elixirc_paths(Mix.env())
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {DotDo.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # HTTP client
      {:finch, "~> 0.18"},

      # JSON encoding
      {:jason, "~> 1.4"},

      # Options validation
      {:nimble_options, "~> 1.0"},

      # Telemetry for metrics
      {:telemetry, "~> 1.2"},

      # Dev/Test
      {:ex_doc, "~> 0.31", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
    ]
  end

  defp aliases do
    [
      test: ["test"]
    ]
  end

  defp package do
    [
      maintainers: ["DotDo Team"],
      licenses: ["MIT"],
      links: %{
        "GitHub" => @source_url
      },
      files: ~w(lib mix.exs README.md LICENSE CHANGELOG.md)
    ]
  end

  defp docs do
    [
      main: "readme",
      source_url: @source_url,
      extras: ["README.md"]
    ]
  end
end
