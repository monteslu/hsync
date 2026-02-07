import createDebug from 'debug';

const debug = createDebug('hsync:web');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let net;

export function setNet(netImpl) {
  net = netImpl;
}

// Security defaults
const DEFAULT_MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_CONCURRENT_SOCKETS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 1000; // 1 second
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100; // per window

/**
 * Validates that a message looks like a valid HTTP request.
 * This is a basic sanity check for the HTTP proxy use case.
 * @param {Buffer} message - The message to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateHttpRequest(message) {
  if (!Buffer.isBuffer(message)) {
    return { valid: false, reason: 'Message must be a Buffer' };
  }

  if (message.length === 0) {
    return { valid: false, reason: 'Empty message' };
  }

  // For HTTP requests, check for valid method at start
  const firstLine = message
    .slice(0, Math.min(message.length, 200))
    .toString('utf8')
    .split('\r\n')[0];

  // Valid HTTP methods
  const httpMethods = [
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
  const startsWithMethod = httpMethods.some((method) => firstLine.startsWith(method + ' '));

  if (!startsWithMethod) {
    // Could be a continuation of a previous request (body data)
    // or websocket frame, which is valid for existing sockets
    return { valid: true, isInitialRequest: false };
  }

  // Check for HTTP version
  if (!firstLine.includes('HTTP/')) {
    return { valid: false, reason: 'Invalid HTTP request line' };
  }

  return { valid: true, isInitialRequest: true };
}

/**
 * Simple rate limiter using sliding window
 */
class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map(); // socketId -> [timestamps]
  }

  isAllowed(socketId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(socketId) || [];

    // Remove old timestamps outside window
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.requests.set(socketId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.requests.set(socketId, timestamps);
    return true;
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [socketId, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((ts) => ts > windowStart);
      if (valid.length === 0) {
        this.requests.delete(socketId);
      } else {
        this.requests.set(socketId, valid);
      }
    }
  }
}

export function createWebHandler({
  myHostName,
  localHost,
  port,
  mqConn,
  // Security options
  maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
  maxConcurrentSockets = DEFAULT_MAX_CONCURRENT_SOCKETS,
  validateRequests = true,
  enableRateLimiting = true,
  rateLimitWindowMs = DEFAULT_RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
}) {
  const sockets = {};
  const rateLimiter = enableRateLimiting
    ? new RateLimiter(rateLimitWindowMs, rateLimitMaxRequests)
    : null;

  // Periodic cleanup of rate limiter state
  let cleanupInterval;
  if (rateLimiter) {
    cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60000);
    // Don't block process exit
    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }

  function handleWebRequest(hostName, socketId, action, message) {
    // Security: Validate hostname matches
    if (hostName !== myHostName) {
      return; // why did this get sent to me?
    }

    // Security: Validate socketId format (should be alphanumeric/dash)
    if (!socketId || !/^[\w-]+$/.test(socketId)) {
      debugError('Invalid socketId format:', socketId);
      return;
    }

    // Security: Check rate limiting
    if (rateLimiter && !rateLimiter.isAllowed(socketId)) {
      debugError('Rate limit exceeded for socket:', socketId);
      return;
    }

    // Security: Validate message size
    if (message && message.length > maxMessageSize) {
      debugError('Message exceeds max size:', message.length, '>', maxMessageSize);
      return;
    }

    if (socketId) {
      let socket = sockets[socketId];
      if (action === 'close') {
        if (socket) {
          socket.end();
          delete sockets[socket.socketId];
          return;
        }
        return;
      } else if (!socket) {
        // Security: Check concurrent socket limit
        const currentSocketCount = Object.keys(sockets).length;
        if (currentSocketCount >= maxConcurrentSockets) {
          debugError('Max concurrent sockets reached:', currentSocketCount);
          return;
        }

        // Security: Validate initial HTTP request format
        if (validateRequests && message) {
          const validation = validateHttpRequest(message);
          if (!validation.valid) {
            debugError('Invalid request rejected:', validation.reason);
            return;
          }
          // For NEW sockets, we require a valid HTTP request (not continuation data)
          if (!validation.isInitialRequest) {
            debugError('Non-HTTP initial request rejected');
            return;
          }
        }

        socket = new net.Socket();
        socket.socketId = socketId;
        sockets[socketId] = socket;
        socket.on('data', (data) => {
          if (!socket.dataRecieved) {
            const logData = data.slice(0, 200).toString().split('\r\n')[0];
            debug(`↑ ${logData}${logData.length > 60 ? '…' : ''}`);
            socket.dataRecieved = true;
          } else {
            debug(`→ ${socket.socketId}`, data.length, '↑');
          }

          mqConn.publish(`reply/${myHostName}/${socketId}`, data);
        });
        socket.on('close', () => {
          debug('close', myHostName, socket.socketId);
          mqConn.publish(`close/${myHostName}/${socketId}`, '');
          delete sockets[socket.socketId];
        });
        socket.on('error', (err) => {
          delete sockets[socket.socketId];
          debugError('error connecting', localHost, port, err);
        });
        socket.connect(port, localHost, () => {
          debug(`\nCONNECTED TO ${localHost}:${port}`, socket.socketId);
          debug('← ' + message.slice(0, 200).toString().split('\r\n')[0], message.length);
          socket.write(message);
        });
        return;
      }

      // Security: For existing sockets, still validate message size (already done above)
      // and check it's a Buffer
      if (!Buffer.isBuffer(message)) {
        debugError('Invalid message type for existing socket');
        return;
      }

      debug('←', socketId, message.length);
      socket.write(message);
    }
  }

  function end() {
    // Clear rate limiter cleanup interval
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }

    const sockKeys = Object.keys(sockets);
    sockKeys.forEach((sk) => {
      try {
        sockets[sk].end();
        delete sockets[sk];
      } catch (e) {
        debug('error closing socket', e);
      }
    });
  }

  /**
   * Get current security stats for monitoring
   */
  function getStats() {
    return {
      activeSockets: Object.keys(sockets).length,
      maxConcurrentSockets,
      maxMessageSize,
      rateLimitingEnabled: enableRateLimiting,
    };
  }

  return {
    handleWebRequest,
    sockets,
    end,
    getStats,
    // Exported for testing
    validateHttpRequest,
  };
}
