// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe } from "vitest"
import { newWorkersRpcResponse } from "../../src/index.js"
import { TestTarget } from "../test-util.js";

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

  /**
   * Tests for null/empty Origin header handling.
   *
   * Background: The Origin header can be:
   * - A normal URL origin (e.g., "https://example.com")
   * - The literal string "null" (from sandboxed iframes, file://, data: URLs, etc.)
   * - An empty string (edge case)
   * - Missing entirely (same-origin requests or requests without CORS)
   *
   * These tests verify proper handling of these edge cases.
   * See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin
   */
  describe("null and empty Origin header handling", () => {
    /**
     * Helper to create a request with a literal "null" Origin header.
     * This mimics requests from sandboxed iframes, file://, data: URLs.
     */
    function createNullOriginRequest(): Request {
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Origin", "null"); // Literal string "null"
      return new Request("http://localhost/rpc", {
        method: "POST",
        headers,
        body: ""
      });
    }

    /**
     * Helper to create a request with an empty string Origin header.
     */
    function createEmptyOriginRequest(): Request {
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Origin", ""); // Empty string
      return new Request("http://localhost/rpc", {
        method: "POST",
        headers,
        body: ""
      });
    }

    describe("literal 'null' Origin header (sandboxed iframe, file://, data: URL)", () => {
      it("should not allow null origin by default when allowedOrigins is an array", async () => {
        const request = createNullOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com"]
        });

        // The literal "null" should NOT match unless explicitly configured
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      });

      it("should allow null origin when explicitly included in allowedOrigins array", async () => {
        const request = createNullOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com", "null"] // Explicitly allow "null"
        });

        // When "null" is explicitly in the allowlist, it should be allowed
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
      });

      it("should reflect null origin with wildcard allowedOrigins when credentials disabled", async () => {
        const request = createNullOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: "*"
        });

        // Wildcard should return "*", not "null"
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });

      it("should NOT allow null origin with wildcard when credentials are enabled", async () => {
        const request = createNullOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: "*",
          allowCredentials: true
        });

        // SECURITY: When credentials are enabled with wildcard, we reflect the origin.
        // But reflecting "null" with credentials is a security risk - it allows
        // any sandboxed context to make credentialed requests.
        // The implementation should either:
        // 1. Not set CORS headers (blocking the request), or
        // 2. Not set credentials header for null origin
        //
        // Current behavior likely reflects "null" with credentials, which is dangerous.
        expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("null");
        // If origin is set, credentials should not be true
        if (response.headers.get("Access-Control-Allow-Origin")) {
          expect(response.headers.get("Access-Control-Allow-Credentials")).not.toBe("true");
        }
      });

      it("should NOT allow null origin with credentials even when explicitly in allowlist", async () => {
        const request = createNullOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["null"], // Explicitly allow "null"
          allowCredentials: true
        });

        // SECURITY: Allowing credentials with null origin is dangerous because
        // "null" origin doesn't identify a unique origin - many different
        // contexts (sandboxed iframes, file://, data:) all use "null".
        // Credentials should not be allowed with null origin.
        //
        // Either:
        // 1. Don't set CORS headers at all, or
        // 2. Set origin but not credentials
        const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
        const allowCreds = response.headers.get("Access-Control-Allow-Credentials");

        // These two should not both be truthy for null origin
        expect(allowOrigin === "null" && allowCreds === "true").toBe(false);
      });
    });

    describe("empty string Origin header", () => {
      it("should not allow empty origin when allowedOrigins is an array", async () => {
        const request = createEmptyOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com"]
        });

        // Empty origin should not match anything
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      });

      it("should not allow empty origin even when empty string is in allowlist", async () => {
        const request = createEmptyOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com", ""]
        });

        // Empty string should not be a valid allowed origin - it's nonsensical
        // and could indicate a misconfiguration
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      });

      it("should handle empty origin with wildcard mode", async () => {
        const request = createEmptyOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: "*"
        });

        // Wildcard should still return "*" for empty origin
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      });

      it("should not reflect empty origin with credentials", async () => {
        const request = createEmptyOriginRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: "*",
          allowCredentials: true
        });

        // Should not reflect empty string as origin, even with wildcard + credentials
        // Either return "*" (without credentials) or nothing
        expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("");
      });
    });

    describe("missing Origin header (same-origin or non-browser requests)", () => {
      it("should not set CORS headers when Origin is missing and allowedOrigins is array", async () => {
        const request = createMockRequest(); // No origin
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com"]
        });

        // No Origin header means no CORS headers needed
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
      });

      it("should handle missing Origin with credentials option gracefully", async () => {
        const request = createMockRequest(); // No origin
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com"],
          allowCredentials: true
        });

        // No Origin header means no CORS headers, including credentials
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
        expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
      });
    });

    describe("preflight requests with null/empty Origin", () => {
      /**
       * Helper to create a preflight request with null Origin.
       */
      function createNullOriginPreflightRequest(): Request {
        const headers = new Headers();
        headers.set("Access-Control-Request-Method", "POST");
        headers.set("Origin", "null");
        return new Request("http://localhost/rpc", {
          method: "OPTIONS",
          headers
        });
      }

      it("should handle preflight with null origin correctly", async () => {
        const request = createNullOriginPreflightRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["null"] // Explicitly allow null
        });

        // Preflight should work with explicitly allowed null origin
        expect(response.status).toBe(204);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
        expect(response.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
      });

      it("should reject preflight with null origin when not in allowlist", async () => {
        const request = createNullOriginPreflightRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["https://trusted.com"]
        });

        // Preflight should not include CORS headers for disallowed origin
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      });

      it("should not allow preflight with null origin and credentials", async () => {
        const request = createNullOriginPreflightRequest();
        const response = await newWorkersRpcResponse(request, new TestTarget(), {
          allowedOrigins: ["null"],
          allowCredentials: true
        });

        // SECURITY: Even for preflight, null + credentials should be rejected
        const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
        const allowCreds = response.headers.get("Access-Control-Allow-Credentials");

        expect(allowOrigin === "null" && allowCreds === "true").toBe(false);
      });
    });
  });
});
