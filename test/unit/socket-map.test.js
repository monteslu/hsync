import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sockets, handleSocketPacket } from '../../lib/socket-map.js';

describe('socket-map', () => {
  beforeEach(() => {
    // Clear sockets before each test
    Object.keys(sockets).forEach((key) => delete sockets[key]);
  });

  describe('sockets', () => {
    it('should be an empty object initially', () => {
      expect(sockets).toBeDefined();
      expect(typeof sockets).toBe('object');
    });

    it('should allow adding sockets', () => {
      const mockSocket = { write: vi.fn() };
      sockets['test-id'] = mockSocket;

      expect(sockets['test-id']).toBe(mockSocket);
    });
  });

  describe('handleSocketPacket', () => {
    it('should do nothing if socket is not found', () => {
      const packet = {
        topic: 'socketData/unknown-id',
        payload: Buffer.from('test'),
      };

      // Should not throw
      expect(() => handleSocketPacket(packet)).not.toThrow();
    });

    it('should write data to socket when socketData topic is received', () => {
      const mockSocket = { write: vi.fn() };
      sockets['socket-123'] = mockSocket;

      const payload = Buffer.from('test data');
      const packet = {
        topic: 'socketData/socket-123',
        payload,
      };

      handleSocketPacket(packet);

      expect(mockSocket.write).toHaveBeenCalledWith(payload);
    });

    it('should not write for non-socketData topics', () => {
      const mockSocket = { write: vi.fn() };
      sockets['socket-123'] = mockSocket;

      const packet = {
        topic: 'otherTopic/socket-123',
        payload: Buffer.from('test'),
      };

      handleSocketPacket(packet);

      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });
});
