defmodule DotDo.CapnWeb.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source_url "https://github.com/dotdo/capnweb"

  def project do
    [
      app: :dotdo_capnweb,
      version: @version,
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      aliases: aliases(),

      # Hex
      description: "DotDo Cap'n Web RPC client for Elixir - Promise pipelining over WebSocket",
      package: package(),

      # Docs
      name: "DotDo.CapnWeb",
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
      mod: {DotDo.CapnWeb.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # WebSocket client
      {:websockex, "~> 0.4.3"},

      # Alternative: Mint-based WebSocket (lighter weight)
      # {:mint_web_socket, "~> 1.0"},

      # JSON encoding
      {:jason, "~> 1.4"},

      # YAML parsing for conformance tests
      {:yaml_elixir, "~> 2.9"},

      # Options validation
      {:nimble_options, "~> 1.0"},

      # Optional: GenStage for streaming (optional dep)
      {:gen_stage, "~> 1.2", optional: true},

      # Optional: Phoenix integration
      {:phoenix, "~> 1.7", optional: true},

      # Dev/Test
      {:ex_doc, "~> 0.31", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false}
    ]
  end

  defp aliases do
    [
      test: ["test"],
      "test.conformance": ["test --only conformance"],
      "test.unit": ["test --exclude conformance"]
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
      extras: ["README.md", "CHANGELOG.md"]
    ]
  end
end
