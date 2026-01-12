/**
 * @dotdo/rpc - Type-safe RPC client with proxy-based API
 */

import type {
  Connection,
  ConnectionOptions,
  Transport,
  TransportState,
  RpcMessage,
  CapabilityRef,
} from '@dotdo/capnweb';

// ============================================================================
// Recording Types
// ============================================================================

/**
 * Recorded RPC call for replay
 */
export interface RecordedCall {
  readonly timestamp: number;
  readonly target: string;
  readonly method: string;
  readonly args: unknown[];
  readonly result?: unknown;
  readonly error?: string;
  readonly duration: number;
}

/**
 * Recording session
 */
export interface Recording {
  readonly id: string;
  readonly startTime: number;
  readonly calls: readonly RecordedCall[];
}

/**
 * Options for the map/record functionality
 */
export interface MapOptions {
  /** Enable recording of all calls */
  record?: boolean;
  /** Replay from a previous recording */
  replay?: Recording;
  /** Transform function applied to all calls */
  transform?: <T>(call: RecordedCall, result: T) => T;
  /** Filter which methods to intercept */
  filter?: (target: string, method: string) => boolean;
}

// ============================================================================
// RPC Proxy Types
// ============================================================================

/**
 * Method call handler type
 */
export type MethodHandler = (...args: unknown[]) => Promise<unknown>;

/**
 * Proxy target that tracks capability path
 */
interface ProxyTarget {
  readonly path: string[];
  readonly connection: RpcConnection;
}

/**
 * The $ symbol type - represents a remote capability proxy
 * Use this to type your service interfaces
 */
export type $ = {
  readonly [key: string]: $ | MethodHandler;
};

/**
 * RpcProxy - A proxy object that enables chained property access for RPC calls
 *
 * @example
 * ```ts
 * const client = connect('https://api.example.do');
 * const result = await client.users.get({ id: 123 });
 * ```
 */
export type RpcProxy<T = $> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends object
    ? RpcProxy<T[K]>
    : T[K];
} & {
  /**
   * Map/transform calls through this proxy
   * Enables recording, replay, and transformation of RPC calls
   */
  map(options: MapOptions): RpcProxy<T>;
};

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Options for establishing an RPC connection
 */
export interface RpcConnectionOptions extends ConnectionOptions {
  /** Custom headers for authentication */
  headers?: Record<string, string>;
  /** API key for authentication */
  apiKey?: string;
  /** Enable call recording by default */
  recordCalls?: boolean;
}

/**
 * Internal RPC connection implementation
 */
class RpcConnection implements Connection {
  private _state: TransportState = 'connecting' as TransportState;
  private _recording: RecordedCall[] = [];
  private _recordingEnabled = false;
  private _replayData?: Recording;
  private _replayIndex = 0;

  readonly stats = {
    messagesIn: 0,
    messagesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    latencyMs: 0,
    uptime: 0,
  };

  constructor(
    readonly url: string,
    private readonly options: RpcConnectionOptions = { url: '' }
  ) {
    this._recordingEnabled = options.recordCalls ?? false;
    // Simulate connection
    setTimeout(() => {
      this._state = 'connected' as TransportState;
    }, 0);
  }

  get state(): TransportState {
    return this._state;
  }

  async bootstrap<T>(): Promise<T> {
    // Stub: would request bootstrap capability from server
    return this.createProxy<T>([]);
  }

  async close(_reason?: string): Promise<void> {
    this._state = 'disconnected' as TransportState;
  }

  /**
   * Enable recording of calls
   */
  startRecording(): void {
    this._recording = [];
    this._recordingEnabled = true;
  }

  /**
   * Stop recording and return the recording
   */
  stopRecording(): Recording {
    this._recordingEnabled = false;
    return {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      calls: Object.freeze([...this._recording]),
    };
  }

  /**
   * Set replay data for subsequent calls
   */
  setReplay(recording: Recording): void {
    this._replayData = recording;
    this._replayIndex = 0;
  }

  /**
   * Clear replay data
   */
  clearReplay(): void {
    this._replayData = undefined;
    this._replayIndex = 0;
  }

  /**
   * Create a proxy for the given capability path
   */
  createProxy<T>(path: string[], mapOptions?: MapOptions): T {
    const target: ProxyTarget = { path, connection: this };
    return this.buildProxy(target, mapOptions) as T;
  }

