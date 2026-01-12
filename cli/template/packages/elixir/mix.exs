defmodule {{Name}}Do.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source_url "https://github.com/dot-do/{{name}}"

  def project do
    [
      app: :{{name}}_do,
      version: @version,
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: description(),
      package: package(),
      docs: docs(),
      name: "{{Name}}Do",
      source_url: @source_url
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:rpc_do, "~> 0.1.0"},
      {:websock_adapter, "~> 0.5"},
      {:mint_web_socket, "~> 1.0"},
      {:jason, "~> 1.4"},
      {:ex_doc, "~> 0.31", only: :dev, runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
    ]
  end

  defp description do
    """
    {{Name}}.do SDK for Elixir - {{description}}
    """
  end

  defp package do
    [
      name: "{{name}}_do",
      licenses: ["MIT"],
      links: %{
        "GitHub" => @source_url,
        "Homepage" => "https://{{name}}.do"
      }
    ]
  end

  defp docs do
    [
      main: "readme",
      extras: ["README.md"],
      source_ref: "v#{@version}"
    ]
  end
end
