import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initRelays, setNet, isHostAllowed } from '../../lib/socket-relays.js';
import { sockets } from '../../lib/socket-map.js';

describe('isHostAllowed', () => {
  it('should allow all hosts when no whitelist or blacklist', () => {
    expect(isHostAllowed('any.host.com', '', '')).toBe(true);
    expect(isHostAllowed('any.host.com', null, null)).toBe(true);
    expect(isHostAllowed('any.host.com', undefined, undefined)).toBe(true);
  });

  it('should block hosts in blacklist', () => {
    expect(isHostAllowed('blocked.com', '', 'blocked.com')).toBe(false);
    expect(isHostAllowed('allowed.com', '', 'blocked.com')).toBe(true);
  });

  it('should support comma-separated blacklist', () => {
    const blacklist = 'bad1.com, bad2.com, bad3.com';
    expect(isHostAllowed('bad1.com', '', blacklist)).toBe(false);
    expect(isHostAllowed('bad2.com', '', blacklist)).toBe(false);
    expect(isHostAllowed('good.com', '', blacklist)).toBe(true);
  });

  it('should only allow hosts in whitelist when set', () => {
    expect(isHostAllowed('allowed.com', 'allowed.com', '')).toBe(true);
    expect(isHostAllowed('other.com', 'allowed.com', '')).toBe(false);
  });

  it('should support comma-separated whitelist', () => {
    const whitelist = 'good1.com, good2.com';
    expect(isHostAllowed('good1.com', whitelist, '')).toBe(true);
    expect(isHostAllowed('good2.com', whitelist, '')).toBe(true);
    expect(isHostAllowed('bad.com', whitelist, '')).toBe(false);
  });

  it('should support wildcard * to match all', () => {
    expect(isHostAllowed('any.host.com', '*', '')).toBe(true);
  });

  it('should support wildcard subdomain matching', () => {
    expect(isHostAllowed('sub.example.com', '*.example.com', '')).toBe(true);
    expect(isHostAllowed('deep.sub.example.com', '*.example.com', '')).toBe(true);
    expect(isHostAllowed('example.com', '*.example.com', '')).toBe(true);
    expect(isHostAllowed('other.com', '*.example.com', '')).toBe(false);
  });

  it('should check blacklist before whitelist', () => {
    // If host is blacklisted, reject even if it would match whitelist
    expect(isHostAllowed('blocked.com', '*', 'blocked.com')).toBe(false);
  });

  it('should handle empty host gracefully', () => {
    expect(isHostAllowed('', 'allowed.com', '')).toBe(false);
    expect(isHostAllowed(null, 'allowed.com', '')).toBe(false);
  });
});

