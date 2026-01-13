/**
 * Protocol Version Security Tests
 *
 * RED phase tests for protocol version negotiation security features.
 * These tests verify protection against:
 * - Downgrade attacks
 * - Invalid version string injection
 * - Version mismatch exploitation
 * - Handshake replay attacks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  parseVersion,
  negotiateVersion,
  createHelloMessage,
  createHelloAckMessage,
  isHandshakeMessage,
  validateHelloMessage,
  validateHelloAckMessage,
  type HandshakeMessage,
  type HandshakeAckMessage,
} from '../../src/version.js';
import { RpcSession, RpcTransport, RpcTarget, RpcSessionOptions } from '../../src/index.js';

// ============================================================================
// Test Transport for Security Tests
// ============================================================================

class SecurityTestTransport implements RpcTransport {
  constructor(public name: string, private partner?: SecurityTestTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;
  public messages: string[] = [];
  public lastSentMessage?: string;

  async send(message: string): Promise<void> {
    this.lastSentMessage = message;
    this.messages.push(message);
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }
    return this.queue.shift()!;
  }

  injectMessage(message: string): void {
    this.queue.push(message);
    if (this.waiter) {
      this.waiter();
      this.waiter = undefined;
      this.aborter = undefined;
    }
  }

  abort(reason: any): void {
    this.aborted = true;
    this.abortReason = reason;
    if (this.aborter) {
      this.aborter(reason);
    }
  }
}

class SimpleTarget extends RpcTarget {
  getValue(): number {
    return 42;
  }
}

// Spin the microtask queue
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

// ============================================================================
// Version String Validation Security
// ============================================================================

describe('Version String Validation Security', () => {
  describe('Strict Version Format Validation', () => {
    it('should reject version strings with leading zeros', () => {
      // Security: Leading zeros could be used to bypass version checks
      expect(() => parseVersion('01.0')).toThrow();
      expect(() => parseVersion('1.00')).toThrow();
      expect(() => parseVersion('001.001')).toThrow();
    });

    it('should reject version strings with trailing whitespace', () => {
      // Security: Whitespace could bypass string comparison
      expect(() => parseVersion('1.0 ')).toThrow();
      expect(() => parseVersion(' 1.0')).toThrow();
      expect(() => parseVersion('1.0\n')).toThrow();
      expect(() => parseVersion('1.0\t')).toThrow();
    });

    it('should reject version strings with special characters', () => {
      // Security: Special chars could cause injection or bypass
      expect(() => parseVersion('1.0;drop table')).toThrow();
      expect(() => parseVersion('1.0<script>')).toThrow();
      expect(() => parseVersion('1.0${env.SECRET}')).toThrow();
      expect(() => parseVersion('1.0%00')).toThrow();
    });

    it('should reject extremely large version numbers', () => {
      // Security: Large numbers could cause integer overflow
      expect(() => parseVersion('999999999999999999999.0')).toThrow();
      expect(() => parseVersion('1.999999999999999999999')).toThrow();
      expect(() => parseVersion(`${Number.MAX_SAFE_INTEGER + 1}.0`)).toThrow();
    });

    it('should reject version strings with unicode lookalikes', () => {
      // Security: Unicode lookalike characters could bypass checks
      expect(() => parseVersion('1\u200b.0')).toThrow(); // Zero-width space
      expect(() => parseVersion('1.\u0660')).toThrow(); // Arabic-Indic digit zero
      expect(() => parseVersion('\uff11.0')).toThrow(); // Fullwidth digit one
    });

    it('should reject version strings exceeding max length', () => {
      // Security: Extremely long strings could cause DoS
      const longVersion = '1.' + '0'.repeat(1000);
      expect(() => parseVersion(longVersion)).toThrow();
    });
  });

  describe('Versions Array Validation', () => {
    it('should reject empty versions array in hello message', () => {
      const hello = createHelloMessage();
      hello.versions = [];
      // Negotiation should fail or reject
      expect(negotiateVersion(hello.versions)).toBeNull();
    });

    it('should reject versions array with too many entries', () => {
      // Security: DoS via large array
      const versions = Array(1000).fill('1.0');
      // Should either throw or limit processing
      expect(() => negotiateVersion(versions)).toThrow();
    });

    it('should reject versions array with non-string entries', () => {
      // Security: Type confusion attacks
      const versions: any[] = ['1.0', 123, null, undefined, { version: '1.0' }];
      expect(() => negotiateVersion(versions)).toThrow();
    });

    it('should reject duplicate versions in array', () => {
      // Security: Could be used to amplify version selection bias
      const versions = ['1.0', '1.0', '1.0', '1.0', '1.0'];
      // Should either reject or deduplicate
      const result = negotiateVersion(versions);
      // If it returns, should only count as single version
      expect(result === '1.0' || result === null).toBe(true);
    });
  });
});

// ============================================================================
// Downgrade Attack Prevention
// ============================================================================

describe('Downgrade Attack Prevention', () => {
  it('should not accept versions lower than MIN_SUPPORTED_VERSION', () => {
    // Attacker tries to force use of old, vulnerable version
    const result = negotiateVersion(['0.9', '0.5', '0.1']);
    expect(result).toBeNull();
  });

  it('should reject if only downgrade versions are offered', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    let serverError: Error | undefined;

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
      onVersionNegotiated: () => {},
    }, false);

    // Inject malicious hello with only old versions
    serverTransport.injectMessage(JSON.stringify({
      type: 'hello',
      versions: ['0.1', '0.5', '0.9'],
    }));

    await pumpMicrotasks();

    // Server should have sent a rejection
    const serverMessages = serverTransport.messages.map(m => JSON.parse(m));
    const rejectMsg = serverMessages.find(m => m.type === 'hello-reject');
    expect(rejectMsg).toBeDefined();
  });

  it('should prefer higher version when both high and low are offered', () => {
    // If attacker includes both, we should pick the higher one
    const result = negotiateVersion(['0.5', '1.0', '0.9']);
    expect(result).toBe('1.0');
  });

  it('should not allow version rollback after negotiation', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    await client.waitForHandshake();
    await server.waitForHandshake();

    expect(client.getNegotiatedVersion()).toBe('1.0');

    // Attacker tries to send another hello to downgrade
    serverTransport.injectMessage(JSON.stringify({
      type: 'hello',
      versions: ['0.5'],
    }));

    await pumpMicrotasks();

    // Version should NOT have changed
    expect(client.getNegotiatedVersion()).toBe('1.0');
  });
});

// ============================================================================
// Handshake Replay Attack Prevention
// ============================================================================

describe('Handshake Replay Attack Prevention', () => {
  it('should include unique nonce in hello message', () => {
    const hello1 = createHelloMessage();
    const hello2 = createHelloMessage();

    // Each hello should have a unique nonce
    expect(hello1.nonce).toBeDefined();
    expect(hello2.nonce).toBeDefined();
    expect(hello1.nonce).not.toBe(hello2.nonce);
  });

  // TODO: This test requires session.ts to verify nonce matches
  it.skip('should reject hello-ack with mismatched nonce', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    let handshakeError: Error | undefined;

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);

    await pumpMicrotasks();

    // Get the nonce from the sent hello
    const helloMsg = JSON.parse(clientTransport.lastSentMessage!);
    expect(helloMsg.nonce).toBeDefined();

    // Inject hello-ack with WRONG nonce (replay attack)
    clientTransport.injectMessage(JSON.stringify({
      type: 'hello-ack',
      selectedVersion: '1.0',
      nonce: 'wrong-nonce-' + Math.random(),
    }));

    await pumpMicrotasks();

    // Session should be aborted
    expect(clientTransport.aborted).toBe(true);
  });

  it('should include timestamp for freshness checking', () => {
    const hello = createHelloMessage();
    expect(hello.timestamp).toBeDefined();
    expect(typeof hello.timestamp).toBe('number');
    // Timestamp should be recent
    expect(hello.timestamp).toBeGreaterThan(Date.now() - 5000);
    expect(hello.timestamp).toBeLessThanOrEqual(Date.now());
  });

  // TODO: This test requires session.ts to check timestamp freshness
  it.skip('should reject hello with expired timestamp', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    // Inject hello with old timestamp (replay of old message)
    serverTransport.injectMessage(JSON.stringify({
      type: 'hello',
      versions: ['1.0'],
      timestamp: Date.now() - 60000, // 1 minute ago
    }));

    await pumpMicrotasks();

    // Server should reject the stale hello
    const serverMessages = serverTransport.messages.map(m => JSON.parse(m));
    const rejectMsg = serverMessages.find(m => m.type === 'hello-reject');
    expect(rejectMsg).toBeDefined();
    expect(rejectMsg.reason).toContain('expired');
  });

  // TODO: This test requires session.ts to track and reject duplicate hellos
  it.skip('should reject duplicate hello messages', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    const hello = createHelloMessage();
    const helloStr = JSON.stringify(hello);

    // Send first hello
    serverTransport.injectMessage(helloStr);
    await pumpMicrotasks();

    // Send duplicate hello (replay)
    serverTransport.injectMessage(helloStr);
    await pumpMicrotasks();

    // Second hello should be ignored or rejected
    const serverMessages = serverTransport.messages.map(m => JSON.parse(m));
    const ackMessages = serverMessages.filter(m => m.type === 'hello-ack');
    expect(ackMessages.length).toBe(1); // Only one ack
  });
});

// ============================================================================
// Version Mismatch Exploitation Prevention
// ============================================================================

describe('Version Mismatch Exploitation Prevention', () => {
  it('should use constant-time comparison for version strings', async () => {
    // Security: Timing attacks could reveal version info
    // This test verifies the comparison doesn't leak timing info

    // We can't directly test timing, but we can verify the function exists
    const { constantTimeCompare } = await import('../../src/version.js');
    expect(constantTimeCompare).toBeDefined();
    expect(typeof constantTimeCompare).toBe('function');
  });

  it('should not reveal supported versions in error messages to unauthenticated peers', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    // Inject hello with unsupported version
    serverTransport.injectMessage(JSON.stringify({
      type: 'hello',
      versions: ['99.0'],
    }));

    await pumpMicrotasks();

    // Rejection should NOT list our supported versions (info leak)
    const serverMessages = serverTransport.messages.map(m => JSON.parse(m));
    const rejectMsg = serverMessages.find(m => m.type === 'hello-reject');
    expect(rejectMsg).toBeDefined();
    // The supportedVersions should be empty or omitted to prevent enumeration
    expect(rejectMsg.supportedVersions?.length ?? 0).toBe(0);
  });

  it('should rate limit version negotiation errors', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const errors: Error[] = [];

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
      onInternalError: (err) => errors.push(err),
    }, false);

    // Flood with invalid hellos
    for (let i = 0; i < 100; i++) {
      serverTransport.injectMessage(JSON.stringify({
        type: 'hello',
        versions: ['invalid-' + i],
      }));
    }

    await pumpMicrotasks();

    // Should not process all 100 (rate limited)
    const serverMessages = serverTransport.messages.map(m => JSON.parse(m));
    const rejectMessages = serverMessages.filter(m => m.type === 'hello-reject');
    expect(rejectMessages.length).toBeLessThan(100);
  });

  it('should validate hello-ack selectedVersion is from our offered list', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);

    await pumpMicrotasks();

    // Inject hello-ack with version we didn't offer
    clientTransport.injectMessage(JSON.stringify({
      type: 'hello-ack',
      selectedVersion: '99.0', // Not in our supported list
    }));

    await pumpMicrotasks();

    // Session should be aborted
    expect(clientTransport.aborted).toBe(true);
  });
});

// ============================================================================
// Hello Message Validation
// ============================================================================

describe('Hello Message Validation', () => {
  it('should validate hello message has required fields', () => {
    // Missing versions
    expect(() => validateHelloMessage({ type: 'hello' })).toThrow();

    // versions not an array
    expect(() => validateHelloMessage({ type: 'hello', versions: '1.0' })).toThrow();

    // Valid
    expect(() => validateHelloMessage({ type: 'hello', versions: ['1.0'] })).not.toThrow();
  });

  it('should validate hello-ack message has required fields', () => {
    // Missing selectedVersion
    expect(() => validateHelloAckMessage({ type: 'hello-ack' })).toThrow();

    // selectedVersion not a string
    expect(() => validateHelloAckMessage({ type: 'hello-ack', selectedVersion: 1.0 })).toThrow();

    // Valid
    expect(() => validateHelloAckMessage({ type: 'hello-ack', selectedVersion: '1.0' })).not.toThrow();
  });

  it('should reject hello message with __proto__ pollution attempt', () => {
    const maliciousHello = JSON.parse('{"type":"hello","versions":["1.0"],"__proto__":{"polluted":true}}');
    expect(() => validateHelloMessage(maliciousHello)).toThrow();
  });

  it('should reject hello message with constructor pollution attempt', () => {
    const maliciousHello = {
      type: 'hello',
      versions: ['1.0'],
      constructor: { prototype: { polluted: true } },
    };
    expect(() => validateHelloMessage(maliciousHello)).toThrow();
  });
});

// ============================================================================
// Transport-Level Security
// ============================================================================

describe('Transport-Level Security', () => {
  it('should not process handshake messages after session is established', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    await client.waitForHandshake();
    await server.waitForHandshake();

    const initialVersion = client.getNegotiatedVersion();

    // Try to inject a new hello message after handshake
    clientTransport.injectMessage(JSON.stringify({
      type: 'hello',
      versions: ['99.0'],
    }));

    await pumpMicrotasks();

    // Version should not change
    expect(client.getNegotiatedVersion()).toBe(initialVersion);

    // Session should remain functional
    expect(client.isHandshakeComplete()).toBe(true);
  });

  // TODO: This test requires session.ts to limit message sizes
  it.skip('should limit total size of handshake message', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    // Create oversized hello message
    const hugeHello = {
      type: 'hello',
      versions: ['1.0'],
      extraData: 'x'.repeat(1024 * 1024), // 1MB of data
    };

    serverTransport.injectMessage(JSON.stringify(hugeHello));

    await pumpMicrotasks();

    // Should be rejected
    expect(serverTransport.aborted).toBe(true);
  });

  it('should handle malformed JSON in handshake gracefully', async () => {
    const clientTransport = new SecurityTestTransport('client');
    const serverTransport = new SecurityTestTransport('server', clientTransport);

    let internalError: Error | undefined;

    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
      onInternalError: (err) => { internalError = err; },
    }, false);

    // Inject malformed JSON
    serverTransport.injectMessage('{"type":"hello", versions: [1.0');

    await pumpMicrotasks();

    // Should abort cleanly without crashing
    expect(serverTransport.aborted).toBe(true);
  });
});
