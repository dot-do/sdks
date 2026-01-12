/**
 * RPC Protocol Types
 *
 * These types define the wire protocol for RPC communication.
 * They are used by both the client and any server implementation.
 */

/**
 * Pipeline operation for sequential execution
 */
export interface PipelineOp {
  type: 'call' | 'get';
  method?: string;
  args?: unknown[];
  property?: string;
}

/**
 * RPC request message
 */
export interface RpcRequest {
  id: number;
  method: string;
  target?: number; // Capability ID, 0 = bootstrap
  args: unknown[];
  pipeline?: PipelineOp[];
}

/**
 * RPC response message
 */
export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { type: string; message: string };
  capabilityId?: number; // If result is a capability
}

/**
 * RPC map request for server-side transformations
 */
export interface RpcMapRequest {
  id: number;
  target: number; // Capability ID that returns array/value
  expression: string;
  captures: Record<string, number>; // Variable name -> capability ID
}

/**
 * Extended request for pipelined calls
 */
export interface PipelinedRequest {
  id: number;
  steps: Array<{
    method: string;
    target?: number | string; // Capability ID or reference to previous step result
    args: unknown[];
    as?: string;
  }>;
}

/**
 * Interface for mock server implementations used in testing.
 *
 * This interface defines the minimal contract that a mock server
 * must implement to work with RpcClient in test mode.
 */
export interface MockServerInterface {
  /** Process a batch of requests (single round trip) */
  processBatch(requests: RpcRequest[]): RpcResponse[];

  /** Process a pipelined request (single round trip for entire pipeline) */
  processPipeline(request: PipelinedRequest): Record<string, RpcResponse>;

  /** Process a map request */
  processMapRequest(request: RpcMapRequest): RpcResponse;

  /** Register a capability and return its ID */
  registerCapability(cap: unknown): number;

  /** Get a capability by ID */
  getCapability(id: number): unknown;

  /** Process a call and map in a single round trip */
  processCallAndMap(
    request: RpcRequest,
    expression: string,
    captures: Record<string, number>
  ): RpcResponse;
}
