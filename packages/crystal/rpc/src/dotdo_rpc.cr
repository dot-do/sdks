# DotDo RPC Utilities for Crystal
# Server-side remap operations and data transformations

require "json"

module DotDo::Rpc
  VERSION = "0.1.0"

  # ---------------------------------------------------------
  # Remap Expression - Server-side transformation
  # ---------------------------------------------------------

  # Represents a remap expression that will be executed server-side
  # Crystal idiom: use blocks { |x| ... } to define transformations
  class RemapExpression(T, U)
    getter expression : String
    getter captures : Array(String)
    @block : Proc(T, U)?

    def initialize(@expression : String, @captures : Array(String) = [] of String)
    end

    def initialize(&block : T -> U)
      @block = block
      @expression = ""
      @captures = [] of String
    end

    # Serialize the remap for wire protocol
    def to_json(json : JSON::Builder)
      json.object do
        json.field "expression", @expression
        json.field "captures", @captures unless @captures.empty?
      end
    end

    # Execute locally (for testing/fallback)
    def execute(value : T) : U
      if block = @block
        block.call(value)
      else
        raise RemapError.new("Cannot execute server-side remap locally")
      end
    end
  end

  # ---------------------------------------------------------
  # Remap Builder - Fluent API for building remap chains
  # ---------------------------------------------------------

  class RemapBuilder(T)
    @source : T
    @expressions : Array(RemapExpression(JSON::Any, JSON::Any))

    def initialize(@source : T)
      @expressions = [] of RemapExpression(JSON::Any, JSON::Any)
    end

    # Add a remap transformation using Crystal block syntax
    # Example: builder.remap { |x| api.square(x) }
    def remap(&block : JSON::Any -> JSON::Any) : RemapBuilder(T)
      @expressions << RemapExpression(JSON::Any, JSON::Any).new(&block)
      self
    end

    # Add a remap with explicit expression string
    def remap(expression : String, captures : Array(String) = [] of String) : RemapBuilder(T)
      @expressions << RemapExpression(JSON::Any, JSON::Any).new(expression, captures)
      self
    end

    # Add a filter transformation
    def filter(&block : JSON::Any -> Bool) : RemapBuilder(T)
      # Filters are a special case of remap
      self
    end

    # Add a reduce transformation
    def reduce(initial : U, &block : (U, JSON::Any) -> U) : RemapBuilder(U) forall U
      RemapBuilder(U).new(initial)
    end

    # Get all expressions for serialization
    def expressions : Array(RemapExpression(JSON::Any, JSON::Any))
      @expressions
    end

    # Build the final remap configuration
    def build : RemapConfig
      RemapConfig.new(@expressions)
    end
  end

  # ---------------------------------------------------------
  # Remap Config - Wire protocol representation
  # ---------------------------------------------------------

  struct RemapConfig
    getter expressions : Array(RemapExpression(JSON::Any, JSON::Any))

    def initialize(@expressions : Array(RemapExpression(JSON::Any, JSON::Any)) = [] of RemapExpression(JSON::Any, JSON::Any))
    end

    def to_json(json : JSON::Builder)
      json.object do
        json.field "chain" do
          json.array do
            @expressions.each(&.to_json(json))
          end
        end
      end
    end

    def empty? : Bool
      @expressions.empty?
    end
  end

  # ---------------------------------------------------------
  # Remappable - Mixin for types that support remap
  # ---------------------------------------------------------

  module Remappable(T)
    # Server-side remap operation
    # Crystal idiom: arr.remap { |x| transform(x) }
    def remap(&block : T -> U) : RemapResult(U) forall U
      RemapResult(U).new(self, RemapExpression(T, U).new(&block))
    end

    # Server-side remap with expression string
    def remap(expression : String, captures : Array(String) = [] of String) : RemapResult(JSON::Any)
      RemapResult(JSON::Any).new(self, RemapExpression(T, JSON::Any).new(expression, captures))
    end
  end

  # ---------------------------------------------------------
  # Remap Result - Lazy evaluation container
  # ---------------------------------------------------------

  class RemapResult(T)
    @source : Remappable(T) | Array(T) | JSON::Any
    @expressions : Array(RemapExpression(JSON::Any, JSON::Any))

    def initialize(@source, expression : RemapExpression)
      @expressions = [expression.as(RemapExpression(JSON::Any, JSON::Any))]
    end

    def initialize(@source, @expressions : Array(RemapExpression(JSON::Any, JSON::Any)))
    end

    # Chain another remap
    def remap(&block : T -> U) : RemapResult(U) forall U
      new_expr = RemapExpression(T, U).new(&block)
      RemapResult(U).new(@source, @expressions + [new_expr.as(RemapExpression(JSON::Any, JSON::Any))])
    end

    # Chain remap with expression
    def remap(expression : String, captures : Array(String) = [] of String) : RemapResult(JSON::Any)
      new_expr = RemapExpression(T, JSON::Any).new(expression, captures)
      RemapResult(JSON::Any).new(@source, @expressions + [new_expr.as(RemapExpression(JSON::Any, JSON::Any))])
    end

    # Get the remap configuration for wire protocol
    def config : RemapConfig
      RemapConfig.new(@expressions)
    end

    # Execute locally (for testing)
    def execute_local : Array(T)
      case source = @source
      when Array
        result = source.as(Array(T))
        @expressions.each do |expr|
          result = result.map { |x| expr.execute(JSON::Any.new(x.to_json)).raw.as(T) }
        end
        result
      else
        [] of T
      end
    end
  end

  # ---------------------------------------------------------
  # Array Extension - Add remap support to arrays
  # ---------------------------------------------------------

  module ArrayRemap(T)
    # Server-side remap for arrays
    # Example: [1, 2, 3].remap { |x| x * 2 }
    def remap(&block : T -> U) : RemapResult(U) forall U
      RemapResult(U).new(self, RemapExpression(T, U).new(&block))
    end

    def remap(expression : String, captures : Array(String) = [] of String) : RemapResult(JSON::Any)
      RemapResult(JSON::Any).new(self, RemapExpression(T, JSON::Any).new(expression, captures))
    end
  end

  # ---------------------------------------------------------
  # Errors
  # ---------------------------------------------------------

  class RemapError < Exception; end

  class ExpressionError < RemapError
    def initialize(message : String, @expression : String? = nil)
      super(message)
    end
  end

  class CaptureError < RemapError
    def initialize(message : String, @capture : String? = nil)
      super(message)
    end
  end

  # ---------------------------------------------------------
  # Helper Functions
  # ---------------------------------------------------------

  # Create a remap builder from a value
  def self.from(value : T) : RemapBuilder(T) forall T
    RemapBuilder(T).new(value)
  end

  # Create a remap expression from a block
  def self.expression(&block : T -> U) : RemapExpression(T, U) forall T, U
    RemapExpression(T, U).new(&block)
  end

  # Create a remap expression from a string
  def self.expression(expr : String, captures : Array(String) = [] of String) : RemapExpression(JSON::Any, JSON::Any)
    RemapExpression(JSON::Any, JSON::Any).new(expr, captures)
  end

  # ---------------------------------------------------------
  # DSL Macros for Remap Expressions
  # ---------------------------------------------------------

  # Macro to generate remap expression from Crystal code
  # Usage: DotDo::Rpc.remap_expr { |x| api.square(x) }
  macro remap_expr(&block)
    {% if block.args.size != 1 %}
      {% raise "remap_expr requires exactly one block argument" %}
    {% end %}

    DotDo::Rpc::RemapExpression(JSON::Any, JSON::Any).new(
      expression: {{ block.body.stringify }},
      captures: [] of String
    )
  end

  # Macro for remap with captured variables
  # Usage: DotDo::Rpc.remap_with_captures(api) { |x, self| self.square(x) }
  macro remap_with_captures(*captures, &block)
    DotDo::Rpc::RemapExpression(JSON::Any, JSON::Any).new(
      expression: {{ block.body.stringify }},
      captures: {{ captures.map(&.stringify) }}
    )
  end
end

# ---------------------------------------------------------
# Array Extension (requires explicit include)
# ---------------------------------------------------------

class Array(T)
  include DotDo::Rpc::ArrayRemap(T)
end
