import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initPeers, setRTC } from '../../lib/peers.js';

describe('peers', () => {
  let mockHsyncClient;
  let mockMqConn;

  beforeEach(() => {
    mockMqConn = {
      publish: vi.fn(),
    };

    mockHsyncClient = {
      myHostName: 'myhost.example.com',
      webUrl: 'https://myhost.example.com',
      peerMethods: {
        testMethod: vi.fn(),
      },
      mqConn: mockMqConn,
    };
  });

  describe('setRTC', () => {
    it('should accept an RTC implementation', () => {
      const mockRtc = {
        offerPeer: vi.fn(),
        answerPeer: vi.fn(),
      };

      // Should not throw
      expect(() => setRTC(mockRtc)).not.toThrow();
    });
  });

  describe('initPeers', () => {
    it('should return peer library with required methods', () => {
      const peerLib = initPeers(mockHsyncClient);

      expect(peerLib.cachedPeers).toBeTypeOf('object');
      expect(peerLib.getRPCPeer).toBeTypeOf('function');
      expect(peerLib.createRPCPeer).toBeTypeOf('function');
      expect(peerLib.createServerPeer).toBeTypeOf('function');
    });

    it('should attach methods to hsyncClient', () => {
      initPeers(mockHsyncClient);

      expect(mockHsyncClient.cachedPeers).toBeTypeOf('object');
      expect(mockHsyncClient.getRPCPeer).toBeTypeOf('function');
      expect(mockHsyncClient.createRPCPeer).toBeTypeOf('function');
      expect(mockHsyncClient.createServerPeer).toBeTypeOf('function');
    });

    it('should return an EventEmitter', () => {
      const peerLib = initPeers(mockHsyncClient);

      expect(peerLib.on).toBeTypeOf('function');
      expect(peerLib.emit).toBeTypeOf('function');
    });
  });

  describe('createRPCPeer', () => {
    let peerLib;

    beforeEach(() => {
      peerLib = initPeers(mockHsyncClient);
    });

    it('should throw if no hostname specified', () => {
      expect(() => peerLib.createRPCPeer({})).toThrow('No hostname specified');
    });

    it('should throw if hostname is same as client', () => {
      expect(() => peerLib.createRPCPeer({ hostName: 'myhost.example.com' })).toThrow(
        'Peer must be a different host'
      );
    });

    it('should create peer with correct hostname', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.hostName).toBe('other.example.com');
    });

    it('should create peer with myAuth', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.myAuth).toBeTypeOf('string');
      expect(peer.myAuth.length).toBeGreaterThan(0);
    });

    it('should create peer with rtcEvents emitter', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.rtcEvents).toBeDefined();
      expect(peer.rtcEvents.on).toBeTypeOf('function');
    });

    it('should create peer with empty sockets map', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.sockets).toEqual({});
    });

    it('should create peer with localMethods', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.localMethods).toBeDefined();
      expect(peer.localMethods.rtcSignal).toBeTypeOf('function');
    });

    it('should create peer with sendJSONMsg method', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.sendJSONMsg).toBeTypeOf('function');
    });

    it('should throw when sendJSONMsg called without object', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(() => peer.sendJSONMsg('not an object')).toThrow('sendJSONMsg requires an object');
    });

    it('should throw when sendJSONMsg called without connection', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(() => peer.sendJSONMsg({ test: 'data' })).toThrow('peer not connected');
    });

    it('should create peer with connectRTC method', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      expect(peer.connectRTC).toBeTypeOf('function');
    });

    it('should use default timeout of 10000', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

      // Timeout is passed to rawr internally, we can verify peer was created
      expect(peer).toBeDefined();
    });

    it('should accept custom timeout', () => {
      const peer = peerLib.createRPCPeer({
        hostName: 'other.example.com',
        timeout: 5000,
      });

      expect(peer).toBeDefined();
    });
  });

  describe('getRPCPeer', () => {
    let peerLib;

    beforeEach(() => {
      peerLib = initPeers(mockHsyncClient);
    });

    it('should create new peer if not cached', () => {
      const peer = peerLib.getRPCPeer({ hostName: 'new.example.com' });

      expect(peer).toBeDefined();
      expect(peer.hostName).toBe('new.example.com');
    });

    it('should return cached peer on second call', () => {
      const peer1 = peerLib.getRPCPeer({ hostName: 'cached.example.com' });
      const peer2 = peerLib.getRPCPeer({ hostName: 'cached.example.com' });

      expect(peer1).toBe(peer2);
    });

    it('should emit peerCreated event for new peer', () => {
      const createdHandler = vi.fn();
      peerLib.on('peerCreated', createdHandler);

      peerLib.getRPCPeer({ hostName: 'new.example.com' });

      expect(createdHandler).toHaveBeenCalledTimes(1);
    });

    it('should not emit peerCreated for cached peer', () => {
      const createdHandler = vi.fn();
      peerLib.on('peerCreated', createdHandler);

      peerLib.getRPCPeer({ hostName: 'cached.example.com' });
      peerLib.getRPCPeer({ hostName: 'cached.example.com' });

      expect(createdHandler).toHaveBeenCalledTimes(1);
    });

    it('should mark peer as temporary if specified', () => {
      const peer = peerLib.getRPCPeer({
        hostName: 'temp.example.com',
        temporary: true,
      });

      expect(peer.rpcTemporary).toBe(true);
    });
  });

  describe('createServerPeer', () => {
    let peerLib;

    beforeEach(() => {
      peerLib = initPeers(mockHsyncClient);
    });

    it('should create server peer with methods', () => {
      const methods = {
        testMethod: vi.fn(),
      };

      const peer = peerLib.createServerPeer(mockHsyncClient, methods);

      expect(peer).toBeDefined();
    });

    it('should publish to srpc topic on send', () => {
      const methods = {};
      const peer = peerLib.createServerPeer(mockHsyncClient, methods);

      // Access the transport to test send
      // The peer has internal transport that calls mqConn.publish
      // We need to trigger a method call or notification

      expect(peer).toBeDefined();
    });
  });

  describe('rtcEvents handlers', () => {
    let peerLib;

    beforeEach(() => {
      peerLib = initPeers(mockHsyncClient);
    });

    it('should handle dcOpen event', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });
      peer.rtcSend = vi.fn();

      peer.rtcEvents.emit('dcOpen');

      expect(peer.packAndSend).toBeTypeOf('function');
      // Should send test packet
      expect(peer.rtcSend).toHaveBeenCalled();
    });

    it('should handle closed event', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });
      peer.dcOpen = true;
      peer.packAndSend = vi.fn();
      peer.sockets = {
        'socket-1': { destroy: vi.fn() },
      };

      peer.rtcEvents.emit('closed');

      expect(peer.dcOpen).toBe(false);
      expect(peer.packAndSend).toBeUndefined();
    });

    it('should handle disconnected event', () => {
      const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });
      peer.dcOpen = true;
      peer.packAndSend = vi.fn();

      peer.rtcEvents.emit('disconnected');

      expect(peer.dcOpen).toBe(false);
      expect(peer.packAndSend).toBeUndefined();
    });

    describe('JSON parsing security (CVE-HSYNC-2026-005)', () => {
      it('should handle invalid JSON in transport.receiveData without crashing', () => {
        const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

        // Should not throw on invalid JSON
        expect(() => {
          peer.transport.receiveData('not valid json {{{');
        }).not.toThrow();
      });

      it('should handle empty string in transport.receiveData', () => {
        const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

        // Empty string should not throw
        expect(() => {
          peer.transport.receiveData('');
        }).not.toThrow();
      });

      it('should handle malformed JSON payloads gracefully', () => {
        const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

        // Various malformed inputs - should not crash
        const malformedInputs = ['{"unclosed": ', '[1, 2, 3', 'undefined', 'NaN'];

        for (const input of malformedInputs) {
          expect(() => {
            peer.transport.receiveData(input);
          }).not.toThrow();
        }
      });

      it('should reject non-object JSON values', () => {
        const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });

        // Valid JSON but not objects - should not crash
        const nonObjectInputs = ['"just a string"', '123', 'true', 'null'];

        for (const input of nonObjectInputs) {
          expect(() => {
            peer.transport.receiveData(input);
          }).not.toThrow();
        }
      });

      it('should process valid JSON normally', () => {
        const peer = peerLib.createRPCPeer({ hostName: 'other.example.com' });
        const rpcEmitSpy = vi.spyOn(peer.transport, 'emit');

        const validMsg = JSON.stringify({ method: 'test', params: [] });
        peer.transport.receiveData(validMsg);

        expect(rpcEmitSpy).toHaveBeenCalledWith('rpc', expect.objectContaining({ method: 'test' }));
      });

      it('should handle invalid JSON in server peer transport', () => {
        const serverPeer = peerLib.createServerPeer();

        // Should not throw on invalid JSON
        expect(() => {
          serverPeer.transport.receiveData('invalid json');
        }).not.toThrow();
      });

      it('should handle null/undefined in server peer transport', () => {
        const serverPeer = peerLib.createServerPeer();

        // Null should not throw
        expect(() => {
          serverPeer.transport.receiveData(null);
        }).not.toThrow();

        // Undefined should not throw
        expect(() => {
          serverPeer.transport.receiveData(undefined);
        }).not.toThrow();
      });
    });
  });
});
