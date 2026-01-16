import createDebug from 'debug';
import { sockets } from './socket-map.js';

const debug = createDebug('hsync:relay');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let net;

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

    //  TODO: check white and black lists on peer

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
