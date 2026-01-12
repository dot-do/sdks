defmodule DotDo.CapnWeb.Test.ConformanceConfig do
  @moduledoc """
  Configuration and utilities for conformance tests.
  """

  @doc """
  Returns the test server URL from environment or default.
  """
  @spec server_url() :: String.t()
  def server_url do
    System.get_env("TEST_SERVER_URL", "ws://localhost:8080")
  end

  @doc """
  Returns the conformance spec directory.
  """
  @spec spec_dir() :: String.t()
  def spec_dir do
    System.get_env("TEST_SPEC_DIR", Path.expand("../../../../test/conformance", __DIR__))
  end

  @doc """
  Loads all YAML conformance specs from the spec directory.
  """
  @spec load_specs() :: [map()]
  def load_specs do
    spec_dir()
    |> Path.join("*.yaml")
    |> Path.wildcard()
    |> Enum.map(&load_spec/1)
    |> Enum.reject(&is_nil/1)
  end

  @doc """
  Loads a specific YAML spec file.
  """
  @spec load_spec(String.t()) :: map() | nil
  def load_spec(file_path) do
    case YamlElixir.read_from_file(file_path) do
      {:ok, spec} ->
        Map.put(spec, "_file", file_path)

      {:error, reason} ->
        IO.warn("Failed to load spec #{file_path}: #{inspect(reason)}")
        nil
    end
  end

  @doc """
  Checks if the SDK is implemented enough for testing.
  """
  @spec sdk_implemented?() :: boolean()
  def sdk_implemented? do
    # Check if core functions exist and are implemented
    Code.ensure_loaded?(DotDo.CapnWeb) and
      function_exported?(DotDo.CapnWeb, :connect, 1)
  end
end
