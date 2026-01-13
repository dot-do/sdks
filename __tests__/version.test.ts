/**
 * Protocol Version Negotiation Tests
 *
 * Tests for the version negotiation module and RPC session handshake.
 */

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  MAX_SUPPORTED_VERSION,
  SUPPORTED_VERSIONS,
  parseVersion,
  compareVersions,
  areVersionsCompatible,
  isVersionSupported,
  negotiateVersion,
  negotiateVersionWithDetails,
  createHelloMessage,
  createHelloAckMessage,
  createHelloRejectMessage,
  isHandshakeMessage,
  formatVersion,
} from '../src/version.js';
import { RpcSession, RpcTransport, RpcTarget, RpcSessionOptions } from '../src/index.js';

describe('Protocol Version Constants', () => {
  it('should define current protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('1.0');
  });

  it('should define minimum supported version', () => {
    expect(MIN_SUPPORTED_VERSION).toBe('1.0');
  });

  it('should define maximum supported version', () => {
    expect(MAX_SUPPORTED_VERSION).toBe('1.0');
  });

  it('should have at least one supported version', () => {
    expect(SUPPORTED_VERSIONS.length).toBeGreaterThan(0);
    expect(SUPPORTED_VERSIONS).toContain('1.0');
  });
});

describe('parseVersion', () => {
  it('should parse valid version strings', () => {
    expect(parseVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseVersion('2.5')).toEqual({ major: 2, minor: 5 });
    expect(parseVersion('10.20')).toEqual({ major: 10, minor: 20 });
    expect(parseVersion('0.1')).toEqual({ major: 0, minor: 1 });
  });

  it('should throw on invalid format', () => {
    expect(() => parseVersion('1')).toThrow(/Invalid version format/);
    expect(() => parseVersion('1.2.3')).toThrow(/Invalid version format/);
    expect(() => parseVersion('')).toThrow(/Invalid version format/);
    expect(() => parseVersion('v1.0')).toThrow(/Invalid version format/);
  });

  it('should throw on invalid numbers', () => {
    expect(() => parseVersion('a.b')).toThrow(/Invalid version format/);
    expect(() => parseVersion('-1.0')).toThrow(/Invalid version format/);
    expect(() => parseVersion('1.-1')).toThrow(/Invalid version format/);
  });
});

describe('compareVersions', () => {
  it('should compare equal versions', () => {
    expect(compareVersions('1.0', '1.0')).toBe(0);
    expect(compareVersions('2.5', '2.5')).toBe(0);
  });

  it('should compare by major version first', () => {
    expect(compareVersions('1.0', '2.0')).toBe(-1);
    expect(compareVersions('2.0', '1.0')).toBe(1);
    expect(compareVersions('1.9', '2.0')).toBe(-1);
  });

  it('should compare by minor version when major is equal', () => {
    expect(compareVersions('1.0', '1.1')).toBe(-1);
    expect(compareVersions('1.5', '1.3')).toBe(1);
  });
});

describe('areVersionsCompatible', () => {
  it('should consider same major version as compatible', () => {
    expect(areVersionsCompatible('1.0', '1.0')).toBe(true);
    expect(areVersionsCompatible('1.0', '1.5')).toBe(true);
    expect(areVersionsCompatible('2.0', '2.99')).toBe(true);
  });

  it('should consider different major versions as incompatible', () => {
    expect(areVersionsCompatible('1.0', '2.0')).toBe(false);
    expect(areVersionsCompatible('1.9', '2.0')).toBe(false);
    expect(areVersionsCompatible('3.0', '1.0')).toBe(false);
  });
});

describe('isVersionSupported', () => {
  it('should return true for supported versions', () => {
    expect(isVersionSupported('1.0')).toBe(true);
  });

  it('should return false for unsupported major versions', () => {
    expect(isVersionSupported('2.0')).toBe(false);
    expect(isVersionSupported('0.1')).toBe(false);
  });

  it('should return false for invalid versions', () => {
    expect(isVersionSupported('invalid')).toBe(false);
    expect(isVersionSupported('')).toBe(false);
  });
});

describe('negotiateVersion', () => {
  it('should find compatible version from offered list', () => {
    expect(negotiateVersion(['1.0'])).toBe('1.0');
    expect(negotiateVersion(['1.0', '2.0'])).toBe('1.0');
    expect(negotiateVersion(['2.0', '1.0'])).toBe('1.0');
  });

  it('should return null when no compatible version', () => {
    expect(negotiateVersion(['2.0'])).toBe(null);
    expect(negotiateVersion(['2.0', '3.0'])).toBe(null);
    expect(negotiateVersion([])).toBe(null);
  });

  it('should select highest compatible version', () => {
    // When both sides support multiple versions, pick the highest
    expect(negotiateVersion(['1.0'], ['1.0'])).toBe('1.0');
  });

  it('should handle custom supported versions', () => {
    expect(negotiateVersion(['1.0', '1.5'], ['1.0', '1.5'])).toBe('1.5');
    expect(negotiateVersion(['2.0'], ['2.0', '2.5'])).toBe('2.0');
  });
});

describe('negotiateVersionWithDetails', () => {
  it('should return details for successful negotiation', () => {
    const result = negotiateVersionWithDetails(['1.0']);
    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0');
    expect(result!.isLatest).toBe(true);
    expect(result!.warning).toBeUndefined();
  });

  it('should return null for failed negotiation', () => {
    const result = negotiateVersionWithDetails(['2.0']);
    expect(result).toBeNull();
  });
});

