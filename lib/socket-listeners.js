const b64id = require('b64id');
const debug = require('debug')('hsync:listener');
const debugError = require('debug')('hsync:error');

const { sockets } = require('./socket-map');

let net;

function setNet(netImpl) {
  net = netImpl;
}

debugError.color = 1;

function initListeners(hsyncClient) {
  const socketListeners = {};

  function getSocketListeners() {
    const hKeys = Object.keys(socketListeners);
    debug('getSocketListeners', hKeys);
    let retVal = hKeys.map((hk) => {
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
    debug('creating handler', port, targetHost);
    
    const rpcPeer = hsyncClient.getRPCPeer({ hostName: targetHost });

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
          port: targetPort,
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
        }
        catch(e) {
          debug('error closing socket', e);
        }
      });
    }

    const listener = {
      socketServer,
      sockets,
      end,
      targetHost,
      targetPort,
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

module.exports = { 
  initListeners,
  setNet,
};