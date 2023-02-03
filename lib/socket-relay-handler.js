const debug = require('debug')('hsync:relay');
const debugError = require('debug')('hsync:error');

const { createRPCPeer } = require('./rpc');

debugError.color = 1;

let net;

function setNet(netImpl) {
  net = netImpl;
}

function createHandler({hostName, port, targetPort, targetHost, hsyncClient}) {

  const sockets = {};
  
  const peer = createRPCPeer({hostName, hsyncClient});

  const socketServer = net.createServer(async (socket) => {

    socket.socketId = b64id.generateId();
    sockets[socket.socketId] = socket;
    socket.peerConnected = false;
    const pubTopic = `msg/${hostName}/${hsyncClient.username}/socketData/${socket.socketId}`;
    const closeTopic = `msg/${hostName}/${hsyncClient.username}/socketClose/${socket.socketId}`;
    const dataQueue = [];

    function sendData(data) {
      hsyncClient.mqConn.publish(pubTopic, data);
    }

    socket.on('data', async (data) => {
      if (!socket.peerConnected) {
        dataQueue.push(data);
        return;
      }
      sendData(data);
    });
  
    socket.on('close', () => {

      if (sockets[socket.socketId]) {
        delete sockets[socket.socketId];
      }
      hsyncClient.mqConn.publish(closeTopic, '');
    });
  
    socket.on('error', (error) => {
      debug('socket error', hostName, socket.socketId, error);
      if (sockets[socket.socketId]) {
        delete sockets[socket.socketId];
      }
      hsyncClient.mqConn.publish(closeTopic, '');
    });
  
    try {
      await peer.methods.connectSocket(targetPort, targetHost);
      dataQueue.forEach(sendData);
    } catch (e) {
      debugError('cant connect remotely', hostName, targetPort, e);
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
        sockets[sk].end();
        delete sockets[sk];
      }
      catch(e) {
        debug('error closing socket', e);
      }
    });
  }

  return {
    socketServer,
    sockets,
    end,
  };
}

module.exports = {
  createHandler,
  setNet,
};