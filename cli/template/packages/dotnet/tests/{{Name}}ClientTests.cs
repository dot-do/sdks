using Xunit;
using {{Name}}.Do;

namespace {{Name}}.Do.Tests;

public class {{Name}}ClientTests
{
    [Fact]
    public void CreatesWithDefaultOptions()
    {
        var client = new {{Name}}Client();
        Assert.False(client.IsConnected);
    }

    [Fact]
    public void CreatesWithApiKey()
    {
        var client = new {{Name}}Client("test-key");
        Assert.False(client.IsConnected);
    }

    [Fact]
    public void CreatesWithOptions()
    {
        var client = new {{Name}}Client(new {{Name}}ClientOptions
        {
            ApiKey = "test-key",
            BaseUrl = "https://test.{{name}}.do"
        });
        Assert.False(client.IsConnected);
    }

    [Fact]
    public void ThrowsWhenAccessingRpcBeforeConnect()
    {
        var client = new {{Name}}Client();
        Assert.Throws<InvalidOperationException>(() => client.Rpc);
    }
}

public class {{Name}}ExceptionTests
{
    [Fact]
    public void FormatsWithoutCode()
    {
        var ex = new {{Name}}Exception("Test error");
        Assert.Equal("{{Name}}Exception: Test error", ex.ToString());
    }

    [Fact]
    public void FormatsWithCode()
    {
        var ex = new {{Name}}Exception("Test error", code: "ERR001");
        Assert.Equal("{{Name}}Exception [ERR001]: Test error", ex.ToString());
    }
}
