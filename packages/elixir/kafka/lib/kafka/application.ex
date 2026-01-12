defmodule DotDo.Kafka.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Registry for named clients
      {Registry, keys: :unique, name: DotDo.Kafka.Registry},

      # Dynamic supervisor for consumers
      {DynamicSupervisor, strategy: :one_for_one, name: DotDo.Kafka.ConsumerSupervisor}
    ]

    opts = [strategy: :one_for_one, name: DotDo.Kafka.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
