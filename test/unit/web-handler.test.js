import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebHandler, setNet, validateHttpRequest } from '../../lib/web-handler.js';

describe('web-handler', () => {
  let mockNet;
  let mockSocket;
  let mockMqConn;

  beforeEach(() => {
    // Create mock socket
    mockSocket = {
      socketId: null,
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      connect: vi.fn((port, host, cb) => cb()),
    };

    // Create mock net module with class-based constructor
    mockNet = {
      Socket: class MockSocket {
        constructor() {
          Object.assign(this, mockSocket);
        }
      },
    };

    // Create mock MQTT connection
    mockMqConn = {
      publish: vi.fn(),
    };

    setNet(mockNet);
  });

  describe('setNet', () => {
    it('should set the net implementation', () => {
      const customNet = { Socket: vi.fn() };
      setNet(customNet);
      // No error means success - net is used internally
    });
  });

  describe('createWebHandler', () => {
    it('should return handler with required methods', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });

      expect(handler.handleWebRequest).toBeTypeOf('function');
      expect(handler.sockets).toBeTypeOf('object');
      expect(handler.end).toBeTypeOf('function');
    });

    it('should start with empty sockets', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });

      expect(Object.keys(handler.sockets)).toHaveLength(0);
    });
  });

  describe('handleWebRequest', () => {
    let handler;

    beforeEach(() => {
      handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });
    });

    afterEach(() => {
      handler.end();
    });

    it('should ignore requests for different hostnames', () => {
      handler.handleWebRequest('other.example.com', 'socket-123', null, Buffer.from('test'));

      // Socket should not be created for different hostname
      expect(handler.sockets['socket-123']).toBeUndefined();
    });

    it('should create new socket for new socketId', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      // Verify socket was created and connected
      expect(handler.sockets['socket-123']).toBeDefined();
      expect(mockSocket.connect).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
    });

    it('should store socket in sockets map', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      expect(handler.sockets['socket-123']).toBeDefined();
    });

    it('should write message to socket after connect', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      expect(mockSocket.write).toHaveBeenCalledWith(message);
    });

    it('should handle close action', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      // First create a socket
      handler.handleWebRequest('test.example.com', 'socket-123', null, message);
      expect(handler.sockets['socket-123']).toBeDefined();

      // Now close it
      handler.handleWebRequest('test.example.com', 'socket-123', 'close', Buffer.from(''));

      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should ignore close for non-existent socket', () => {
      handler.handleWebRequest('test.example.com', 'nonexistent', 'close', Buffer.from(''));

      // Should not throw
      expect(mockSocket.end).not.toHaveBeenCalled();
    });

    it('should reuse existing socket for same socketId', () => {
      const message1 = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      const message2 = Buffer.from('second message');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message1);
      handler.handleWebRequest('test.example.com', 'socket-123', null, message2);

      // Socket should only be connected once (reused for second message)
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      // But write should be called twice (once on connect, once for second message)
      expect(mockSocket.write).toHaveBeenCalledTimes(2);
    });

    it('should register socket event handlers', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should publish reply on socket data', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      const responseData = Buffer.from('HTTP/1.1 200 OK\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      // Get the data handler and call it
      const dataHandler = mockSocket.on.mock.calls.find((call) => call[0] === 'data')[1];
      dataHandler(responseData);

      expect(mockMqConn.publish).toHaveBeenCalledWith(
        'reply/test.example.com/socket-123',
        responseData
      );
    });

    it('should publish close on socket close', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      // Get the close handler and call it
      const closeHandler = mockSocket.on.mock.calls.find((call) => call[0] === 'close')[1];
      closeHandler();

      expect(mockMqConn.publish).toHaveBeenCalledWith('close/test.example.com/socket-123', '');
    });
  });

  describe('end', () => {
    it('should close all sockets', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });

      // Create some sockets
      handler.handleWebRequest(
        'test.example.com',
        'socket-1',
        null,
        Buffer.from('GET / HTTP/1.1\r\n\r\n')
      );
      handler.handleWebRequest(
        'test.example.com',
        'socket-2',
        null,
        Buffer.from('GET / HTTP/1.1\r\n\r\n')
      );

      handler.end();

      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should handle errors when closing sockets', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });

      mockSocket.end = vi.fn(() => {
        throw new Error('socket error');
      });

      handler.handleWebRequest(
        'test.example.com',
        'socket-1',
        null,
        Buffer.from('GET / HTTP/1.1\r\n\r\n')
      );

      // Should not throw
      expect(() => handler.end()).not.toThrow();
    });
  });

  // Security feature tests
  describe('Security: validateHttpRequest', () => {
    it('should validate GET request', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\nHost: example.com\r\n\r\n');
      const result = validateHttpRequest(message);
      expect(result.valid).toBe(true);
      expect(result.isInitialRequest).toBe(true);
    });

    it('should validate POST request', () => {
      const message = Buffer.from('POST /api/data HTTP/1.1\r\nHost: example.com\r\n\r\n');
      const result = validateHttpRequest(message);
      expect(result.valid).toBe(true);
      expect(result.isInitialRequest).toBe(true);
    });

    it('should validate all HTTP methods', () => {
      const methods = [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'HEAD',
        'OPTIONS',
        'CONNECT',
        'TRACE',
      ];
      for (const method of methods) {
        const message = Buffer.from(`${method} / HTTP/1.1\r\n\r\n`);
        const result = validateHttpRequest(message);
        expect(result.valid).toBe(true);
        expect(result.isInitialRequest).toBe(true);
      }
    });

    it('should reject empty message', () => {
      const message = Buffer.from('');
      const result = validateHttpRequest(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Empty message');
    });

    it('should reject non-Buffer input', () => {
      const result = validateHttpRequest('not a buffer');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Message must be a Buffer');
    });

    it('should accept non-HTTP data for existing sockets (continuation)', () => {
      const message = Buffer.from('some raw data that is not HTTP');
      const result = validateHttpRequest(message);
      expect(result.valid).toBe(true);
      expect(result.isInitialRequest).toBe(false);
    });

    it('should reject malformed HTTP request line', () => {
      const message = Buffer.from('GET /path\r\n\r\n'); // Missing HTTP version
      const result = validateHttpRequest(message);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid HTTP request line');
    });
  });

  describe('Security: Message size limits', () => {
    it('should reject messages exceeding max size', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        maxMessageSize: 100, // Small limit for testing
      });

      const largeMessage = Buffer.alloc(150, 'x');
      handler.handleWebRequest('test.example.com', 'socket-123', null, largeMessage);

      expect(handler.sockets['socket-123']).toBeUndefined();
      handler.end();
    });

    it('should accept messages within size limit', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        maxMessageSize: 1000,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      expect(handler.sockets['socket-123']).toBeDefined();
      handler.end();
    });
  });

  describe('Security: Concurrent socket limits', () => {
    it('should reject new sockets when limit is reached', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        maxConcurrentSockets: 2,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', 'socket-1', null, message);
      handler.handleWebRequest('test.example.com', 'socket-2', null, message);
      handler.handleWebRequest('test.example.com', 'socket-3', null, message);

      expect(handler.sockets['socket-1']).toBeDefined();
      expect(handler.sockets['socket-2']).toBeDefined();
      expect(handler.sockets['socket-3']).toBeUndefined();
      handler.end();
    });
  });

  describe('Security: Rate limiting', () => {
    it('should allow requests within rate limit', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        enableRateLimiting: true,
        rateLimitWindowMs: 1000,
        rateLimitMaxRequests: 5,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      // First request should create socket
      handler.handleWebRequest('test.example.com', 'socket-1', null, message);
      expect(handler.sockets['socket-1']).toBeDefined();
      handler.end();
    });

    it('should block requests exceeding rate limit', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        enableRateLimiting: true,
        rateLimitWindowMs: 10000, // Long window
        rateLimitMaxRequests: 3,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      const socketId = 'rate-limited-socket';

      // Make 3 requests (at limit)
      handler.handleWebRequest('test.example.com', socketId, null, message);
      handler.handleWebRequest('test.example.com', socketId, null, message);
      handler.handleWebRequest('test.example.com', socketId, null, message);

      // Reset write mock to check next call
      mockSocket.write.mockClear();

      // 4th request should be blocked
      handler.handleWebRequest('test.example.com', socketId, null, message);

      // Write should not be called for the blocked request
      expect(mockSocket.write).not.toHaveBeenCalled();
      handler.end();
    });

    it('should work without rate limiting when disabled', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        enableRateLimiting: false,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      const socketId = 'unlimited-socket';

      // Make many requests
      for (let i = 0; i < 10; i++) {
        handler.handleWebRequest('test.example.com', socketId, null, message);
      }

      // All should succeed (socket created on first, writes on subsequent)
      expect(handler.sockets[socketId]).toBeDefined();
      // 1 connect write + 9 subsequent writes = 10 writes
      expect(mockSocket.write).toHaveBeenCalledTimes(10);
      handler.end();
    });
  });

  describe('Security: socketId validation', () => {
    let handler;

    beforeEach(() => {
      handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });
    });

    afterEach(() => {
      handler.end();
    });

    it('should accept valid socketId formats', () => {
      const validIds = ['socket-123', 'abc_def', 'ABC123', 'a1b2c3'];
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      for (const id of validIds) {
        handler.handleWebRequest('test.example.com', id, null, message);
        expect(handler.sockets[id]).toBeDefined();
      }
    });

    it('should reject empty socketId', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      handler.handleWebRequest('test.example.com', '', null, message);
      handler.handleWebRequest('test.example.com', null, null, message);
      handler.handleWebRequest('test.example.com', undefined, null, message);

      expect(Object.keys(handler.sockets)).toHaveLength(0);
    });

    it('should reject socketId with special characters', () => {
      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');
      const invalidIds = ['socket/../etc/passwd', 'socket;rm -rf /', 'socket\x00null'];

      for (const id of invalidIds) {
        handler.handleWebRequest('test.example.com', id, null, message);
      }

      expect(Object.keys(handler.sockets)).toHaveLength(0);
    });
  });

  describe('Security: HTTP request validation', () => {
    it('should reject non-HTTP initial requests when validation enabled', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        validateRequests: true,
      });

      const maliciousPayload = Buffer.from('HELO evil.com\r\nMAIL FROM:<attacker>\r\n');
      handler.handleWebRequest('test.example.com', 'socket-123', null, maliciousPayload);

      // Socket should not be created for non-HTTP request
      expect(handler.sockets['socket-123']).toBeUndefined();
      handler.end();
    });

    it('should accept any data when validation disabled', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        validateRequests: false,
      });

      const anyData = Buffer.from('any raw data here');
      handler.handleWebRequest('test.example.com', 'socket-123', null, anyData);

      expect(handler.sockets['socket-123']).toBeDefined();
      handler.end();
    });
  });

  describe('Security: getStats', () => {
    it('should return security stats', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
        maxConcurrentSockets: 50,
        maxMessageSize: 5000000,
        enableRateLimiting: true,
      });

      const stats = handler.getStats();

      expect(stats.activeSockets).toBe(0);
      expect(stats.maxConcurrentSockets).toBe(50);
      expect(stats.maxMessageSize).toBe(5000000);
      expect(stats.rateLimitingEnabled).toBe(true);
      handler.end();
    });

    it('should track active socket count', () => {
      const handler = createWebHandler({
        myHostName: 'test.example.com',
        localHost: 'localhost',
        port: 3000,
        mqConn: mockMqConn,
      });

      const message = Buffer.from('GET / HTTP/1.1\r\n\r\n');

      expect(handler.getStats().activeSockets).toBe(0);

      handler.handleWebRequest('test.example.com', 'socket-1', null, message);
      expect(handler.getStats().activeSockets).toBe(1);

      handler.handleWebRequest('test.example.com', 'socket-2', null, message);
      expect(handler.getStats().activeSockets).toBe(2);

      handler.end();
    });
  });
});
