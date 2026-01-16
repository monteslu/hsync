import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('fetch', () => {
  let apiFetch;
  let mockFetch;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    const apiModule = await import('../../lib/fetch.js');
    apiFetch = apiModule.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be a function', () => {
    expect(typeof apiFetch).toBe('function');
  });

  it('should have post, put, and del methods', () => {
    expect(typeof apiFetch.post).toBe('function');
    expect(typeof apiFetch.put).toBe('function');
    expect(typeof apiFetch.del).toBe('function');
  });

  describe('apiFetch', () => {
    it('should call fetch with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ data: 'test' }),
      });

      await apiFetch('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should parse JSON responses', async () => {
      const mockData = { key: 'value' };
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve(mockData),
      });

      const result = await apiFetch('/test');

      expect(result).toEqual(mockData);
    });

    it('should parse text responses', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'text/plain',
        },
        text: () => Promise.resolve('plain text'),
      });

      const result = await apiFetch('/test');

      expect(result).toBe('plain text');
    });

    it('should throw error on 4xx/5xx responses', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 404,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ error: 'Not found' }),
      });

      await expect(apiFetch('/test')).rejects.toThrow('Bad response from server');
    });

    it('should stringify object body', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({}),
      });

      await apiFetch('/test', { body: { foo: 'bar' } });

      expect(mockFetch).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          body: '{"foo":"bar"}',
        })
      );
    });

    it('should append query string', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({}),
      });

      await apiFetch('/test', { query: { foo: 'bar', baz: 'qux' } });

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/test?'), expect.any(Object));
    });
  });

  describe('apiFetch.post', () => {
    it('should call apiFetch with POST method', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ success: true }),
      });

      await apiFetch.post('/test', { data: 'value' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('apiFetch.put', () => {
    it('should call apiFetch with PUT method', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ success: true }),
      });

      await apiFetch.put('/test', { data: 'value' });

      expect(mockFetch).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          method: 'PUT',
        })
      );
    });
  });

  describe('apiFetch.del', () => {
    it('should call apiFetch with DELETE method', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve({ success: true }),
      });

      await apiFetch.del('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        '/test',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });
});
