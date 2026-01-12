#!/usr/bin/env npx tsx
// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Conformance Test Server for Cap'n Web
 *
 * This server implements the TestTarget interface needed by the conformance
 * tests in test/conformance/*.yaml.
 *
 * Usage:
 *   npx tsx test/server/server.ts [--port PORT]
 *
 * Features:
 *   - WebSocket RPC connections
 *   - HTTP batch RPC requests
 *   - Request logging for debugging
 *   - Configurable port (default 8787)
 */

import * as http from 'node:http';
import { WebSocketServer, AddressInfo } from 'ws';
import { newWebSocketRpcSession, nodeHttpBatchRpcResponse } from '../../src/index.js';
import { TestTarget } from './handlers.js';

// Parse command line arguments
function parseArgs(): { port: number; verbose: boolean } {
  const args = process.argv.slice(2);
  let port = 8787;
  let verbose = false;

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
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Cap'n Web Conformance Test Server

Usage: npx tsx test/server/server.ts [options]

Options:
  --port, -p PORT   Port to listen on (default: 8787)
  --verbose, -v     Enable verbose logging
  --help, -h        Show this help message

The server provides:
  - WebSocket RPC at ws://localhost:PORT/
  - HTTP batch RPC at POST http://localhost:PORT/

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

  return { port, verbose };
}

const { port, verbose } = parseArgs();

// Create HTTP server
const httpServer = http.createServer((request, response) => {
  const timestamp = new Date().toISOString();

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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    response.end();
    return;
  }

  // Handle health check
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', timestamp }));
    return;
  }

  // Handle batch RPC requests
  if (request.method === 'POST') {
    nodeHttpBatchRpcResponse(request, response, new TestTarget(), {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });

    if (verbose) {
      console.log(`[${timestamp}] Handled batch RPC request`);
    }
    return;
  }

  // Default response
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not Found');
});

// Set up WebSocket server
const wsServer = new WebSocketServer({ server: httpServer });

wsServer.on('connection', (ws, request) => {
  const timestamp = new Date().toISOString();
  const clientId = Math.random().toString(36).substring(7);

  if (verbose) {
    console.log(`[${timestamp}] WebSocket connection established (client: ${clientId})`);
  }

  // Create new RPC session for each connection
  // The `as any` cast is because the `ws` module has its own WebSocket type
  // that's incompatible with the standard one, but they work the same way
  newWebSocketRpcSession(ws as any, new TestTarget());

  ws.on('close', (code, reason) => {
    if (verbose) {
      console.log(
        `[${new Date().toISOString()}] WebSocket closed (client: ${clientId}, code: ${code}, reason: ${reason})`
      );
    }
  });

  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] WebSocket error (client: ${clientId}):`, error);
  });
});

// Start server
httpServer.listen(port, () => {
  const addr = httpServer.address() as AddressInfo;
  console.log(`
Cap'n Web Conformance Test Server
==================================
HTTP:      http://localhost:${addr.port}/
WebSocket: ws://localhost:${addr.port}/
Health:    http://localhost:${addr.port}/health

Press Ctrl+C to stop.
`);

  if (verbose) {
    console.log('Verbose logging enabled');
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  wsServer.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  wsServer.close();
  httpServer.close();
  process.exit(0);
});

// Export for testing
export { httpServer, wsServer };
