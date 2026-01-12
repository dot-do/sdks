// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe } from "vitest"
import { newWorkersRpcResponse } from "../src/index.js"
import { TestTarget } from "./test-util.js";

/**
 * Creates a mock POST request with the specified origin header.
 * The body is empty, which is a valid batch with 0 messages.
 */
function createMockRequest(origin?: string): Request {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (origin) {
    headers.set("Origin", origin);
  }
  // Empty body is a valid batch (0 messages)
  return new Request("http://localhost/rpc", {
    method: "POST",
    headers,
    body: ""
  });
}

/**
 * Creates a mock OPTIONS (preflight) request with the specified origin header.
 */
function createPreflightRequest(origin?: string): Request {
  const headers = new Headers();
  headers.set("Access-Control-Request-Method", "POST");
  if (origin) {
    headers.set("Origin", origin);
  }
  return new Request("http://localhost/rpc", {
    method: "OPTIONS",
    headers
  });
}

describe("CORS origin validation", () => {
  describe("without allowedOrigins configuration (default restrictive behavior)", () => {
    it("does not set CORS headers when no allowedOrigins is configured", async () => {
      const request = createMockRequest("https://example.com");
      const response = await newWorkersRpcResponse(request, new TestTarget());

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("does not set CORS headers even for same-origin requests when unconfigured", async () => {
      const request = createMockRequest("http://localhost");
      const response = await newWorkersRpcResponse(request, new TestTarget());

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("does not set CORS headers when Origin header is missing", async () => {
      const request = createMockRequest(); // No origin
      const response = await newWorkersRpcResponse(request, new TestTarget());

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("with specific allowedOrigins list", () => {
    it("sets CORS headers for allowed origins", async () => {
      const request = createMockRequest("https://trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com", "https://also-trusted.com"]
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.com");
    });

    it("does not set CORS headers for non-allowed origins", async () => {
      const request = createMockRequest("https://untrusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("performs exact origin matching (no partial matches)", async () => {
      const request = createMockRequest("https://trusted.com.evil.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("handles case-sensitive origin matching for domain", async () => {
      // Origins should be case-insensitive for the host part per RFC 6454,
      // but we should be careful. Testing explicit matching behavior.
      const request = createMockRequest("https://TRUSTED.COM");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      // This tests the current behavior - exact matching
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("returns the specific origin, not the list, when matched", async () => {
      const request = createMockRequest("https://also-trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com", "https://also-trusted.com"]
      });

      // Should return the actual origin, not "*" or a list
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://also-trusted.com");
    });

    it("handles empty allowedOrigins array (blocks all)", async () => {
      const request = createMockRequest("https://example.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: []
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("with wildcard allowedOrigins", () => {
    it("requires explicit opt-in for wildcard CORS", async () => {
      const request = createMockRequest("https://any-origin.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: "*"
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("sets wildcard for any origin when configured", async () => {
      const request1 = createMockRequest("https://example.com");
      const request2 = createMockRequest("https://other.com");

      const response1 = await newWorkersRpcResponse(request1, new TestTarget(), {
        allowedOrigins: "*"
      });
      const response2 = await newWorkersRpcResponse(request2, new TestTarget(), {
        allowedOrigins: "*"
      });

      expect(response1.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response2.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("sets wildcard even when no Origin header present", async () => {
      const request = createMockRequest(); // No origin
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: "*"
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("credentials handling", () => {
    it("sets Access-Control-Allow-Credentials when allowCredentials is true", async () => {
      const request = createMockRequest("https://trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"],
        allowCredentials: true
      });

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      // When credentials are allowed, origin must be specific, not wildcard
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.com");
    });

    it("does not set credentials header when allowCredentials is false", async () => {
      const request = createMockRequest("https://trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"],
        allowCredentials: false
      });

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("does not set credentials header by default", async () => {
      const request = createMockRequest("https://trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("cannot use wildcard with credentials (returns specific origin instead)", async () => {
      const request = createMockRequest("https://example.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: "*",
        allowCredentials: true
      });

      // Per CORS spec, when credentials are included, origin cannot be "*"
      // So we should return the specific origin
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });
  });

  describe("CORS headers on different response types", () => {
    it("applies CORS settings to POST (batch) requests", async () => {
      const request = createMockRequest("https://trusted.com");
      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.com");
    });

    it("applies CORS settings to error responses", async () => {
      const headers = new Headers();
      headers.set("Origin", "https://trusted.com");
      const request = new Request("http://localhost/rpc", {
        method: "GET", // Invalid method for RPC
        headers
      });

      const response = await newWorkersRpcResponse(request, new TestTarget(), {
        allowedOrigins: ["https://trusted.com"]
      });

      // Even error responses should have appropriate CORS headers
      // so browsers can read the error message
      expect(response.status).toBe(400);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.com");
    });
  });

  describe("backwards compatibility", () => {
    it("old API signature (without options) still works", async () => {
      const request = createMockRequest("https://example.com");

      // This should work without breaking, but now defaults to no CORS
      const response = await newWorkersRpcResponse(request, new TestTarget());

      // The change from * to no CORS is intentional - this is a breaking change
      // for security, but existing code will still compile
      expect(response.status).toBeLessThan(500);
    });
  });
});
