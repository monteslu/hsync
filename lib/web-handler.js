import createDebug from 'debug';

const debug = createDebug('hsync:web');
const debugError = createDebug('hsync:error');

debugError.color = 1;

let net;

export function setNet(netImpl) {
  net = netImpl;
}

export function createWebHandler({ myHostName, localHost, port, mqConn }) {
  const sockets = {};

  function handleWebRequest(hostName, socketId, action, message) {
    if (hostName !== myHostName) {
      return; // why did this get sent to me?
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

      debug('←', socketId, message.length);
      socket.write(message);
    }
  }

  function end() {
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

  return {
    handleWebRequest,
    sockets,
    end,
  };
}