describe('socket-relays', () => {
  let mockNet;
  let mockSocket;
  let mockHsyncClient;
  let mockPeer;

  beforeEach(() => {
    mockSocket = {
      socketId: null,
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      connect: vi.fn((port, host, cb) => cb && cb()),
    };

    // Create mock net module with class-based constructor
    mockNet = {
      Socket: class MockSocket {
        constructor() {
          Object.assign(this, mockSocket);
        }
      },
    };

    mockPeer = {
      hostName: 'remote.example.com',
      notifications: {
        oncloseRelaySocket: vi.fn(),
      },
      notifiers: {
        closeListenerSocket: vi.fn(),
      },
      packAndSend: vi.fn(),
    };

    mockHsyncClient = {
      myHostName: 'local.example.com',
    };

    setNet(mockNet);
  });

  describe('setNet', () => {
    it('should set the net implementation', () => {
      const customNet = { Socket: vi.fn() };
      setNet(customNet);
      // No error means success
    });
  });

  describe('initRelays', () => {
    it('should return object with required methods', () => {
      const relays = initRelays(mockHsyncClient);

      expect(relays.addSocketRelay).toBeTypeOf('function');
      expect(relays.getSocketRelays).toBeTypeOf('function');
      expect(relays.connectSocket).toBeTypeOf('function');
    });

    it('should attach methods to hsyncClient', () => {
      initRelays(mockHsyncClient);

      expect(mockHsyncClient.cachedRelays).toBeTypeOf('object');
      expect(mockHsyncClient.addSocketRelay).toBeTypeOf('function');
      expect(mockHsyncClient.getSocketRelays).toBeTypeOf('function');
      expect(mockHsyncClient.connectSocket).toBeTypeOf('function');
    });
  });

  describe('addSocketRelay', () => {
    let relays;

    beforeEach(() => {
      relays = initRelays(mockHsyncClient);
    });

    it('should add relay with provided options', () => {
      const relay = relays.addSocketRelay({
        port: 3000,
        targetPort: 4000,
        targetHost: 'myserver.local',
        whitelist: 'allowed.com',
        blacklist: 'blocked.com',
      });

      expect(relay.port).toBe(3000);
      expect(relay.targetPort).toBe(4000);
      expect(relay.targetHost).toBe('myserver.local');
      expect(relay.whitelist).toBe('allowed.com');
      expect(relay.blacklist).toBe('blocked.com');
    });

    it('should use port as targetPort if not specified', () => {
      const relay = relays.addSocketRelay({
        port: 3000,
      });

      expect(relay.targetPort).toBe(3000);
    });

    it('should use localhost as targetHost if not specified', () => {
      const relay = relays.addSocketRelay({
        port: 3000,
      });

      expect(relay.targetHost).toBe('localhost');
    });

    it('should store relay by port key', () => {
      relays.addSocketRelay({
        port: 3000,
      });

      expect(mockHsyncClient.cachedRelays['p3000']).toBeDefined();
    });

    it('should set hostName same as targetHost', () => {
      const relay = relays.addSocketRelay({
        port: 3000,
        targetHost: 'myserver.local',
      });

      expect(relay.hostName).toBe('myserver.local');
    });
  });

  describe('getSocketRelays', () => {
    let relays;

    beforeEach(() => {
      relays = initRelays(mockHsyncClient);
    });

    it('should return empty array when no relays', () => {
      const result = relays.getSocketRelays();

      expect(result).toEqual([]);
    });

    it('should return relay info', () => {
      relays.addSocketRelay({
        port: 3000,
        targetPort: 4000,
        targetHost: 'myserver.local',
        whitelist: 'allowed.com',
        blacklist: 'blocked.com',
      });

      const result = relays.getSocketRelays();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        port: 3000,
        targetHost: 'myserver.local',
        targetPort: 4000,
        whitelist: 'allowed.com',
        blacklist: 'blocked.com',
        hostName: 'myserver.local',
      });
    });

    it('should return multiple relays', () => {
      relays.addSocketRelay({ port: 3000 });
      relays.addSocketRelay({ port: 4000 });

      const result = relays.getSocketRelays();

      expect(result).toHaveLength(2);
    });

    it('should return empty strings for undefined whitelist/blacklist', () => {
      relays.addSocketRelay({
        port: 3000,
      });

      const result = relays.getSocketRelays();

      expect(result[0].whitelist).toBe('');
      expect(result[0].blacklist).toBe('');
    });
  });

  describe('connectSocket', () => {
    let relays;

    beforeEach(() => {
      relays = initRelays(mockHsyncClient);
    });

    it('should throw if no relay found for port', () => {
      expect(() =>
        relays.connectSocket(mockPeer, {
          port: 9999,
          socketId: 'test-socket',
          hostName: 'remote.example.com',
        })
      ).toThrow('no relay found for port: 9999');
    });

    it('should create socket and connect to relay target', async () => {
      relays.addSocketRelay({
        port: 3000,
        targetPort: 4000,
        targetHost: 'myserver.local',
      });

      const result = await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'remote.example.com',
      });

      // Verify socket was connected to correct target
      expect(mockSocket.connect).toHaveBeenCalledWith(4000, 'myserver.local', expect.any(Function));
      expect(result.socketId).toBe('test-socket');
      expect(result.targetHost).toBe('myserver.local');
      expect(result.targetPort).toBe(4000);
    });

    it('should assign socketId to created socket', async () => {
      relays.addSocketRelay({
        port: 3000,
      });

      await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'my-socket-id',
        hostName: 'remote.example.com',
      });

      // Socket should be stored in sockets map with the socketId
      expect(sockets['my-socket-id']).toBeDefined();
      expect(sockets['my-socket-id'].socketId).toBe('my-socket-id');
    });

    it('should register oncloseRelaySocket notification', async () => {
      relays.addSocketRelay({
        port: 3000,
      });

      await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'remote.example.com',
      });

      expect(mockPeer.notifications.oncloseRelaySocket).toHaveBeenCalled();
    });

    it('should register socket event handlers', async () => {
      relays.addSocketRelay({
        port: 3000,
      });

      await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'remote.example.com',
      });

      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should send data via RTC when packAndSend available', async () => {
      relays.addSocketRelay({
        port: 3000,
      });

      await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'remote.example.com',
      });

      // Get the data handler
      const dataHandler = mockSocket.on.mock.calls.find((call) => call[0] === 'data')[1];
      const testData = Buffer.from('test data');
      dataHandler(testData);

      expect(mockPeer.packAndSend).toHaveBeenCalledWith(
        'socketData/test-socket',
        expect.any(Buffer)
      );
    });

    it('should reject on socket error', async () => {
      relays.addSocketRelay({
        port: 3000,
      });

      // Make connect call the error handler instead
      mockSocket.connect = vi.fn((_port, _host, _cb) => {
        // Don't call success callback
      });

      const connectPromise = relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'remote.example.com',
      });

      // Get error handler and call it
      const errorHandler = mockSocket.on.mock.calls.find((call) => call[0] === 'error')[1];
      errorHandler(new Error('Connection failed'));

      await expect(connectPromise).rejects.toThrow('Connection failed');
    });

    it('should reject connection when host is blacklisted', () => {
      relays.addSocketRelay({
        port: 3000,
        blacklist: 'blocked.example.com',
      });

      mockPeer.hostName = 'blocked.example.com';

      expect(() =>
        relays.connectSocket(mockPeer, {
          port: 3000,
          socketId: 'test-socket',
          hostName: 'blocked.example.com',
        })
      ).toThrow('host blocked.example.com not allowed for relay on port 3000');
    });

    it('should reject connection when host not in whitelist', () => {
      relays.addSocketRelay({
        port: 3000,
        whitelist: 'allowed.example.com',
      });

      mockPeer.hostName = 'other.example.com';

      expect(() =>
        relays.connectSocket(mockPeer, {
          port: 3000,
          socketId: 'test-socket',
          hostName: 'other.example.com',
        })
      ).toThrow('host other.example.com not allowed for relay on port 3000');
    });

    it('should allow connection when host is whitelisted', async () => {
      relays.addSocketRelay({
        port: 3000,
        whitelist: 'allowed.example.com',
      });

      mockPeer.hostName = 'allowed.example.com';

      const result = await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'allowed.example.com',
      });

      expect(result.socketId).toBe('test-socket');
    });

    it('should allow connection when host not blacklisted', async () => {
      relays.addSocketRelay({
        port: 3000,
        blacklist: 'blocked.example.com',
      });

      mockPeer.hostName = 'allowed.example.com';

      const result = await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'allowed.example.com',
      });

      expect(result.socketId).toBe('test-socket');
    });

    it('should support wildcard whitelist patterns', async () => {
      relays.addSocketRelay({
        port: 3000,
        whitelist: '*.trusted.com',
      });

      mockPeer.hostName = 'agent.trusted.com';

      const result = await relays.connectSocket(mockPeer, {
        port: 3000,
        socketId: 'test-socket',
        hostName: 'agent.trusted.com',
      });

      expect(result.socketId).toBe('test-socket');
    });
  });
});
