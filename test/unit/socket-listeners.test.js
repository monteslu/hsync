import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initListeners, setNet } from '../../lib/socket-listeners.js';

describe('socket-listeners', () => {
  let mockNet;
  let mockSocket;
  let mockServer;
  let mockHsyncClient;
  let mockRpcPeer;

  beforeEach(() => {
    mockSocket = {
      socketId: null,
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      connect: vi.fn((port, host, cb) => cb && cb()),
    };

    mockServer = {
      listen: vi.fn(),
      close: vi.fn(),
    };

    mockNet = {
      Socket: vi.fn(() => mockSocket),
      createServer: vi.fn((handler) => {
        mockServer.connectionHandler = handler;
        return mockServer;
      }),
    };

    mockRpcPeer = {
      hostName: 'remote.example.com',
      rtcCon: null,
      connectRTC: vi.fn().mockResolvedValue({}),
      notifications: {
        oncloseListenerSocket: vi.fn(),
      },
      notifiers: {
        closeRelaySocket: vi.fn(),
      },
      methods: {
        connectSocket: vi.fn().mockResolvedValue({ socketId: 'test-id' }),
      },
      sockets: {},
      packAndSend: vi.fn(),
    };

    mockHsyncClient = {
      myHostName: 'local.example.com',
      getRPCPeer: vi.fn(() => mockRpcPeer),
    };

    setNet(mockNet);
  });

  describe('setNet', () => {
    it('should set the net implementation', () => {
      const customNet = { Socket: vi.fn(), createServer: vi.fn() };
      setNet(customNet);
      // No error means success
    });
  });

  describe('initListeners', () => {
    it('should return object with required methods', () => {
      const listeners = initListeners(mockHsyncClient);

      expect(listeners.addSocketListener).toBeTypeOf('function');
      expect(listeners.getSocketListeners).toBeTypeOf('function');
    });

    it('should attach methods to hsyncClient', () => {
      initListeners(mockHsyncClient);

      expect(mockHsyncClient.socketListeners).toBeTypeOf('object');
      expect(mockHsyncClient.addSocketListener).toBeTypeOf('function');
      expect(mockHsyncClient.getSocketListeners).toBeTypeOf('function');
    });
  });

  describe('addSocketListener', () => {
    let listeners;

    beforeEach(() => {
      listeners = initListeners(mockHsyncClient);
    });

    it('should throw if no targetHost', () => {
      expect(() => listeners.addSocketListener({ port: 3000 })).toThrow('no targetHost');
    });

    it('should throw if targetHost is same as client', () => {
      expect(() =>
        listeners.addSocketListener({
          port: 3000,
          targetHost: 'https://local.example.com',
        })
      ).toThrow('targetHost must be a different host');
    });

    it('should clean trailing slash from targetHost', () => {
      const listener = listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com/',
      });

      expect(listener.targetHost).toBe('https://remote.example.com');
    });

    it('should create socket server', () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      expect(mockNet.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(3000);
    });

    it('should return listener object with properties', () => {
      const listener = listeners.addSocketListener({
        port: 3000,
        targetPort: 4000,
        targetHost: 'https://remote.example.com',
      });

      expect(listener.port).toBe(3000);
      expect(listener.targetPort).toBe(4000);
      expect(listener.targetHost).toBe('https://remote.example.com');
      expect(listener.socketServer).toBe(mockServer);
      expect(listener.end).toBeTypeOf('function');
    });

    it('should use port as targetPort if not specified', () => {
      const listener = listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      expect(listener.targetPort).toBe(3000);
    });

    it('should get RPC peer for targetHost', () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      expect(mockHsyncClient.getRPCPeer).toHaveBeenCalledWith({
        hostName: 'https://remote.example.com',
      });
    });

    it('should store listener by port key', () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      expect(mockHsyncClient.socketListeners['p3000']).toBeDefined();
    });
  });

  describe('getSocketListeners', () => {
    let listeners;

    beforeEach(() => {
      listeners = initListeners(mockHsyncClient);
    });

    it('should return empty array when no listeners', () => {
      const result = listeners.getSocketListeners();

      expect(result).toEqual([]);
    });

    it('should return listener info', () => {
      listeners.addSocketListener({
        port: 3000,
        targetPort: 4000,
        targetHost: 'https://remote.example.com',
      });

      const result = listeners.getSocketListeners();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        port: 3000,
        targetHost: 'https://remote.example.com',
        targetPort: 4000,
        hasPassword: false,
      });
    });

    it('should return multiple listeners', () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote1.example.com',
      });
      listeners.addSocketListener({
        port: 4000,
        targetHost: 'https://remote2.example.com',
      });

      const result = listeners.getSocketListeners();

      expect(result).toHaveLength(2);
    });
  });

  describe('listener connection handler', () => {
    let listeners;

    beforeEach(() => {
      listeners = initListeners(mockHsyncClient);
    });

    it('should initiate RTC connection if not connected', async () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      // Simulate incoming connection
      const incomingSocket = {
        socketId: null,
        on: vi.fn(),
        end: vi.fn(),
      };

      await mockServer.connectionHandler(incomingSocket);

      expect(mockRpcPeer.connectRTC).toHaveBeenCalled();
    });

    it('should not initiate RTC if already connected', async () => {
      mockRpcPeer.rtcCon = {}; // Already connected

      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      const incomingSocket = {
        socketId: null,
        on: vi.fn(),
        end: vi.fn(),
      };

      await mockServer.connectionHandler(incomingSocket);

      expect(mockRpcPeer.connectRTC).not.toHaveBeenCalled();
    });

    it('should end socket if RTC connection fails', async () => {
      mockRpcPeer.connectRTC.mockRejectedValue(new Error('RTC failed'));

      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      const incomingSocket = {
        socketId: null,
        on: vi.fn(),
        end: vi.fn(),
      };

      await mockServer.connectionHandler(incomingSocket);

      expect(incomingSocket.end).toHaveBeenCalled();
    });

    it('should assign socketId to incoming socket', async () => {
      mockRpcPeer.rtcCon = {};

      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
      });

      const incomingSocket = {
        socketId: null,
        on: vi.fn(),
        end: vi.fn(),
      };

      await mockServer.connectionHandler(incomingSocket);

      expect(incomingSocket.socketId).toBeTypeOf('string');
    });

    it('should call connectSocket on peer', async () => {
      mockRpcPeer.rtcCon = {};

      listeners.addSocketListener({
        port: 3000,
        targetPort: 4000,
        targetHost: 'https://remote.example.com',
      });

      const incomingSocket = {
        socketId: null,
        on: vi.fn(),
        end: vi.fn(),
      };

      await mockServer.connectionHandler(incomingSocket);

      expect(mockRpcPeer.methods.connectSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 4000,
          hostName: 'remote.example.com',
        })
      );
    });

    it('should pass password to connectSocket', async () => {
      listeners.addSocketListener({
        port: 3000,
        targetPort: 4000,
        targetHost: 'https://remote.example.com',
        password: 'secret123',
      });

      // Trigger socket connection
      const connectionHandler = mockNet.createServer.mock.calls[0][0];
      connectionHandler(mockSocket);

      // Wait for connection attempt
      await vi.waitFor(() => {
        expect(mockRpcPeer.methods.connectSocket).toHaveBeenCalled();
      });

      expect(mockRpcPeer.methods.connectSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          password: 'secret123',
        })
      );
    });
  });

  describe('addSocketListener with password', () => {
    let listeners;

    beforeEach(() => {
      listeners = initListeners(mockHsyncClient);
    });

    it('should store password in listener', () => {
      const listener = listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
        password: 'secret123',
      });

      expect(listener.password).toBe('secret123');
    });

    it('should indicate hasPassword in getSocketListeners', () => {
      listeners.addSocketListener({
        port: 3000,
        targetHost: 'https://remote.example.com',
        password: 'secret123',
      });

      const result = listeners.getSocketListeners();

      expect(result[0].hasPassword).toBe(true);
      // Password should NOT be exposed
      expect(result[0].password).toBeUndefined();
    });
  });
});
