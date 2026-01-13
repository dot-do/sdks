// Copyright (c) 2025 DotDo Platform
// Licensed under the MIT license

/**
 * Test Type Declarations
 *
 * Module declarations for test-only dependencies that don't have their own type packages.
 * These declarations allow TypeScript to compile test files without errors.
 */

/**
 * platform.do module declaration
 *
 * The DotDo platform client for managed RPC connections with authentication,
 * connection pooling, and retry logic.
 */
declare module 'platform.do' {
  /** Options for configuring the DotDo client */
  export interface DotDoOptions {
    /** API key for authentication */
    apiKey?: string;
    /** Enable debug logging */
    debug?: boolean;
    /** Base URL for the platform */
    baseUrl?: string;
    /** Retry configuration */
    retry?: {
      maxAttempts?: number;
      baseDelay?: number;
      maxDelay?: number;
    };
    /** Connection pool configuration */
    pool?: {
      minConnections?: number;
      maxConnections?: number;
    };
  }

  /** Test server instance returned by setup() */
  export interface TestServerInstance {
    /** HTTP URL for the server */
    url: string;
    /** WebSocket URL for the server */
    wsUrl: string;
    /** DotDo client configured for this server */
    client: DotDo;
    /** Shutdown the server */
    shutdown(): Promise<void>;
  }

  /** Test client options */
  export interface TestClientOptions {
    /** Server URL to connect to */
    serverUrl: string;
    /** Enable debug logging */
    debug?: boolean;
  }

  /**
   * DotDo platform client
   *
   * Provides managed RPC connections with:
   * - Authentication handling
   * - Connection pooling
   * - Retry logic
   * - Request logging
   */
  export class DotDo {
    constructor(options?: DotDoOptions);

    /**
     * Connect to an RPC endpoint
     * @param url The URL to connect to
     * @returns A proxy for making RPC calls
     */
    connect(url: string): Promise<unknown>;

    /**
     * Get authentication headers
     * @returns Headers with Authorization if API key is set
     */
    getAuthHeaders(): Record<string, string>;

    /**
     * Close the client and all connections
     */
    close(): Promise<void>;
  }

  /**
   * Create a test client configured for a local server
   */
  export function createTestClient(options: TestClientOptions): DotDo;
}

/**
 * capnweb module declaration
 *
 * Re-exports from the main capnweb package for use in test server implementations.
 */
declare module 'capnweb' {
  import type { IncomingMessage, ServerResponse } from 'node:http';

  /**
   * Create a new WebSocket RPC session
   *
   * @param webSocket WebSocket connection or URL
   * @param localMain Local RPC target to expose
   * @returns RPC stub for the remote main
   */
  export function newWebSocketRpcSession<T = unknown>(
    webSocket: WebSocket | unknown,
    localMain?: unknown
  ): T;

  /**
   * Handle HTTP batch RPC requests in Node.js
   *
   * @param request Node.js HTTP request
   * @param response Node.js HTTP response
   * @param localMain Local RPC target to expose
   * @param options Response options
   */
  export function nodeHttpBatchRpcResponse(
    request: IncomingMessage,
    response: ServerResponse,
    localMain: unknown,
    options?: {
      headers?: Record<string, string>;
    }
  ): void;

  /**
   * Handle HTTP batch RPC requests (Workers/fetch API)
   *
   * @param request Fetch API Request
   * @param localMain Local RPC target to expose
   * @returns Fetch API Response
   */
  export function newHttpBatchRpcResponse(
    request: Request,
    localMain: unknown
  ): Promise<Response>;

  /**
   * RPC target base class
   */
  export class RpcTarget {
    constructor();
  }

  /**
   * RPC stub type for remote objects
   */
  export type RpcStub<T = unknown> = T & {
    [key: string]: (...args: unknown[]) => Promise<unknown>;
  };
}
