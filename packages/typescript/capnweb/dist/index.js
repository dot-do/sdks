// src/index.ts
var RpcMessageType = /* @__PURE__ */ ((RpcMessageType2) => {
  RpcMessageType2[RpcMessageType2["Call"] = 0] = "Call";
  RpcMessageType2[RpcMessageType2["Return"] = 1] = "Return";
  RpcMessageType2[RpcMessageType2["Finish"] = 2] = "Finish";
  RpcMessageType2[RpcMessageType2["Resolve"] = 3] = "Resolve";
  RpcMessageType2[RpcMessageType2["Release"] = 4] = "Release";
  RpcMessageType2[RpcMessageType2["Disembargo"] = 5] = "Disembargo";
  RpcMessageType2[RpcMessageType2["Bootstrap"] = 6] = "Bootstrap";
  RpcMessageType2[RpcMessageType2["Abort"] = 7] = "Abort";
  return RpcMessageType2;
})(RpcMessageType || {});
var TransportState = /* @__PURE__ */ ((TransportState2) => {
  TransportState2["Connecting"] = "connecting";
  TransportState2["Connected"] = "connected";
  TransportState2["Disconnected"] = "disconnected";
  TransportState2["Failed"] = "failed";
  return TransportState2;
})(TransportState || {});
function encodeMessage(_message) {
  throw new Error("Not implemented: encodeMessage");
}
function decodeMessage(_data) {
  throw new Error("Not implemented: decodeMessage");
}
function createMessageBuilder() {
  return new MessageBuilder();
}
var MessageBuilder = class {
  segments = [];
  addSegment(data) {
    this.segments.push({ data, byteLength: data.byteLength });
    return this;
  }
  build() {
    const totalSize = this.segments.reduce((sum, seg) => sum + seg.byteLength, 0);
    return {
      segments: Object.freeze([...this.segments]),
      totalSize
    };
  }
  clear() {
    this.segments = [];
    return this;
  }
};
var ErrorCode = {
  /** Connection-related errors (network, transport) */
  CONNECTION_ERROR: 1001,
  /** RPC method call failures */
  RPC_ERROR: 2001,
  /** Request timeout exceeded */
  TIMEOUT_ERROR: 3001,
  /** Capability resolution or access errors */
  CAPABILITY_ERROR: 4001,
  /** Serialization/deserialization errors */
  SERIALIZATION_ERROR: 5001
};
var ErrorCodeName = {
  [ErrorCode.CONNECTION_ERROR]: "CONNECTION_ERROR",
  [ErrorCode.RPC_ERROR]: "RPC_ERROR",
  [ErrorCode.TIMEOUT_ERROR]: "TIMEOUT_ERROR",
  [ErrorCode.CAPABILITY_ERROR]: "CAPABILITY_ERROR",
  [ErrorCode.SERIALIZATION_ERROR]: "SERIALIZATION_ERROR"
};
var CapnwebError = class extends Error {
  /**
   * Creates a new CapnwebError.
   * @param message - Human-readable error message
   * @param code - Numeric error code (e.g., 1001, 2001)
   * @param codeName - String name of the error code (e.g., 'CONNECTION_ERROR')
   */
  constructor(message, code, codeName) {
    super(message);
    this.code = code;
    this.codeName = codeName;
    this.name = "CapnwebError";
  }
  /**
   * Returns a JSON representation of the error.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      codeName: this.codeName
    };
  }
};
var ConnectionError = class extends CapnwebError {
  /**
   * Creates a new ConnectionError.
   * @param message - Description of the connection failure
   */
  constructor(message) {
    super(message, ErrorCode.CONNECTION_ERROR, "CONNECTION_ERROR");
    this.name = "ConnectionError";
  }
};
var RpcError = class extends CapnwebError {
  /**
   * Creates a new RpcError.
   * @param message - Description of the RPC failure
   * @param methodId - Optional method ID that failed (for debugging)
   */
  constructor(message, methodId) {
    super(message, ErrorCode.RPC_ERROR, "RPC_ERROR");
    this.methodId = methodId;
    this.name = "RpcError";
  }
};
var TimeoutError = class extends CapnwebError {
  /**
   * Creates a new TimeoutError.
   * @param message - Description of what timed out (default: 'Request timed out')
   * @param timeoutMs - The timeout duration in milliseconds
   */
  constructor(message = "Request timed out", timeoutMs) {
    super(message, ErrorCode.TIMEOUT_ERROR, "TIMEOUT_ERROR");
    this.timeoutMs = timeoutMs;
    this.name = "TimeoutError";
  }
};
var CapabilityError = class extends CapnwebError {
  /**
   * Creates a new CapabilityError.
   * @param message - Description of the capability error
   * @param capabilityId - Optional ID of the capability that caused the error
   */
  constructor(message, capabilityId) {
    super(message, ErrorCode.CAPABILITY_ERROR, "CAPABILITY_ERROR");
    this.capabilityId = capabilityId;
    this.name = "CapabilityError";
  }
};
var SerializationError = class extends CapnwebError {
  /**
   * Creates a new SerializationError.
   * @param message - Description of the serialization failure
   * @param isDeserialize - Whether this was a deserialization (vs serialization) error
   */
  constructor(message, isDeserialize = false) {
    super(message, ErrorCode.SERIALIZATION_ERROR, "SERIALIZATION_ERROR");
    this.isDeserialize = isDeserialize;
    this.name = "SerializationError";
  }
};
function isErrorCode(error, code) {
  return error instanceof CapnwebError && error.code === code;
}
function createError(code, message) {
  switch (code) {
    case ErrorCode.CONNECTION_ERROR:
      return new ConnectionError(message);
    case ErrorCode.RPC_ERROR:
      return new RpcError(message);
    case ErrorCode.TIMEOUT_ERROR:
      return new TimeoutError(message);
    case ErrorCode.CAPABILITY_ERROR:
      return new CapabilityError(message);
    case ErrorCode.SERIALIZATION_ERROR:
      return new SerializationError(message);
    default:
      return new CapnwebError(message, code, ErrorCodeName[code] || "UNKNOWN_ERROR");
  }
}
function wrapError(error, defaultCode = ErrorCode.RPC_ERROR) {
  if (error instanceof CapnwebError) {
    return error;
  }
  if (error instanceof Error) {
    return createError(defaultCode, error.message);
  }
  return createError(defaultCode, String(error));
}

export { CapabilityError, CapnwebError, ConnectionError, ErrorCode, ErrorCodeName, MessageBuilder, RpcError, RpcMessageType, SerializationError, TimeoutError, TransportState, createError, createMessageBuilder, decodeMessage, encodeMessage, isErrorCode, wrapError };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map