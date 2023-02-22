const debug = require('debug')('hsync:socket-map');
const sockets = {};

function handleSocketPacket(packet) {
  const [topic, socketId] = packet.topic.split('/');
  const socket = sockets[socketId];
  if (!socket) {
    return;
  }
  if (topic === 'socketData') {
    debug('socketData', typeof packet.payload, !!socket.listenerSocket, packet.payload.length);
    socket.write(packet.payload);
  }
}

module.exports = {
  sockets,
  handleSocketPacket,
};