describe('Handshake Message Creation', () => {
  describe('createHelloMessage', () => {
    it('should create hello message with supported versions', () => {
      const msg = createHelloMessage();
      expect(msg.type).toBe('hello');
      expect(msg.versions).toEqual([...SUPPORTED_VERSIONS]);
      expect(msg.clientId).toBeUndefined();
    });

    it('should include client ID when provided', () => {
      const msg = createHelloMessage('test-client');
      expect(msg.type).toBe('hello');
      expect(msg.clientId).toBe('test-client');
    });
  });

  describe('createHelloAckMessage', () => {
    it('should create acknowledgment message', () => {
      const msg = createHelloAckMessage('1.0');
      expect(msg.type).toBe('hello-ack');
      expect(msg.selectedVersion).toBe('1.0');
      expect(msg.serverId).toBeUndefined();
    });

    it('should include server ID when provided', () => {
      const msg = createHelloAckMessage('1.0', 'test-server');
      expect(msg.type).toBe('hello-ack');
      expect(msg.serverId).toBe('test-server');
    });
  });

  describe('createHelloRejectMessage', () => {
    it('should create rejection message', () => {
      const msg = createHelloRejectMessage('Version mismatch');
      expect(msg.type).toBe('hello-reject');
      expect(msg.reason).toBe('Version mismatch');
      // Security: supportedVersions is empty to prevent version enumeration attacks
      expect(msg.supportedVersions).toEqual([]);
    });
  });
});

describe('isHandshakeMessage', () => {
  it('should identify hello messages', () => {
    expect(isHandshakeMessage({ type: 'hello', versions: ['1.0'] })).toBe(true);
  });

  it('should identify hello-ack messages', () => {
    expect(isHandshakeMessage({ type: 'hello-ack', selectedVersion: '1.0' })).toBe(true);
  });

  it('should identify hello-reject messages', () => {
    expect(isHandshakeMessage({ type: 'hello-reject', reason: 'test', supportedVersions: [] })).toBe(true);
  });

  it('should reject non-handshake messages', () => {
    expect(isHandshakeMessage({ type: 'push' })).toBe(false);
    expect(isHandshakeMessage(['push', 0])).toBe(false);
    expect(isHandshakeMessage(null)).toBe(false);
    expect(isHandshakeMessage(undefined)).toBe(false);
    expect(isHandshakeMessage({})).toBe(false);
  });
});

describe('formatVersion', () => {
  it('should format version strings', () => {
    expect(formatVersion('1.0')).toBe('v1.0');
    expect(formatVersion('2.5')).toBe('v2.5');
  });
});

// Test Transport for handshake integration tests
class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
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

  async send(message: string): Promise<void> {
    this.messages.push(message);
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length == 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }
    return this.queue.shift()!;
  }

  abort(reason: any) {
    this.aborted = true;
    this.abortReason = reason;
  }
}

class SimpleTarget extends RpcTarget {
  getValue(): number {
    return 42;
  }

  add(a: number, b: number): number {
    return a + b;
  }
}

// Spin the microtask queue
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

describe('RpcSession Version Handshake Integration', () => {
  it('should complete handshake when enabled', async () => {
    const clientTransport = new TestTransport('client');
    const serverTransport = new TestTransport('server', clientTransport);

    let clientNegotiatedVersion: string | undefined;
    let serverNegotiatedVersion: string | undefined;

    const clientOptions: RpcSessionOptions = {
      enableVersionHandshake: true,
      peerId: 'test-client',
      onVersionNegotiated: (version, isLatest) => {
        clientNegotiatedVersion = version;
      },
    };

    const serverOptions: RpcSessionOptions = {
      enableVersionHandshake: true,
      peerId: 'test-server',
      onVersionNegotiated: (version, isLatest) => {
        serverNegotiatedVersion = version;
      },
    };

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, clientOptions, true);
    const server = new RpcSession(serverTransport, new SimpleTarget(), serverOptions, false);

    // Wait for handshake
    await client.waitForHandshake();
    await server.waitForHandshake();

    // Verify negotiated version
    expect(client.getNegotiatedVersion()).toBe('1.0');
    expect(server.getNegotiatedVersion()).toBe('1.0');
    expect(client.isHandshakeComplete()).toBe(true);
    expect(server.isHandshakeComplete()).toBe(true);

    // Verify callbacks were called
    expect(clientNegotiatedVersion).toBe('1.0');
    expect(serverNegotiatedVersion).toBe('1.0');

    // Verify handshake messages were sent
    const clientMessages = clientTransport.messages.map(m => JSON.parse(m));
    expect(clientMessages[0].type).toBe('hello');
    expect(clientMessages[0].versions).toContain('1.0');

    // Make a normal RPC call to verify session works
    const stub = client.getRemoteMain();
    const result = await stub.add(2, 3);
    expect(result).toBe(5);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it('should work without handshake by default', async () => {
    const clientTransport = new TestTransport('client');
    const serverTransport = new TestTransport('server', clientTransport);

    // No enableVersionHandshake option - handshake is disabled by default
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    // Handshake should be immediately complete
    expect(client.isHandshakeComplete()).toBe(true);
    expect(server.isHandshakeComplete()).toBe(true);

    // No handshake messages should be sent
    expect(clientTransport.messages.length).toBe(0);

    // RPC should work normally
    const stub = client.getRemoteMain();
    const result = await stub.getValue();
    expect(result).toBe(42);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it('should report negotiated version', async () => {
    const clientTransport = new TestTransport('client');
    const serverTransport = new TestTransport('server', clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      enableVersionHandshake: true,
    }, true);
    const server = new RpcSession(serverTransport, new SimpleTarget(), {
      enableVersionHandshake: true,
    }, false);

    await client.waitForHandshake();
    await server.waitForHandshake();

    // Both sides should report the same version
    expect(client.getNegotiatedVersion()).toBe(server.getNegotiatedVersion());
    expect(client.getNegotiatedVersion()).toBe(PROTOCOL_VERSION);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});
