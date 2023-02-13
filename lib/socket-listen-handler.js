const b64id = require('b64id');
const debug = require('debug')('hsync:listener');
const debugError = require('debug')('hsync:error');
// const { getRTCPeer } = require('./data-channel');

const { getRPCPeer } = require('./rpc');

let net;

function setNet(netImpl) {
  net = netImpl;
}


debugError.color = 1;

const sockets = {};

// function receiveRelayData(socketId, data) {
//   if (sockets[socketId]) {
//     debug('receiveRelayData', socketId, data.length);
//     sockets[socketId].write(data);
//   }
// }

function receiveRelayData(requestInfo, { socketId, data }) {
  debug('receiveRelayData', socketId, data, 'sockets', Object.keys(sockets));
  if (!sockets[socketId]) {
    throw new Error('listener has no matching socket for relay: ' + socketId);
  }
  let dataBuffer = data;
  if (typeof dataBuffer === 'string') {
    dataBuffer = Buffer.from(dataBuffer, 'base64');
  }
  sockets[socketId].write(dataBuffer);
  return 'ok';
}

function createSocketListenHandler({hostName, port, targetPort, targetHost, hsyncClient}) {
  debug('creating handler', hostName, port, targetPort, targetHost);
  
  const rpcPeer = getRPCPeer({hostName, hsyncClient});

  debug('peer crated');

  const socketServer = net.createServer(async (socket) => {

    socket.socketId = b64id.generateId();
    sockets[socket.socketId] = socket;
    debug('connected to local listener', port, socket.socketId);
    socket.peerConnected = false;
    const pubTopic = `msg/${hostName}/${hsyncClient.myHostName}/socketData/${socket.socketId}`;
    const closeTopic = `msg/${hostName}/${hsyncClient.myHostName}/socketClose/${socket.socketId}`;
    const dataQueue = [];

    async function sendData(data) {
      debug('sending data', hostName, data.length);
      // const p = getRTCPeer(hostName, hsyncClient);
      // if (p.connected) {
      //   p.send(`socketData/${socket.socketId}`, data);
      //   return;
      // }
      // hsyncClient.mqConn.publish(pubTopic, data);
      const result = await rpcPeer.methods.receiveListenerData({
        socketId: socket.socketId,
        data: Buffer.from(data).toString('base64'),
      });
      debug('sendData from Listener', result);
    }

    socket.on('data', async (data) => {
      debug('socket data', data?.length);
      // if (!socket.peerConnected) {
      //   dataQueue.push(data);
      //   return;
      // }
      sendData(data);
    });
  
    socket.on('close', () => {
      debug('listener socket closed', port, socket.socketId);
      if (sockets[socket.socketId]) {
        delete sockets[socket.socketId];
      }
      // hsyncClient.mqConn.publish(closeTopic, '');
    });
  
    socket.on('error', (error) => {
      debug('socket error', hostName, socket.socketId, error);
      if (sockets[socket.socketId]) {
        delete sockets[socket.socketId];
      }
      // hsyncClient.mqConn.publish(closeTopic, '');
    });
  
    try {
      debug('connecting remotely', socket.socketId, targetPort);
      const result = await rpcPeer.methods.connectSocket({socketId: socket.socketId, port: targetPort});
      debug('connect result', result);
      socket.peerConnected = true;
      dataQueue.forEach(sendData);
      // const p = getRTCPeer(hostName, hsyncClient);
      // if (p.pc) {
      //   p.createDC();
      // }
      
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
  createSocketListenHandler,
  receiveRelayData,
  setNet,
};