import { vi } from 'vitest';
import { EventEmitter } from 'events';

export function createMockMqttClient() {
  const client = new EventEmitter();
  client.publish = vi.fn();
  client.subscribe = vi.fn();
  client.unsubscribe = vi.fn();
  client.end = vi.fn((force, callback) => {
    if (typeof force === 'function') {
      force();
    } else if (callback) {
      callback();
    }
  });
  return client;
}

export function createMockMqtt() {
  const mockClient = createMockMqttClient();
  return {
    connect: vi.fn(() => mockClient),
    _mockClient: mockClient,
  };
}
