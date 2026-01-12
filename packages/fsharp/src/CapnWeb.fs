namespace CapnWeb

open System
open System.Collections.Generic
open System.Net.Http
open System.Text.Json
open System.Threading.Tasks

// =============================================================================
// Railway-Oriented Error Handling
// =============================================================================

/// RPC-specific errors using discriminated union
type RpcError =
    | ConnectionFailed of reason: string
    | Timeout of operation: string * elapsed: TimeSpan
    | NotFound of entity: string * id: string
    | Unauthorized of reason: string
    | ValidationFailed of field: string * message: string
    | ServerError of message: string * stackTrace: string option
    | Cancelled
    | UnexpectedResponse of message: string

/// Result type alias for RPC operations
type RpcResult<'T> = Result<'T, RpcError>

/// Async result for railway-oriented programming
type AsyncResult<'T, 'E> = Async<Result<'T, 'E>>

// =============================================================================
// Active Patterns for Error Matching
// =============================================================================

module ErrorPatterns =
    /// Active pattern for categorizing errors
    let (|AuthError|NotFoundError|ServerErrorPattern|OtherError|) (error: RpcError) =
        match error with
        | Unauthorized _ -> AuthError error
        | NotFound _ -> NotFoundError error
        | ServerError _ -> ServerErrorPattern error
        | _ -> OtherError error

    /// Active pattern for transient (retryable) errors
    let (|Transient|Permanent|) (error: RpcError) =
        match error with
        | Timeout _ -> Transient
        | ConnectionFailed _ -> Transient
        | _ -> Permanent

// =============================================================================
// Core Types
// =============================================================================

/// Represents a value in the RPC system (JSON-like)
type RpcValue =
    | Null
    | Bool of bool
    | Number of float
    | String of string
    | Array of RpcValue list
    | Object of Map<string, RpcValue>
    | Capability of capId: string

/// Represents an RPC promise that supports pipelining
type RpcPromise<'T> = {
    Value: Async<RpcResult<'T>>
    Transform: RpcValue -> 'T
}

/// Represents a stub for calling remote methods
type RpcStub = {
    BaseUrl: string
    Client: HttpClient
    CapabilityId: string option
}

// =============================================================================
// RpcValue Helpers
// =============================================================================

module RpcValue =
    let fromJsonElement (elem: JsonElement) : RpcValue =
        match elem.ValueKind with
        | JsonValueKind.Null -> Null
        | JsonValueKind.True -> Bool true
        | JsonValueKind.False -> Bool false
        | JsonValueKind.Number -> Number (elem.GetDouble())
        | JsonValueKind.String -> String (elem.GetString())
        | JsonValueKind.Array ->
            elem.EnumerateArray()
            |> Seq.map fromJsonElement
            |> Seq.toList
            |> Array
        | JsonValueKind.Object ->
            elem.EnumerateObject()
            |> Seq.map (fun prop -> prop.Name, fromJsonElement prop.Value)
            |> Map.ofSeq
            |> Object
        | _ -> Null

    let rec toObj (value: RpcValue) : obj =
        match value with
        | Null -> null
        | Bool b -> box b
        | Number n ->
            // Return int if it's a whole number
            if n = Math.Floor(n) && n >= float Int32.MinValue && n <= float Int32.MaxValue then
                box (int n)
            else
                box n
        | String s -> box s
        | Array items -> items |> List.map toObj |> box
        | Object props -> props |> Map.map (fun _ v -> toObj v) |> box
        | Capability capId -> box capId

    let rec fromObj (obj: obj) : RpcValue =
        match obj with
        | null -> Null
        | :? bool as b -> Bool b
        | :? int as i -> Number (float i)
        | :? int64 as i -> Number (float i)
        | :? float as f -> Number f
        | :? decimal as d -> Number (float d)
        | :? string as s -> String s
        | :? (obj list) as lst -> lst |> List.map fromObj |> Array
        | :? (obj seq) as seq -> seq |> Seq.map fromObj |> Seq.toList |> Array
        | :? System.Collections.IEnumerable as enumerable ->
            enumerable
            |> Seq.cast<obj>
            |> Seq.map fromObj
            |> Seq.toList
            |> Array
        | _ -> String (obj.ToString())

// =============================================================================
// HTTP Transport (Stub Implementation)
// =============================================================================

