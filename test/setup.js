import { vi } from 'vitest';

// Mock debug to prevent console output during tests
vi.mock('debug', () => ({
  default: () => {
    const debug = () => {};
    debug.color = 0;
    return debug;
  },
}));
