#!/usr/bin/env npx tsx
// Copyright (c) 2025 DotDo Platform
// Licensed under the MIT license

/**
 * DotDo Platform Conformance Test Server
 *
 * This server uses the dotdo platform package as the backend for all SDK tests.
 * It provides the same TestTarget interface as the raw capnweb server, but routes
 * all RPC through the dotdo managed layer with:
 *   - Authentication handling
 *   - Connection pooling
 *   - Retry logic
 *   - Request logging
 *
 * Usage:
 *   npx tsx test/server/dotdo-server.ts [--port PORT]
 *
 * Environment Variables:
 *   DOTDO_API_KEY - API key for authentication (optional for testing)
 *   DOTDO_DEBUG   - Enable debug logging
 */

import * as http from 'node:http';
import { WebSocketServer, AddressInfo } from 'ws';
import { DotDo, type DotDoOptions } from 'platform.do';
import { TestTarget } from './handlers.js';

// Re-export capnweb functions for RPC handling
// These are used when we run as a server rather than client
import { newWebSocketRpcSession, nodeHttpBatchRpcResponse } from 'capnweb';

// Parse command line arguments
function parseArgs(): { port: number; verbose: boolean; apiKey?: string } {
  const args = process.argv.slice(2);
  let port = 8787;
  let verbose = process.env.DOTDO_DEBUG === 'true';
  let apiKey = process.env.DOTDO_API_KEY;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      const portArg = args[++i];
      if (portArg) {
        port = parseInt(portArg, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(`Invalid port: ${portArg}`);
          process.exit(1);
        }
      }
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--api-key' || arg === '-k') {
      apiKey = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
DotDo Platform Conformance Test Server

Usage: npx tsx test/server/dotdo-server.ts [options]

Options:
  --port, -p PORT      Port to listen on (default: 8787)
  --api-key, -k KEY    API key for authentication
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help message

Environment Variables:
  DOTDO_API_KEY        API key for authentication
  DOTDO_DEBUG          Enable debug logging (true/false)

The server provides:
  - WebSocket RPC at ws://localhost:PORT/
  - HTTP batch RPC at POST http://localhost:PORT/
  - Health check at GET http://localhost:PORT/health
  - DotDo platform info at GET http://localhost:PORT/platform

TestTarget methods:
  - square(n: number): number
  - returnNumber(n: number): number
  - returnNull(): null
  - returnUndefined(): undefined
  - makeCounter(initial: number): Counter
  - generateFibonacci(n: number): number[]
  - callFunction(func, i: number): { result: number }
  - callSquare(self, i: number): { result: number }
  - incrementCounter(counter, by: number): number
  - throwError(): never (throws RangeError)
`);
      process.exit(0);
    }
  }

  return { port, verbose, apiKey };
}

const { port, verbose, apiKey } = parseArgs();

// Initialize DotDo platform client for any outbound connections
// This demonstrates how SDKs should connect to the test server
const dotdoOptions: DotDoOptions = {
  apiKey,
  debug: verbose,
  baseUrl: `http://localhost:${port}`, // Self-reference for testing
  retry: {
    maxAttempts: 3,
    baseDelay: 100,
    maxDelay: 5000,
  },
  pool: {
    minConnections: 1,
    maxConnections: 10,
  },
};

const dotdoClient = new DotDo(dotdoOptions);

// Track active connections for metrics
let activeConnections = 0;
let totalRequests = 0;
let totalErrors = 0;

// Create HTTP server with dotdo platform integration
const httpServer = http.createServer((request, response) => {
  const timestamp = new Date().toISOString();
  totalRequests++;

  // Log incoming requests
  if (verbose) {
    console.log(`[${timestamp}] ${request.method} ${request.url}`);
  }

  // Handle WebSocket upgrade requests - these are handled by WebSocketServer
  if (request.headers.upgrade?.toLowerCase() === 'websocket') {
    return;
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    response.end();
    return;
  }

  // Handle health check
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      status: 'ok',
      timestamp,
      platform: 'dotdo',
      version: '0.1.0',
    }));
    return;
  }

  // Handle platform info endpoint
  if (request.method === 'GET' && request.url === '/platform') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      name: 'dotdo',
      version: '0.1.0',
      features: [
        'websocket-rpc',
        'http-batch-rpc',
        'promise-pipelining',
        'capability-passing',
        'callbacks',
        'server-side-map',
      ],
      metrics: {
        activeConnections,
        totalRequests,
        totalErrors,
      },
      config: {
        debug: verbose,
        hasApiKey: !!apiKey,
      },
    }));
    return;
  }

  // Handle metrics endpoint
  if (request.method === 'GET' && request.url === '/metrics') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      activeConnections,
      totalRequests,
      totalErrors,
      timestamp,
    }));
    return;
  }

  // Validate authentication if API key is configured
  if (apiKey) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey) {
      response.writeHead(401, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(JSON.stringify({
        error: 'Unauthorized',
        message: 'Valid API key required',
      }));
      totalErrors++;
      return;
    }
  }

  // Handle batch RPC requests through capnweb
  if (request.method === 'POST') {
    try {
      nodeHttpBatchRpcResponse(request, response, new TestTarget(), {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });

      if (verbose) {
        console.log(`[${timestamp}] Handled batch RPC request`);
      }
    } catch (error) {
      totalErrors++;
      if (verbose) {
        console.error(`[${timestamp}] RPC error:`, error);
      }
    }
    return;
  }

  // Default response
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    error: 'Not Found',
    message: `${request.method} ${request.url} not found`,
  }));
});

