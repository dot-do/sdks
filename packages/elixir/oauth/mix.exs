defmodule OauthDo.MixProject do
  use Mix.Project

  def project do
    [
      app: :oauth_do,
      version: "0.1.0",
      elixir: "~> 1.14",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: "OAuth device flow SDK for .do APIs",
      package: package()
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:req, "~> 0.4"},
      {:jason, "~> 1.4"}
    ]
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{"GitHub" => "https://github.com/dotdo/oauth-elixir"}
    ]
  end
end
