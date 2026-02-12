import b64id from 'b64id';
import createDebug from 'debug';
import { sockets } from './socket-map.js';

const debug = createDebug('hsync:listener');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let net;

// Localhost aliases that all refer to the same machine
const LOCALHOST_ALIASES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '0:0:0:0:0:0:0:1',
  '[::1]',
  '[0:0:0:0:0:0:0:1]',
]);

/**
 * Normalize a hostname for comparison
 * - Lowercase
 * - Remove trailing dots (DNS root)
 * - Strip IPv6 brackets
 * - Expand common IPv6 localhost representations
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  if (!hostname) return '';
  let normalized = hostname.toLowerCase().trim();
  
  // Remove trailing dot (DNS root indicator)
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1);
  }
  
  // Strip IPv6 brackets for comparison
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  
  return normalized;
}

/**
 * Check if two hostnames refer to the same host
 * Handles localhost aliases, IPv6, and normalization
 * @param {string} host1
 * @param {string} host2
 * @returns {boolean}
 */
export function isSameHost(host1, host2) {
  const norm1 = normalizeHostname(host1);
  const norm2 = normalizeHostname(host2);
  
  // Direct match after normalization
  if (norm1 === norm2) {
    return true;
  }
  
  // Check if both are localhost aliases
  if (LOCALHOST_ALIASES.has(norm1) && LOCALHOST_ALIASES.has(norm2)) {
    return true;
  }
  
  return false;
}

export function setNet(netImpl) {
  net = netImpl;
}

export function initListeners(hsyncClient) {
  const socketListeners = {};

  function getSocketListeners() {
    const hKeys = Object.keys(socketListeners);
    debug('getSocketListeners', hKeys);
    const retVal = hKeys.map((hk) => {
      const l = socketListeners[hk];
      return {
        port: l.port,
        targetHost: l.targetHost,
        targetPort: l.targetPort,
      };
    });
    return retVal;
  }

  function addSocketListener(options = {}) {
    const { port, targetPort, targetHost } = options;
    if (!targetHost) {
      throw new Error('no targetHost');
    }
    let cleanHost = targetHost.trim();
    if (cleanHost.endsWith('/')) {
      cleanHost = cleanHost.substring(0, cleanHost.length - 1);
    }
    const url = new URL(cleanHost);
    // Security: Use comprehensive hostname comparison to prevent bypass attacks
    // CVE-HSYNC-2026-006: Simple string comparison could be bypassed via
    // localhost aliases, IPv6, trailing dots, etc.
    if (isSameHost(url.hostname, hsyncClient.myHostName)) {
      throw new Error('targetHost must be a different host');
    }
    debug('creating handler', port, cleanHost);
    if (cleanHost !== targetHost) {
      debug('targetHost cleaned UP', targetHost, cleanHost);
    }

    const rpcPeer = hsyncClient.getRPCPeer({ hostName: cleanHost });

    const socketServer = net.createServer(async (socket) => {
      if (!rpcPeer.rtcCon) {
        try {
          debug('initiating connectRTC from socket listener');
          await rpcPeer.connectRTC();
        } catch (e) {
          debug('error connecting to rtc', e);
          socket.end();
          return;
        }
      }

      rpcPeer.notifications.oncloseListenerSocket((remotePeer, { socketId }) => {
        debug('closeListenerSocket', socketId, !!sockets[socketId]);
        if (sockets[socketId]) {
          sockets[socketId].end();
          delete sockets[socketId];
          return 'closeListenerSocket ok';
        }
        return `closeListenerSocket no matching socket for ${socketId}`;
      });

      socket.socketId = b64id.generateId();
      sockets[socket.socketId] = socket;
      rpcPeer.sockets[socket.socketId] = socket;
      socket.listenerSocket = true;
      debug('connected to local listener', port, socket.socketId);
      socket.peerConnected = false;
      // const pubTopic = `msg/${hostName}/${hsyncClient.myHostName}/socketData/${socket.socketId}`;
      // const closeTopic = `msg/${hostName}/${hsyncClient.myHostName}/socketClose/${socket.socketId}`;
      const dataQueue = [];

      async function sendData(data) {
        // TODO queue data if not connected
        if (rpcPeer.packAndSend) {
          debug('sending data via rtc', targetHost, socket.socketId, data.length);
          rpcPeer.packAndSend(`socketData/${socket.socketId}`, data);
          return;
        }
        // debug('sending data via rpc', targetHost, data.length);
        // // hsyncClient.mqConn.publish(pubTopic, data);
        // const result = await rpcPeer.methods.receiveListenerData({
        //   socketId: socket.socketId,
        //   data: Buffer.from(data).toString('base64'),
        // });
        // debug('sendData from Listener', result);
      }

      socket.on('data', async (data) => {
        debug('socket data', data ? data.length : '');
        // if (!socket.peerConnected) {
        //   dataQueue.push(data);
        //   return;
        // }
        sendData(data);
      });

      socket.on('close', (a, b, c) => {
        debug('listener socket closed', port, socket.socketId, a, b, c);
        if (sockets[socket.socketId]) {
          delete sockets[socket.socketId];
          try {
            rpcPeer.notifiers.closeRelaySocket({
              socketId: socket.socketId,
            });
          } catch (e) {
            debug('error closing relay socket', e);
          }
        }
      });

      socket.on('error', (error) => {
        debug('socket error', targetHost, socket.socketId, error);
        if (sockets[socket.socketId]) {
          delete sockets[socket.socketId];
        }
      });

      try {
        debug('connecting remotely', socket.socketId, targetPort, rpcPeer.hostName, targetHost);
        const result = await rpcPeer.methods.connectSocket({
          socketId: socket.socketId,
          port: targetPort || port,
          hostName: rpcPeer.hostName,
        });
        debug('connect result', result);
        socket.peerConnected = true;
        dataQueue.forEach(sendData);
      } catch (e) {
        debugError('cant connect remotely', targetHost, targetPort, e);
        if (sockets[socket.socketId]) {
          delete sockets[socket.socketId];
        }
        socket.end();
      }
    });

    socketServer.listen(port);

    function end() {
      const sockKeys = Object.keys(sockets);
      sockKeys.forEach((sk) => {
        try {
          if (sockets[sk].listenerSocket) {
            sockets[sk].end();
            delete sockets[sk];
          }
        } catch (e) {
          debug('error closing socket', e);
        }
      });
    }

    const listener = {
      socketServer,
      sockets,
      end,
      targetHost: cleanHost,
      targetPort: targetPort || port,
      port,
    };

    socketListeners['p' + port] = listener;
    return listener;
  }

  hsyncClient.socketListeners = socketListeners;
  hsyncClient.addSocketListener = addSocketListener;
  // hsyncClient.receiveRelayData = receiveRelayData;
  hsyncClient.getSocketListeners = getSocketListeners;
  // hsyncClient.closeListenerSocket = closeListenerSocket;

  return {
    addSocketListener,
    // receiveRelayData,
    getSocketListeners,
  };
}
