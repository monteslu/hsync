const rawr = require('rawr');
const b64id = require('b64id');
const debug = require('debug')('hsync:rpc');
const EventEmitter = require('events').EventEmitter;

function createRPCPeer({ hostName, hsyncClient, timeout = 10000, methods = {} }) {
  if (!hostName) {
    throw new Error('No hostname specified');
  }
  if (hostName === hsyncClient.username) {
    throw new Error('Peer must be a different host');
  }
  const transport = new EventEmitter();
  transport.send = (msg) => {
    if(typeof msg === 'object') {
      msg = JSON.stringify(msg);
    }
    const topic = `msg/${hostName}/${hsyncClient.username}/rpc`;
    debug('↑ peer rpc reply', msg);
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

  const peer = rawr({transport, methods: Object.assign({}, methods), timeout});
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
};