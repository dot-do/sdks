namespace {{Name}}.Do

/// Errors that can occur when using {{Name}}Client
type {{Name}}Error =
    /// The client is not connected
    | NotConnected
    /// Authentication failed
    | AuthenticationFailed of reason: string
    /// Resource not found
    | NotFound of entity: string * id: string
    /// Connection failed
    | ConnectionFailed of reason: string
    /// General RPC error
    | RpcError of code: string option * message: string

module {{Name}}Error =
    /// Convert error to human-readable message
    let message = function
        | NotConnected ->
            "{{Name}}Client is not connected. Call connectAsync() first."
        | AuthenticationFailed reason ->
            sprintf "Authentication failed: %s" reason
        | NotFound (entity, id) ->
            sprintf "%s not found: %s" entity id
        | ConnectionFailed reason ->
            sprintf "Connection failed: %s" reason
        | RpcError (Some code, msg) ->
            sprintf "RPC error [%s]: %s" code msg
        | RpcError (None, msg) ->
            sprintf "RPC error: %s" msg

/// Exception wrapper for {{Name}}Error
exception {{Name}}Exception of {{Name}}Error

module {{Name}}Exception =
    /// Raise a {{Name}}Error as an exception
    let raise error = raise ({{Name}}Exception error)
