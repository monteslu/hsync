const rawr = require('rawr');
const b64id = require('b64id');
const debug = require('debug')('hsync:rpc');
const EventEmitter = require('events').EventEmitter;
// const { peerMethods } = require('./peer-methods');

const peers = {};

function getRPCPeer({hostName, temporary, timeout = 10000, hsyncClient}) {
  let peer = peers[hostName];
  if (!peer) {
    peer = createRPCPeer({hostName, hsyncClient, timeout, methods: hsyncClient.peerMethods});
    if (temporary) {
      peer.rpcTemporary = true;
    }
    peers[hostName] = peer;
  }
  return peer;
}


function createRPCPeer({ hostName, hsyncClient, timeout = 10000, methods = {} }) {
  if (!hostName) {
    throw new Error('No hostname specified');
  }
  if (hostName === hsyncClient.myHostName) {
    throw new Error('Peer must be a different host');
  }
  const transport = new EventEmitter();
  transport.send = (msg) => {
    if(typeof msg === 'object') {
      msg = JSON.stringify(msg);
    }
    const topic = `msg/${hostName}/${hsyncClient.myHostName}/rpc`;
    debug('↑ peer rpc', topic, msg);
    hsyncClient.mqConn.publish(topic, Buffer.from(msg));
  };
  transport.receiveData = (msg) => {
    debug('↓ peer rpc', msg);
    if(msg) {
      msg = JSON.parse(msg);
    }
    if (Array.isArray(msg.params)) {
      msg.params.unshift(hostName);
    }
    transport.emit('rpc', msg);
  };

  const peer = rawr({transport, methods: Object.assign({}, methods), timeout, idGenerator: b64id.generateId});
  return peer;
  
}

function createServerReplyPeer({ requestId, hsyncClient, methods = {}}) {

  const transport = new EventEmitter();
  transport.send = (msg) => {
    if(typeof msg === 'object') {
      msg = JSON.stringify(msg);
    }
    const topic = `ssrpc/${hsyncClient.myHostName}/${requestId}`;
    debug('↑ server rpc reply', msg);
    hsyncClient.mqConn.publish(topic, Buffer.from(msg));
  };
  transport.receiveData = (msg) => {
    debug('↓ server rpc', msg);
    if(msg) {
      msg = JSON.parse(msg);
    }
    transport.emit('rpc', msg);
  };

  const peer = rawr({transport, methods});
  return peer;
}

module.exports = {
  createRPCPeer,
  createServerReplyPeer,
  getRPCPeer,
};