import createDebug from 'debug';
import { sockets } from './socket-map.js';

const debug = createDebug('hsync:relay');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let net;

/**
 * Check if a hostname matches a pattern (supports wildcards)
 * @param {string} hostName - The hostname to check
 * @param {string} pattern - Pattern to match (e.g., 'example.com', '*.example.com', '*')
 * @returns {boolean}
 */
function matchHost(hostName, pattern) {
  if (!hostName || !pattern) return false;
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    // Wildcard subdomain match: *.example.com matches foo.example.com
    const suffix = pattern.slice(1); // .example.com
    return hostName.endsWith(suffix) || hostName === pattern.slice(2);
  }
  return hostName === pattern;
}

/**
 * Check if a host is allowed based on whitelist/blacklist
 * @param {string} hostName - The hostname to check
 * @param {string} whitelist - Comma-separated list of allowed hosts/patterns
 * @param {string} blacklist - Comma-separated list of blocked hosts/patterns
 * @returns {boolean}
 */
export function isHostAllowed(hostName, whitelist, blacklist) {
  // If blacklist contains the host, reject
  if (blacklist) {
    const blacklisted = blacklist.split(',').map(h => h.trim()).filter(Boolean);
    if (blacklisted.some(pattern => matchHost(hostName, pattern))) {
      debug('host %s blocked by blacklist', hostName);
      return false;
    }
  }

  // If whitelist is set, host must be in it
  if (whitelist) {
    const whitelisted = whitelist.split(',').map(h => h.trim()).filter(Boolean);
    const allowed = whitelisted.some(pattern => matchHost(hostName, pattern));
    if (!allowed) {
      debug('host %s not in whitelist', hostName);
    }
    return allowed;
  }

  // No restrictions - allow all
  return true;
}

export function setNet(netImpl) {
  net = netImpl;
}

export function initRelays(hsyncClient) {
  const cachedRelays = {};

  function getSocketRelays() {
    const hKeys = Object.keys(cachedRelays);
    debug('getSocketListeners', hKeys);
    const retVal = hKeys.map((hk) => {
      const l = cachedRelays[hk];
      return {
        port: l.port,
        targetHost: l.targetHost,
        targetPort: l.targetPort,
        whitelist: l.whitelist || '',
        blacklist: l.blacklist || '',
        hostName: l.targetHost,
      };
    });
    return retVal;
  }

  function connectSocket(peer, { port, socketId, hostName }) {
    debug('connectSocket', port, socketId, hostName);

    peer.notifications.oncloseRelaySocket((peer, { socketId }) => {
      debug('closeRelaySocket', socketId);
      if (sockets[socketId]) {
        sockets[socketId].end();
        delete sockets[socketId];
        return 'closeRelaySocket ok';
      }
      return `closeRelaySocket no matching socket for ${socketId}`;
    });

    const relay = cachedRelays['p' + port];
    debug('connect relay', port, socketId, peer.hostName);
    if (!relay) {
      throw new Error('no relay found for port: ' + port);
    }

    // Check whitelist/blacklist before allowing connection
    if (!isHostAllowed(peer.hostName, relay.whitelist, relay.blacklist)) {
      throw new Error(`host ${peer.hostName} not allowed for relay on port ${port}`);
    }

    // const relayDataTopic = `msg/${hostName}/${hsyncClient.myHostName}/relayData/${socketId}`;
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.socketId = socketId;
      sockets[socketId] = socket;
      socket.connect(relay.targetPort, relay.targetHost, () => {
        debug(`CONNECTED TO LOCAL SERVER`, socket.socketId, socket.hostName, port);
        resolve({ socketId, targetHost: relay.targetHost, targetPort: relay.targetPort });
      });

      socket.on('data', async (data) => {
        debug(`data in ${socket.socketId}`, relay.targetPort, relay.targetHost, data.length);
        // TODO: queue data if peer is not ready
        if (peer.packAndSend) {
          debug('sending relay data via rtc', socket.socketId, data.length);
          peer.packAndSend(`socketData/${socket.socketId}`, Buffer.from(data));
          return;
        }
      });
      socket.on('close', async () => {
        debug(`LOCAL CONNECTION CLOSED`, socket.socketId);
        if (sockets[socket.socketId]) {
          try {
            await peer.notifiers.closeListenerSocket({ socketId });
          } catch (e) {
            debug('error closing socket', e);
          }
          delete sockets[socket.socketId];
        }
      });

      socket.on('error', (e) => {
        debugError(`LOCAL CONNECTION ERROR`, socket.socketId, e);
        delete sockets[socket.socketId];
        reject(e);
      });
    });
  }

  function addSocketRelay({ whitelist, blacklist, port, targetPort, targetHost }) {
    targetPort = targetPort || port;
    targetHost = targetHost || 'localhost';
    debug('creating relay', whitelist, blacklist, port, targetPort, targetHost);
    const newRelay = {
      whitelist,
      blacklist,
      port,
      targetPort,
      targetHost,
      hostName: targetHost,
    };
    cachedRelays['p' + port] = newRelay;
    return newRelay;
  }

  hsyncClient.cachedRelays = cachedRelays;
  hsyncClient.addSocketRelay = addSocketRelay;
  hsyncClient.getSocketRelays = getSocketRelays;
  hsyncClient.connectSocket = connectSocket;

  return {
    // receiveListenerData,
    getSocketRelays,
    connectSocket,
    addSocketRelay,
  };
}
