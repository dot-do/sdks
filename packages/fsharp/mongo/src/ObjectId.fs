namespace DotDo.Mongo

open System
open System.Security.Cryptography
open System.Text

/// MongoDB ObjectId - a 12-byte unique identifier.
/// Format: 4-byte timestamp + 5-byte random + 3-byte counter
[<Struct>]
type ObjectId =
    private { Bytes: byte array }

    /// Creates an ObjectId from a 24-character hex string.
    static member Parse(hex: string) : Result<ObjectId, string> =
        if String.IsNullOrEmpty(hex) then
            Error "ObjectId cannot be empty"
        elif hex.Length <> 24 then
            Error $"ObjectId must be 24 hex characters, got {hex.Length}"
        else
            try
                let bytes = Convert.FromHexString(hex)
                Ok { Bytes = bytes }
            with
            | :? FormatException -> Error $"Invalid hex string: {hex}"

    /// Creates an ObjectId from raw bytes.
    static member FromBytes(bytes: byte array) : Result<ObjectId, string> =
        if bytes.Length <> 12 then
            Error $"ObjectId must be 12 bytes, got {bytes.Length}"
        else
            Ok { Bytes = bytes }

    /// Generates a new unique ObjectId.
    static member Generate() : ObjectId =
        let bytes = Array.zeroCreate<byte> 12

        // 4-byte timestamp (seconds since epoch)
        let timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() |> int
        bytes.[0] <- byte (timestamp >>> 24)
        bytes.[1] <- byte (timestamp >>> 16)
        bytes.[2] <- byte (timestamp >>> 8)
        bytes.[3] <- byte timestamp

        // 5-byte random value
        let random = RandomNumberGenerator.GetBytes(5)
        Array.blit random 0 bytes 4 5

        // 3-byte counter
        let counter = Random.Shared.Next(0, 0xFFFFFF)
        bytes.[9] <- byte (counter >>> 16)
        bytes.[10] <- byte (counter >>> 8)
        bytes.[11] <- byte counter

        { Bytes = bytes }

    /// Creates an empty ObjectId (all zeros).
    static member Empty : ObjectId = { Bytes = Array.zeroCreate 12 }

    /// Returns the hex string representation.
    member this.ToHexString() : string =
        Convert.ToHexString(this.Bytes).ToLowerInvariant()

    /// Returns the raw bytes.
    member this.ToBytes() : byte array = Array.copy this.Bytes

    /// Gets the timestamp component as DateTimeOffset.
    member this.Timestamp : DateTimeOffset =
        let timestamp =
            (int this.Bytes.[0] <<< 24)
            ||| (int this.Bytes.[1] <<< 16)
            ||| (int this.Bytes.[2] <<< 8)
            ||| (int this.Bytes.[3])
        DateTimeOffset.FromUnixTimeSeconds(int64 timestamp)

    /// Checks if this is the empty ObjectId.
    member this.IsEmpty : bool =
        this.Bytes |> Array.forall ((=) 0uy)

    override this.ToString() = this.ToHexString()

    override this.Equals(obj) =
        match obj with
        | :? ObjectId as other ->
            this.Bytes.Length = other.Bytes.Length
            && Array.forall2 (=) this.Bytes other.Bytes
        | _ -> false

    override this.GetHashCode() =
        // Use first 4 bytes (timestamp) for quick hash
        if this.Bytes.Length >= 4 then
            (int this.Bytes.[0] <<< 24)
            ||| (int this.Bytes.[1] <<< 16)
            ||| (int this.Bytes.[2] <<< 8)
            ||| (int this.Bytes.[3])
        else
            0

    interface IComparable with
        member this.CompareTo(obj) =
            match obj with
            | :? ObjectId as other ->
                let rec compareBytes i =
                    if i >= 12 then 0
                    else
                        let cmp = compare this.Bytes.[i] other.Bytes.[i]
                        if cmp <> 0 then cmp else compareBytes (i + 1)
                compareBytes 0
            | _ -> invalidArg "obj" "Cannot compare ObjectId to non-ObjectId"

/// ObjectId module for functional-style operations.
module ObjectId =
    /// Generates a new unique ObjectId.
    let generate () = ObjectId.Generate()

    /// Parses a hex string into an ObjectId.
    let parse (hex: string) = ObjectId.Parse(hex)

    /// Tries to parse a hex string, returning None on failure.
    let tryParse (hex: string) =
        match ObjectId.Parse(hex) with
        | Ok id -> Some id
        | Error _ -> None

    /// Creates an ObjectId from bytes.
    let fromBytes (bytes: byte array) = ObjectId.FromBytes(bytes)

    /// Gets the hex string representation.
    let toHexString (id: ObjectId) = id.ToHexString()

    /// Gets the raw bytes.
    let toBytes (id: ObjectId) = id.ToBytes()

    /// Gets the timestamp from an ObjectId.
    let timestamp (id: ObjectId) = id.Timestamp

    /// The empty ObjectId.
    let empty = ObjectId.Empty

    /// Checks if an ObjectId is empty.
    let isEmpty (id: ObjectId) = id.IsEmpty