  private buildProxy(target: ProxyTarget, mapOptions?: MapOptions): unknown {
    const self = this;

    return new Proxy(function () {} as unknown as object, {
      get(_obj, prop: string | symbol): unknown {
        if (typeof prop === 'symbol') {
          return undefined;
        }

        // Special .map() method
        if (prop === 'map') {
          return (options: MapOptions) => {
            return self.createProxy(target.path, { ...mapOptions, ...options });
          };
        }

        // Build new path
        const newPath = [...target.path, prop];
        return self.buildProxy({ path: newPath, connection: self }, mapOptions);
      },

      apply(_obj, _thisArg, args: unknown[]): Promise<unknown> {
        const methodPath = target.path.join('.');
        const methodName = target.path[target.path.length - 1] || 'call';

        return self.invokeMethod(methodPath, methodName, args, mapOptions);
      },
    });
  }

  private async invokeMethod(
    target: string,
    method: string,
    args: unknown[],
    mapOptions?: MapOptions
  ): Promise<unknown> {
    const startTime = Date.now();

    // Check if we should filter this call
    if (mapOptions?.filter && !mapOptions.filter(target, method)) {
      return this.doRemoteCall(target, method, args);
    }

    // Check for replay mode
    if (mapOptions?.replay || this._replayData) {
      const recording = mapOptions?.replay || this._replayData;
      if (recording && this._replayIndex < recording.calls.length) {
        const recorded = recording.calls[this._replayIndex++];
        if (recorded.error) {
          throw new Error(recorded.error);
        }
        let result = recorded.result;
        if (mapOptions?.transform) {
          result = mapOptions.transform(recorded, result);
        }
        return result;
      }
    }

    // Make the actual call
    let result: unknown;
    let error: string | undefined;

    try {
      result = await this.doRemoteCall(target, method, args);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      const duration = Date.now() - startTime;

      // Record the call if recording is enabled
      if (this._recordingEnabled || mapOptions?.record) {
        const recorded: RecordedCall = {
          timestamp: startTime,
          target,
          method,
          args,
          result,
          error,
          duration,
        };
        this._recording.push(recorded);
      }
    }

    // Apply transform if specified
    if (mapOptions?.transform && result !== undefined) {
      const recorded: RecordedCall = {
        timestamp: startTime,
        target,
        method,
        args,
        result,
        duration: Date.now() - startTime,
      };
      result = mapOptions.transform(recorded, result);
    }

    return result;
  }

  private async doRemoteCall(
    _target: string,
    _method: string,
    _args: unknown[]
  ): Promise<unknown> {
    // Stub implementation - would serialize and send RPC message
    // In real implementation:
    // 1. Serialize args to Cap'n Proto message
    // 2. Send Call message via transport
    // 3. Wait for Return message
    // 4. Deserialize and return result

    this.stats.messagesOut++;

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1));

    this.stats.messagesIn++;

    // Stub: return undefined for now
    return undefined;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Connect to an RPC endpoint and return a typed proxy
 *
 * @param url - The endpoint URL (https:// or webtransport://)
 * @param options - Connection options
 * @returns A proxy object for making RPC calls
 *
 * @example
 * ```ts
 * // Basic connection
 * const api = connect('https://api.example.do');
 * const user = await api.users.get({ id: 123 });
 *
 * // With type safety
 * interface MyApi {
 *   users: {
 *     get(params: { id: number }): Promise<User>;
 *     list(): Promise<User[]>;
 *   };
 * }
 * const api = connect<MyApi>('https://api.example.do');
 *
 * // With recording
 * const api = connect('https://api.example.do', { recordCalls: true });
 * ```
 */
export function connect<T = $>(
  url: string,
  options?: Omit<RpcConnectionOptions, 'url'>
): RpcProxy<T> {
  const connection = new RpcConnection(url, { ...options, url });
  return connection.createProxy<RpcProxy<T>>([]);
}

/**
 * Create a connection with explicit lifecycle control
 *
 * @param options - Full connection options
 * @returns Connection object with proxy access
 */
export function createConnection(options: RpcConnectionOptions): {
  connection: Connection;
  proxy: RpcProxy;
  startRecording: () => void;
  stopRecording: () => Recording;
} {
  const conn = new RpcConnection(options.url, options);
  return {
    connection: conn,
    proxy: conn.createProxy<RpcProxy>([]),
    startRecording: () => conn.startRecording(),
    stopRecording: () => conn.stopRecording(),
  };
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  Connection,
  ConnectionOptions,
  Transport,
  TransportState,
  RpcMessage,
  CapabilityRef,
} from '@dotdo/capnweb';

export {
  CapnwebError,
  ConnectionError,
  RpcError,
  CapabilityError,
} from '@dotdo/capnweb';
