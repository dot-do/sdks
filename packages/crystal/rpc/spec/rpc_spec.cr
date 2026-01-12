# DotDo RPC Spec Tests
require "spec"
require "../src/dotdo_rpc"

describe DotDo::Rpc do
  describe "RemapExpression" do
    it "creates expression with block" do
      expr = DotDo::Rpc::RemapExpression(Int32, Int32).new { |x| x * 2 }
      expr.execute(5).should eq(10)
    end

    it "creates expression with string" do
      expr = DotDo::Rpc::RemapExpression(JSON::Any, JSON::Any).new("x => x * 2")
      expr.expression.should eq("x => x * 2")
    end

    it "creates expression with captures" do
      expr = DotDo::Rpc::RemapExpression(JSON::Any, JSON::Any).new("x => self.square(x)", ["$self"])
      expr.captures.should eq(["$self"])
    end
  end

  describe "RemapBuilder" do
    it "chains remap operations" do
      builder = DotDo::Rpc.from([1, 2, 3])
      builder
        .remap { |x| JSON::Any.new(x.as_i64 * 2) }
        .remap { |x| JSON::Any.new(x.as_i64 + 1) }

      builder.expressions.size.should eq(2)
    end

    it "builds remap config" do
      builder = DotDo::Rpc.from([1, 2, 3])
        .remap("x => x * 2")

      config = builder.build
      config.empty?.should be_false
    end
  end

  describe "Array remap" do
    it "creates remap result from array" do
      result = [1, 2, 3].remap { |x| x * 2 }
      result.should be_a(DotDo::Rpc::RemapResult(Int32))
    end

    it "chains remap on array" do
      result = [1, 2, 3]
        .remap { |x| x * 2 }
        .remap { |x| x + 1 }

      result.config.expressions.size.should eq(2)
    end
  end

  describe "helper functions" do
    it "creates expression from block" do
      expr = DotDo::Rpc.expression { |x : Int32| x * 2 }
      expr.execute(5).should eq(10)
    end

    it "creates expression from string" do
      expr = DotDo::Rpc.expression("x => x * 2")
      expr.expression.should eq("x => x * 2")
    end
  end
end
