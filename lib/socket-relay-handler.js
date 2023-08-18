const debug = require('debug')('hsync:relay');
const debugError = require('debug')('hsync:error');
const { getRPCPeer } = require('./peers');
const { sockets } = require('./socket-map');

debugError.color = 1;

let net;

function setNet(netImpl) {
  net = netImpl;
}

const relays = {};

function receiveListenerData(remotePeer, { socketId, data }) {
  debug('receiveListenerData', socketId, data, 'sockets', Object.keys(sockets));
  if (!sockets[socketId]) {
    throw new Error('relay has no matching socket for listener : ' + socketId);
  }
  let dataBuffer = data;
  if (typeof dataBuffer === 'string') {
    dataBuffer = Buffer.from(dataBuffer, 'base64');
  }
  sockets[socketId].write(dataBuffer);
  return 'receiveListenerData ok';
}

function connectSocket(remotePeer, { hsyncClient, fromHost, port, socketId}) {
  const relay = relays['p' + port];
  debug('connect relay', port, socketId);
  if (!relay) {
    throw new Error('no relay found for port: ' + port);
  }
  // const rpcPeer = getRPCPeer({hostName: fromHost, hsyncClient});
  // const relayDataTopic = `msg/${hostName}/${hsyncClient.myHostName}/relayData/${socketId}`;
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.socketId = socketId;
    sockets[socketId] = socket;
    socket.connect(relay.targetPort, relay.targetHost, () => {
      debug(`CONNECTED TO LOCAL SERVER`, socket.socketId, socket.hostName);
      resolve({socketId, targetHost: relay.targetHost, targetPort: relay.targetPort});
    });

    socket.on('data', async (data) => {
      debug(`data in ${socket.socketId}`, relay.targetPort, relay.targetHost, data.length);
      if (remotePeer.packAndSend) {
        debug('sending relay data via rtc', socket.socketId, data.length);
        remotePeer.packAndSend(`socketData/${socket.socketId}`, Buffer.from(data));
        return;
      }
      const result = await remotePeer.methods.receiveRelayData({
        socketId,
        data: Buffer.from(data).toString('base64'),
      });
      // const p = getRTCPeer(hostName, hsyncClient);
      // if (p.connected) {
      //   p.send(`relayData/${socketId}`, data);
      //   return;
      // }
      // hsyncClient.mqConn.publish(relayDataTopic, data);
    });
    socket.on('close', () => {
      debug(`LOCAL CONNECTION CLOSED`, socket.socketId, targetHost, targetPort);
      delete sockets[socket.socketId];
    });

    socket.on('error', (e) => {
      debugError(`LOCAL CONNECTION ERROR`, socket.socketId, targetHost, targetPort, e);
      delete sockets[socket.socketId];
      reject(e);
    });
  
  });

}

// function receiveSocketData(socketId, data) {
//   if (sockets[socketId]) {
//     debug('receiveSocketData', socketId, data.length);
//     sockets[socketId].write(data);
//     return 'ok';
//   }

//   throw new Error('socket not found: ' + socketId);
// }

function createSocketRelayHandler({hostName, port, targetPort, targetHost, hsyncClient}) {
  debug('creating relay', hostName, port, targetPort, targetHost);
  relays['p' + port] = {
    hostName,
    port,
    targetPort,
    targetHost,
  };
}

module.exports = {
  createSocketRelayHandler,
  connectSocket,
  // receiveSocketData,
  setNet,
  receiveListenerData,
};