import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebHandler, setNet } from '../../lib/web-handler.js';

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
      const message1 = Buffer.from('first message');
      const message2 = Buffer.from('second message');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message1);
      handler.handleWebRequest('test.example.com', 'socket-123', null, message2);

      // Socket should only be connected once (reused for second message)
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      // But write should be called twice (once on connect, once for second message)
      expect(mockSocket.write).toHaveBeenCalledTimes(2);
    });

    it('should register socket event handlers', () => {
      const message = Buffer.from('test');

      handler.handleWebRequest('test.example.com', 'socket-123', null, message);

      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should publish reply on socket data', () => {
      const message = Buffer.from('request');
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
      const message = Buffer.from('request');

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
      handler.handleWebRequest('test.example.com', 'socket-1', null, Buffer.from('test1'));
      handler.handleWebRequest('test.example.com', 'socket-2', null, Buffer.from('test2'));

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

      handler.handleWebRequest('test.example.com', 'socket-1', null, Buffer.from('test'));

      // Should not throw
      expect(() => handler.end()).not.toThrow();
    });
  });
});
