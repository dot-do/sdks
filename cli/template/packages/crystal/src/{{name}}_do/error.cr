module {{Name}}Do
  # Exception raised by {{Name}} client operations
  class {{Name}}Error < Exception
    property code : String?
    property details : JSON::Any?

    def initialize(message : String, @code = nil, @details = nil)
      super(message)
    end

    # Create from RPC error response
    def self.from_rpc_error(error : Hash(String, JSON::Any))
      new(
        message: error["message"]?.try(&.as_s) || "Unknown error",
        code: error["code"]?.try(&.as_s),
        details: error["details"]?
      )
    end

    def to_s(io : IO) : Nil
      io << "{{Name}}Error"
      if c = @code
        io << " [" << c << "]"
      end
      io << ": " << message
    end
  end

  # Raised when connection fails
  class ConnectionError < {{Name}}Error
  end

  # Raised when authentication fails
  class AuthenticationError < {{Name}}Error
  end
end
