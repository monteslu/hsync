import { vi } from 'vitest';
import { EventEmitter } from 'events';

export function createMockSocket() {
  const socket = new EventEmitter();
  socket.write = vi.fn();
  socket.end = vi.fn();
  socket.destroy = vi.fn();
  socket.connect = vi.fn();
  socket.setEncoding = vi.fn();
  socket.setTimeout = vi.fn();
  return socket;
}

export function createMockServer() {
  const server = new EventEmitter();
  server.listen = vi.fn((port, callback) => {
    if (callback) callback();
    return server;
  });
  server.close = vi.fn((callback) => {
    if (callback) callback();
  });
  server.address = vi.fn(() => ({ port: 3000 }));
  return server;
}

export function createMockNet() {
  return {
    createConnection: vi.fn(() => createMockSocket()),
    createServer: vi.fn(() => createMockServer()),
    Socket: vi.fn(() => createMockSocket()),
  };
}