// Set up WebSocket server with dotdo platform integration
const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on('connection', (ws, request) => {
  const timestamp = new Date().toISOString();
  const clientId = Math.random().toString(36).substring(7);
  activeConnections++;
  totalRequests++;

  if (verbose) {
    console.log(`[${timestamp}] WebSocket connection established (client: ${clientId}, active: ${activeConnections})`);
  }

  // Validate authentication for WebSocket if API key is configured
  if (apiKey) {
    const url = new URL(request.url || '/', `http://localhost:${port}`);
    const token = url.searchParams.get('token');
    const authHeader = request.headers.authorization;

    if (!token && (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== apiKey)) {
      if (token !== apiKey) {
        ws.close(4001, 'Unauthorized');
        activeConnections--;
        totalErrors++;
        if (verbose) {
          console.log(`[${timestamp}] WebSocket unauthorized (client: ${clientId})`);
        }
        return;
      }
    }
  }

  // Create new RPC session for each connection using capnweb
  // The `as any` cast is because the `ws` module has its own WebSocket type
  // that's incompatible with the standard one, but they work the same way
  newWebSocketRpcSession(ws as any, new TestTarget());

  ws.on('close', (code, reason) => {
    activeConnections--;
    if (verbose) {
      console.log(
        `[${new Date().toISOString()}] WebSocket closed (client: ${clientId}, code: ${code}, reason: ${reason}, active: ${activeConnections})`
      );
    }
  });

  ws.on('error', (error) => {
    totalErrors++;
    console.error(`[${new Date().toISOString()}] WebSocket error (client: ${clientId}):`, error);
  });
});

// Start server
httpServer.listen(port, () => {
  const addr = httpServer.address() as AddressInfo;
  console.log(`
DotDo Platform Conformance Test Server
======================================
HTTP:      http://localhost:${addr.port}/
WebSocket: ws://localhost:${addr.port}/
Health:    http://localhost:${addr.port}/health
Platform:  http://localhost:${addr.port}/platform
Metrics:   http://localhost:${addr.port}/metrics

Backend: dotdo platform.do v0.1.0
Auth: ${apiKey ? 'API key required' : 'No authentication'}

Press Ctrl+C to stop.
`);

  if (verbose) {
    console.log('Verbose logging enabled');
  }
});

// Handle graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');

  // Close DotDo client
  await dotdoClient.close();

  // Close WebSocket server
  wsServer.close();

  // Close HTTP server
  httpServer.close();

  console.log(`Final stats: ${totalRequests} requests, ${totalErrors} errors`);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Export for testing and programmatic use
export { httpServer, wsServer, dotdoClient };
export { TestTarget } from './handlers.js';
export { Counter } from './counter.js';

/**
 * Programmatic setup function for use in test frameworks
 */
export async function setup(options: { port?: number; apiKey?: string; verbose?: boolean } = {}): Promise<{
  url: string;
  wsUrl: string;
  client: DotDo;
  shutdown: () => Promise<void>;
}> {
  const serverPort = options.port || 0; // 0 = ephemeral port
  const serverApiKey = options.apiKey;
  const serverVerbose = options.verbose || false;

  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      if (request.headers.upgrade?.toLowerCase() === 'websocket') {
        return;
      }

      if (request.method === 'OPTIONS') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', platform: 'dotdo' }));
        return;
      }

      if (request.method === 'POST') {
        nodeHttpBatchRpcResponse(request, response, new TestTarget(), {
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
        return;
      }

      response.writeHead(404);
      response.end('Not Found');
    });

    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      newWebSocketRpcSession(ws as any, new TestTarget());
    });

    server.listen(serverPort, () => {
      const addr = server.address() as AddressInfo;
      const url = `http://localhost:${addr.port}`;
      const wsUrl = `ws://localhost:${addr.port}`;

      const client = new DotDo({
        apiKey: serverApiKey,
        debug: serverVerbose,
        baseUrl: url,
      });

      if (serverVerbose) {
        console.log(`DotDo test server started at ${url}`);
      }

      resolve({
        url,
        wsUrl,
        client,
        shutdown: async () => {
          await client.close();
          wss.close();
          server.close();
        },
      });
    });
  });
}
