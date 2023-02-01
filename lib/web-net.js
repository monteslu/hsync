const EventEmitter = require('events').EventEmitter;

const events = new EventEmitter();

const listeners = {};

function Socket() {
  const socket = new EventEmitter();
  
  socket.connect = function(port, host, clientCallback) {
    events.emit(('socket_connect_' + port), {
      port,
      host,
      clientSocket: socket,
      clientCallback,
    });  
  }

  socket.write = function(message) {
    if (socket.serverSocket) {
      socket.serverSocket.emit('data', message);
    }
  };

  socket.end = function() {
    if (socket.serverSocket) {
      socket.serverSocket.emit('close');
    }
    
  }

  return socket;
}

function createServer(cb) {
  const server = new EventEmitter();
  server.listen = (port) => {
    console.log('server.listen', port);
    listeners['l' + port] = server;
    events.on('socket_connect_' + port, ({ clientSocket, clientCallback }) => {
      console.log('socket_connect_' + port, clientSocket);
      const serverSocket = new EventEmitter();
      clientSocket.serverSocket = serverSocket;
      if (server.cb) {
        server.cb(serverSocket);
      }
      serverSocket.write = (data) => {
        clientSocket.emit('data', data);
      }
      serverSocket.end = () => {
        clientSocket.emit('close');
      }
      
      if (clientCallback) {
        clientCallback();
      }
    });
  };
  server.cb = cb;
  return server;
}

module.exports = {
  Socket,
  createServer,
  events,
};
