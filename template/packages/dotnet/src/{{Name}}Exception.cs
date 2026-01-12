namespace {{Name}}.Do;

/// <summary>
/// Base exception for {{Name}}.do errors
/// </summary>
public class {{Name}}Exception : Exception
{
    /// <summary>
    /// Error code if provided
    /// </summary>
    public string? Code { get; }

    public {{Name}}Exception(string message, string? code = null, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public override string ToString()
    {
        return Code != null
            ? $"{{Name}}Exception [{Code}]: {Message}"
            : $"{{Name}}Exception: {Message}";
    }
}

/// <summary>
/// Exception thrown when authentication fails
/// </summary>
public class {{Name}}AuthException : {{Name}}Exception
{
    public {{Name}}AuthException(string message, string? code = null, Exception? innerException = null)
        : base(message, code, innerException)
    {
    }
}

/// <summary>
/// Exception thrown when a resource is not found
/// </summary>
public class {{Name}}NotFoundException : {{Name}}Exception
{
    public {{Name}}NotFoundException(string message, string? code = null, Exception? innerException = null)
        : base(message, code, innerException)
    {
    }
}

/// <summary>
/// Exception thrown when the connection fails
/// </summary>
public class {{Name}}ConnectionException : {{Name}}Exception
{
    public {{Name}}ConnectionException(string message, string? code = null, Exception? innerException = null)
        : base(message, code, innerException)
    {
    }
}
