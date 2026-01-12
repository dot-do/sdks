package do_.{{name}};

/**
 * Exception thrown by {{Name}} operations.
 */
public class {{Name}}Exception extends Exception {
    /**
     * Create a new exception with a message.
     *
     * @param message the error message
     */
    public {{Name}}Exception(String message) {
        super(message);
    }

    /**
     * Create a new exception with a message and cause.
     *
     * @param message the error message
     * @param cause the underlying cause
     */
    public {{Name}}Exception(String message, Throwable cause) {
        super(message, cause);
    }
}