module Transport =
    let private jsonOptions = JsonSerializerOptions(PropertyNamingPolicy = JsonNamingPolicy.CamelCase)

    /// Make an RPC call to the server
    let call (stub: RpcStub) (methodName: string) (args: obj list) : Async<RpcResult<RpcValue>> =
        async {
            try
                let requestBody =
                    {| method' = methodName; args = args |}
                    |> fun x -> JsonSerializer.Serialize(x, jsonOptions)

                let url =
                    match stub.CapabilityId with
                    | Some capId -> $"{stub.BaseUrl}/rpc/{capId}/{methodName}"
                    | None -> $"{stub.BaseUrl}/rpc/{methodName}"

                use content = new StringContent(requestBody, System.Text.Encoding.UTF8, "application/json")
                let! response = stub.Client.PostAsync(url, content) |> Async.AwaitTask

                if response.IsSuccessStatusCode then
                    let! responseBody = response.Content.ReadAsStringAsync() |> Async.AwaitTask
                    let doc = JsonDocument.Parse(responseBody)

                    if doc.RootElement.TryGetProperty("error", &Unchecked.defaultof<JsonElement>) then
                        let errorElem = doc.RootElement.GetProperty("error")
                        let errorMsg = errorElem.GetString()
                        return Error (ServerError (errorMsg, None))
                    else
                        let result = doc.RootElement.GetProperty("result")
                        return Ok (RpcValue.fromJsonElement result)
                else
                    let! errorBody = response.Content.ReadAsStringAsync() |> Async.AwaitTask
                    return Error (ServerError ($"HTTP {int response.StatusCode}: {errorBody}", None))
            with
            | :? TaskCanceledException ->
                return Error (Timeout (methodName, TimeSpan.Zero))
            | :? HttpRequestException as ex ->
                return Error (ConnectionFailed ex.Message)
            | ex ->
                return Error (ServerError (ex.Message, Some (ex.StackTrace)))
        }

// =============================================================================
// RpcPipeline Computation Expression Builder
// =============================================================================

/// Builder for the rpc { } computation expression
type RpcPipelineBuilder() =
    member _.Bind(promise: RpcPromise<'T>, f: 'T -> RpcPromise<'U>) : RpcPromise<'U> =
        {
            Value = async {
                match! promise.Value with
                | Ok value ->
                    let next = f value
                    return! next.Value
                | Error e ->
                    return Error e
            }
            Transform = id
        }

    member _.Return(x: 'T) : RpcPromise<'T> =
        {
            Value = async { return Ok x }
            Transform = fun _ -> x
        }

    member _.ReturnFrom(promise: RpcPromise<'T>) : RpcPromise<'T> = promise

    member _.Zero() : RpcPromise<unit> =
        {
            Value = async { return Ok () }
            Transform = fun _ -> ()
        }

    member _.Combine(p1: RpcPromise<unit>, p2: RpcPromise<'T>) : RpcPromise<'T> =
        {
            Value = async {
                match! p1.Value with
                | Ok () -> return! p2.Value
                | Error e -> return Error e
            }
            Transform = p2.Transform
        }

    member _.Delay(f: unit -> RpcPromise<'T>) : RpcPromise<'T> = f ()

    /// Parallel execution with and!
    member _.MergeSources(p1: RpcPromise<'T>, p2: RpcPromise<'U>) : RpcPromise<'T * 'U> =
        {
            Value = async {
                let! r1 = p1.Value |> Async.StartChild
                let! r2 = p2.Value |> Async.StartChild
                let! result1 = r1
                let! result2 = r2
                match result1, result2 with
                | Ok v1, Ok v2 -> return Ok (v1, v2)
                | Error e, _ -> return Error e
                | _, Error e -> return Error e
            }
            Transform = fun _ -> Unchecked.defaultof<'T * 'U>
        }

/// The rpc { } computation expression
let rpc = RpcPipelineBuilder()

// =============================================================================
// Rpc Module - Core Operations
// =============================================================================

module Rpc =
    /// Execute a pipeline and get the result
    let execute (promise: RpcPromise<'T>) : Async<'T> =
        async {
            match! promise.Value with
            | Ok value -> return value
            | Error e -> return raise (Exception($"RPC Error: {e}"))
        }

    /// Execute a pipeline and get a Result
    let tryExecute (promise: RpcPromise<'T>) : Async<RpcResult<'T>> =
        promise.Value

    /// Create a promise from an async RPC result
    let fromAsync (computation: Async<RpcResult<'T>>) : RpcPromise<'T> =
        { Value = computation; Transform = id }

    /// Create a promise from a value
    let returnValue (value: 'T) : RpcPromise<'T> =
        { Value = async { return Ok value }; Transform = fun _ -> value }

    /// Map over a promise (local transformation)
    let map (f: 'T -> 'U) (promise: RpcPromise<'T>) : RpcPromise<'U> =
        {
            Value = async {
                match! promise.Value with
                | Ok v -> return Ok (f v)
                | Error e -> return Error e
            }
            Transform = fun v -> f (promise.Transform v)
        }

    /// Server-side map operation (the key remap feature)
    /// This sends the map expression to the server for execution
    let serverMap (f: 'T -> RpcPromise<'U>) (promise: RpcPromise<'T list>) : RpcPromise<'U list> =
        {
            Value = async {
                match! promise.Value with
                | Ok items ->
                    // In a real implementation, this would send the map to the server
                    // For the stub, we execute locally but simulate the single round-trip
                    let! results =
                        items
                        |> List.map (fun item ->
                            async {
                                let mapped = f item
                                return! mapped.Value
                            })
                        |> Async.Parallel
                    let collected =
                        results
                        |> Array.toList
                        |> List.choose (function Ok v -> Some v | Error _ -> None)
                    if List.length collected = List.length items then
                        return Ok collected
                    else
                        return Error (ServerError ("Map operation failed for some elements", None))
                | Error e ->
                    return Error e
            }
            Transform = fun _ -> []
        }

    /// Server-side map for single values (auto-wraps non-arrays)
    let serverMapSingle (f: 'T -> RpcPromise<'U>) (promise: RpcPromise<'T>) : RpcPromise<'U> =
        {
            Value = async {
                match! promise.Value with
                | Ok item ->
                    let mapped = f item
                    return! mapped.Value
                | Error e ->
                    return Error e
            }
            Transform = fun _ -> Unchecked.defaultof<'U>
        }

    /// Server-side map that handles null/arrays uniformly
    let serverMapValue (stub: RpcStub) (mapExpr: string) (promise: RpcPromise<RpcValue>) : RpcPromise<RpcValue> =
        {
            Value = async {
                match! promise.Value with
                | Null ->
                    return Ok Null
                | Array items ->
                    // In real implementation, send map to server
                    // For stub, we simulate by calling the method for each item
                    return Ok (Array items)  // Placeholder
                | value ->
                    // Single value - apply transform
                    return Ok value  // Placeholder
                | Error e ->
                    return Error e
            }
            Transform = id
        }

    /// Call a method on a stub
    let call (stub: RpcStub) (methodName: string) (args: obj list) : RpcPromise<RpcValue> =
        {
            Value = Transport.call stub methodName args
            Transform = id
        }

    /// Create a stub from a URL
    let connect (url: string) : RpcStub =
        {
            BaseUrl = url
            Client = new HttpClient()
            CapabilityId = None
        }

// =============================================================================
// AsyncResult Module - Railway-Oriented Helpers
// =============================================================================

module AsyncResult =
    /// Map over the success value
    let map (f: 'T -> 'U) (ar: AsyncResult<'T, 'E>) : AsyncResult<'U, 'E> =
        async {
            match! ar with
            | Ok v -> return Ok (f v)
            | Error e -> return Error e
        }

    /// Bind for railway composition
    let bind (f: 'T -> AsyncResult<'U, 'E>) (ar: AsyncResult<'T, 'E>) : AsyncResult<'U, 'E> =
        async {
            match! ar with
            | Ok v -> return! f v
            | Error e -> return Error e
        }

    /// Map over the error
    let mapError (f: 'E -> 'F) (ar: AsyncResult<'T, 'E>) : AsyncResult<'T, 'F> =
        async {
            match! ar with
            | Ok v -> return Ok v
            | Error e -> return Error (f e)
        }

    /// Provide a fallback on error
    let orElse (fallback: 'E -> AsyncResult<'T, 'E>) (ar: AsyncResult<'T, 'E>) : AsyncResult<'T, 'E> =
        async {
            match! ar with
            | Ok v -> return Ok v
            | Error e -> return! fallback e
        }

    /// Kleisli composition operator
    let (>=>) (f: 'A -> AsyncResult<'B, 'E>) (g: 'B -> AsyncResult<'C, 'E>) : 'A -> AsyncResult<'C, 'E> =
        fun a -> bind g (f a)

// =============================================================================
// AsyncResult Computation Expression Builder
// =============================================================================

type AsyncResultBuilder() =
    member _.Return(x) = async { return Ok x }
    member _.ReturnFrom(x: AsyncResult<_, _>) = x
    member _.Bind(m: AsyncResult<'T, 'E>, f: 'T -> AsyncResult<'U, 'E>) = AsyncResult.bind f m
    member _.Zero() = async { return Ok () }
    member _.Combine(m1, m2) = AsyncResult.bind (fun () -> m2) m1
    member _.Delay(f) = async.Delay(f)

let asyncResult = AsyncResultBuilder()

// =============================================================================
// Dynamic Operator Support (? operator)
// =============================================================================

/// Extension for dynamic member access on RpcStub
type RpcStub with
    /// Dynamic method call: stub?methodName(args)
    static member (?) (stub: RpcStub, name: string) : obj list -> RpcPromise<RpcValue> =
        fun args -> Rpc.call stub name args

// =============================================================================
// CapnWeb Module - Connection Management
// =============================================================================

module CapnWeb =
    /// Connect to a Cap'n Web server
    let connect (url: string) : Async<RpcStub> =
        async {
            return Rpc.connect url
        }

    /// Connect and return the stub synchronously
    let connectSync (url: string) : RpcStub =
        Rpc.connect url
