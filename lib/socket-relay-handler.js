const net = require('net');
const b64id = require('b64id');
const debug = require('debug')('hsync:relay');
const debugError = require('debug')('hsync:error');
const { getRTCPeer } = require('./data-channel');

debugError.color = 1;

const relays = {};
const sockets = {};

function connectRelaySocket({socketId, hostName, targetPort, targetHost = 'localhost', hsyncClient}) {
  // TODO auth check in relays map
  const relayDataTopic = `msg/${hostName}/${hsyncClient.myHostName}/relayData/${socketId}`;
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.socketId = socketId;
    sockets[socketId] = socket;
    socket.connect(targetPort, targetHost, () => {
      debug(`CONNECTED TO LOCAL SERVER`, socket.socketId, socket.hostName);
      resolve({socketId, hostName});
    });

    socket.on('data', (data) => {
      debug(`data in ${socket.socketId}`, targetHost, targetPort, data.length);
      const p = getRTCPeer(hostName, hsyncClient);
      if (p.connected) {
        p.send(`relayData/${socketId}`, data);
        return;
      }
      hsyncClient.mqConn.publish(relayDataTopic, data);
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

function receiveSocketData(socketId, data) {
  if (sockets[socketId]) {
    debug('receiveSocketData', socketId, data.length);
    sockets[socketId].write(data);
  }
}

function createSocketRelayHandler({hostName, port, targetPort, targetHost, hsyncClient}) {
  debug('creating handler', hostName, port, targetPort, targetHost);

}

module.exports = {
  createSocketRelayHandler,
  connectRelaySocket,
  receiveSocketData,
};