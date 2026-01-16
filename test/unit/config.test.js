import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should export default config with baseConfig properties', async () => {
    const { default: config, baseConfig } = await import('../../config.js');

    expect(config).toBeDefined();
    expect(config.localHost).toBe('localhost');
    expect(config.port).toBe(3000);
    expect(config.hsyncBase).toBe('_hs');
    expect(config.keepalive).toBe(300);
    expect(config.defaultDynamicHost).toBe('https://demo.hsync.tech');
    expect(baseConfig).toBeDefined();
  });

  it('should have connections array with at least one connection', async () => {
    const { default: config } = await import('../../config.js');

    expect(config.connections).toBeDefined();
    expect(Array.isArray(config.connections)).toBe(true);
    expect(config.connections.length).toBeGreaterThanOrEqual(1);
  });

  it('should include baseConfig as first connection', async () => {
    const { default: config, baseConfig } = await import('../../config.js');

    const firstConnection = config.connections[0];
    expect(firstConnection.localHost).toBe(baseConfig.localHost);
    expect(firstConnection.port).toBe(baseConfig.port);
    expect(firstConnection.hsyncBase).toBe(baseConfig.hsyncBase);
  });
});
