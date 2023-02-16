const debug = require('debug')('hsync:socket-map');
const sockets = {};

function handleSocketPacket(packet) {
  const [topic, socketId] = packet.topic.split('/');
  const socket = sockets[socketId];
  if (!socket) {
    return;
  }
  if (topic === 'socketData') {
    debug('socketData', typeof packet.payload, packet.payload, !!socket.listenerSocket);
    socket.write(Buffer.from(packet.payload));
  }
}

module.exports = {
  sockets,
  handleSocketPacket,
};