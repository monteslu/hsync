import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initUdpRelays, setDgram } from '../../lib/udp-relays.js';

describe('udp-relays', () => {
  let mockDgram;
  let mockSocket;
  let mockHsyncClient;
  let messageHandler;
  let _errorHandler;
  let listeningHandler;

  beforeEach(() => {
    messageHandler = null;
    _errorHandler = null;
    listeningHandler = null;

    mockSocket = {
      relayPort: null,
      bind: vi.fn(),
      close: vi.fn(),
      send: vi.fn((data, port, host, cb) => cb && cb()),
      address: vi.fn(() => ({ address: '0.0.0.0', port: 5000 })),
      addMembership: vi.fn(),
      on: vi.fn((event, handler) => {
        if (event === 'message') messageHandler = handler;
        if (event === 'error') _errorHandler = handler;
        if (event === 'listening') listeningHandler = handler;
      }),
    };

    mockDgram = {
      createSocket: vi.fn(() => mockSocket),
    };

    mockHsyncClient = {
      myHostName: 'local.example.com',
    };

    setDgram(mockDgram);
  });

  describe('setDgram', () => {
    it('should set the dgram implementation', () => {
      const customDgram = { createSocket: vi.fn() };
      setDgram(customDgram);
      // No error means success
    });
  });

  describe('initUdpRelays', () => {
    it('should return object with required methods', () => {
      const udpRelays = initUdpRelays(mockHsyncClient);

      expect(udpRelays.addUdpRelay).toBeTypeOf('function');
      expect(udpRelays.getUdpRelays).toBeTypeOf('function');
      expect(udpRelays.sendUdpMessage).toBeTypeOf('function');
      expect(udpRelays.removeUdpRelay).toBeTypeOf('function');
      expect(udpRelays.closeAllUdpRelays).toBeTypeOf('function');
    });

    it('should attach methods to hsyncClient', () => {
      initUdpRelays(mockHsyncClient);

      expect(mockHsyncClient.cachedUdpRelays).toBeTypeOf('object');
      expect(mockHsyncClient.udpSockets).toBeTypeOf('object');
      expect(mockHsyncClient.addUdpRelay).toBeTypeOf('function');
      expect(mockHsyncClient.getUdpRelays).toBeTypeOf('function');
      expect(mockHsyncClient.sendUdpMessage).toBeTypeOf('function');
    });
  });

  describe('addUdpRelay', () => {
    let udpRelays;

    beforeEach(() => {
      udpRelays = initUdpRelays(mockHsyncClient);
    });

    it('should create UDP socket and bind to port', () => {
      udpRelays.addUdpRelay({ port: 5000 });

      expect(mockDgram.createSocket).toHaveBeenCalledWith('udp4');
      expect(mockSocket.bind).toHaveBeenCalledWith(5000);
    });

    it('should use localhost as default target host', () => {
      const relay = udpRelays.addUdpRelay({ port: 5000 });

      expect(relay.targetHost).toBe('localhost');
    });

    it('should use same port as default target port', () => {
      const relay = udpRelays.addUdpRelay({ port: 5000 });

      expect(relay.targetPort).toBe(5000);
    });

    it('should store relay with custom options', () => {
      const relay = udpRelays.addUdpRelay({
        port: 5000,
        targetPort: 6000,
        targetHost: 'remote.local',
        whitelist: 'allowed.com',
        blacklist: 'blocked.com',
      });

      expect(relay.port).toBe(5000);
      expect(relay.targetPort).toBe(6000);
      expect(relay.targetHost).toBe('remote.local');
      expect(relay.whitelist).toBe('allowed.com');
      expect(relay.blacklist).toBe('blocked.com');
    });

    it('should support multicast group', () => {
      udpRelays.addUdpRelay({ port: 5000, multicast: '239.1.2.3' });

      // Trigger listening handler to join multicast
      listeningHandler();

      expect(mockSocket.addMembership).toHaveBeenCalledWith('239.1.2.3');
    });

    it('should call udpMessageHandler on incoming message', () => {
      mockHsyncClient.udpMessageHandler = vi.fn();
      udpRelays.addUdpRelay({ port: 5000 });

      // Simulate incoming message
      const testData = Buffer.from('test message');
      const rinfo = { address: '192.168.1.1', port: 12345 };
      messageHandler(testData, rinfo);

      expect(mockHsyncClient.udpMessageHandler).toHaveBeenCalledWith({
        port: 5000,
        data: testData,
        remoteAddress: '192.168.1.1',
        remotePort: 12345,
      });
    });
  });

  describe('getUdpRelays', () => {
    let udpRelays;

    beforeEach(() => {
      udpRelays = initUdpRelays(mockHsyncClient);
    });

    it('should return empty array when no relays', () => {
      const result = udpRelays.getUdpRelays();

      expect(result).toEqual([]);
    });

    it('should return relay info', () => {
      udpRelays.addUdpRelay({
        port: 5000,
        targetPort: 6000,
        targetHost: 'remote.local',
      });

      const result = udpRelays.getUdpRelays();

      expect(result).toHaveLength(1);
      expect(result[0].port).toBe(5000);
      expect(result[0].targetHost).toBe('remote.local');
      expect(result[0].targetPort).toBe(6000);
    });
  });

  describe('sendUdpMessage', () => {
    let udpRelays;

    beforeEach(() => {
      udpRelays = initUdpRelays(mockHsyncClient);
    });

    it('should throw if no relay found for port', () => {
      expect(() =>
        udpRelays.sendUdpMessage({ port: 9999, data: Buffer.from('test') })
      ).toThrow('no UDP relay found for port: 9999');
    });

    it('should send data to target host and port', async () => {
      udpRelays.addUdpRelay({
        port: 5000,
        targetPort: 6000,
        targetHost: 'remote.local',
      });

      const data = Buffer.from('test message');
      const result = await udpRelays.sendUdpMessage({ port: 5000, data });

      expect(mockSocket.send).toHaveBeenCalledWith(data, 6000, 'remote.local', expect.any(Function));
      expect(result.sent).toBe(data.length);
      expect(result.host).toBe('remote.local');
      expect(result.port).toBe(6000);
    });

    it('should allow overriding target host and port', async () => {
      udpRelays.addUdpRelay({ port: 5000 });

      const data = Buffer.from('test');
      await udpRelays.sendUdpMessage({
        port: 5000,
        data,
        targetHost: 'override.local',
        targetPort: 7000,
      });

      expect(mockSocket.send).toHaveBeenCalledWith(
        data,
        7000,
        'override.local',
        expect.any(Function)
      );
    });
  });

  describe('removeUdpRelay', () => {
    let udpRelays;

    beforeEach(() => {
      udpRelays = initUdpRelays(mockHsyncClient);
    });

    it('should close socket and remove relay', () => {
      udpRelays.addUdpRelay({ port: 5000 });

      udpRelays.removeUdpRelay(5000);

      expect(mockSocket.close).toHaveBeenCalled();
      expect(udpRelays.getUdpRelays()).toHaveLength(0);
    });
  });

  describe('closeAllUdpRelays', () => {
    let udpRelays;

    beforeEach(() => {
      udpRelays = initUdpRelays(mockHsyncClient);
    });

    it('should close all sockets and clear relays', () => {
      const socket1 = { ...mockSocket, close: vi.fn() };
      const socket2 = { ...mockSocket, close: vi.fn() };
      let socketIndex = 0;
      mockDgram.createSocket = vi.fn(() => (socketIndex++ === 0 ? socket1 : socket2));

      udpRelays.addUdpRelay({ port: 5000 });
      udpRelays.addUdpRelay({ port: 5001 });

      udpRelays.closeAllUdpRelays();

      expect(socket1.close).toHaveBeenCalled();
      expect(socket2.close).toHaveBeenCalled();
      expect(udpRelays.getUdpRelays()).toHaveLength(0);
    });
  });
});
