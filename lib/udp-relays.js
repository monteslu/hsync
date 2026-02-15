import createDebug from 'debug';

const debug = createDebug('hsync:udp-relay');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let dgram;

export function setDgram(dgramImpl) {
  dgram = dgramImpl;
}

export function initUdpRelays(hsyncClient) {
  const cachedUdpRelays = {};
  const udpSockets = {};

  function getUdpRelays() {
    const keys = Object.keys(cachedUdpRelays);
    debug('getUdpRelays', keys);
    return keys.map((key) => {
      const relay = cachedUdpRelays[key];
      return {
        port: relay.port,
        targetHost: relay.targetHost,
        targetPort: relay.targetPort,
        whitelist: relay.whitelist || '',
        blacklist: relay.blacklist || '',
        multicast: relay.multicast || null,
      };
    });
  }

  function addUdpRelay({ whitelist, blacklist, port, targetPort, targetHost, multicast }) {
    targetPort = targetPort || port;
    targetHost = targetHost || 'localhost';
    debug('creating UDP relay', whitelist, blacklist, port, targetPort, targetHost, multicast);

    const newRelay = {
      whitelist,
      blacklist,
      port,
      targetPort,
      targetHost,
      multicast,
    };
    cachedUdpRelays['u' + port] = newRelay;

    // Create the UDP socket for this relay
    const socket = dgram.createSocket('udp4');
    socket.relayPort = port;
    udpSockets['u' + port] = socket;

    socket.on('message', (msg, rinfo) => {
      debug(`UDP message from ${rinfo.address}:${rinfo.port}`, msg.length, 'bytes');
      // Forward to peer via RTC if available
      if (hsyncClient.udpMessageHandler) {
        hsyncClient.udpMessageHandler({
          port,
          data: msg,
          remoteAddress: rinfo.address,
          remotePort: rinfo.port,
        });
      }
    });

    socket.on('error', (err) => {
      debugError('UDP socket error', port, err);
      socket.close();
      delete udpSockets['u' + port];
    });

    socket.on('listening', () => {
      const address = socket.address();
      debug(`UDP relay listening on ${address.address}:${address.port}`);

      // Join multicast group if specified
      if (multicast) {
        try {
          socket.addMembership(multicast);
          debug(`Joined multicast group ${multicast}`);
        } catch (e) {
          debugError('Failed to join multicast group', multicast, e);
        }
      }
    });

    socket.bind(port);

    return newRelay;
  }

  function sendUdpMessage({ port, data, targetHost, targetPort }) {
    const relay = cachedUdpRelays['u' + port];
    if (!relay) {
      throw new Error('no UDP relay found for port: ' + port);
    }

    const socket = udpSockets['u' + port];
    if (!socket) {
      throw new Error('no UDP socket found for port: ' + port);
    }

    const host = targetHost || relay.targetHost;
    const destPort = targetPort || relay.targetPort;

    return new Promise((resolve, reject) => {
      socket.send(data, destPort, host, (err) => {
        if (err) {
          debugError('UDP send error', err);
          reject(err);
        } else {
          debug(`UDP sent ${data.length} bytes to ${host}:${destPort}`);
          resolve({ sent: data.length, host, port: destPort });
        }
      });
    });
  }

  function removeUdpRelay(port) {
    const key = 'u' + port;
    const socket = udpSockets[key];
    if (socket) {
      socket.close();
      delete udpSockets[key];
    }
    delete cachedUdpRelays[key];
    debug('removed UDP relay', port);
  }

  function closeAllUdpRelays() {
    Object.keys(udpSockets).forEach((key) => {
      const socket = udpSockets[key];
      if (socket) {
        socket.close();
      }
    });
    Object.keys(cachedUdpRelays).forEach((key) => {
      delete cachedUdpRelays[key];
    });
    Object.keys(udpSockets).forEach((key) => {
      delete udpSockets[key];
    });
    debug('closed all UDP relays');
  }

  // Attach to hsyncClient
  hsyncClient.cachedUdpRelays = cachedUdpRelays;
  hsyncClient.udpSockets = udpSockets;
  hsyncClient.addUdpRelay = addUdpRelay;
  hsyncClient.getUdpRelays = getUdpRelays;
  hsyncClient.sendUdpMessage = sendUdpMessage;
  hsyncClient.removeUdpRelay = removeUdpRelay;
  hsyncClient.closeAllUdpRelays = closeAllUdpRelays;

  return {
    getUdpRelays,
    addUdpRelay,
    sendUdpMessage,
    removeUdpRelay,
    closeAllUdpRelays,
  };
}
