defmodule DotDo.Mongo.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Registry for named clients
      {Registry, keys: :unique, name: DotDo.Mongo.Registry},

      # Dynamic supervisor for change streams
      {DynamicSupervisor, strategy: :one_for_one, name: DotDo.Mongo.ChangeStreamSupervisor}
    ]

    opts = [strategy: :one_for_one, name: DotDo.Mongo.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
