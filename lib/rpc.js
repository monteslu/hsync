const rawr = require('rawr');
const b64id = require('b64id');
const debug = require('debug')('hsync:rpc');
const EventEmitter = require('events').EventEmitter;
// const { peerMethods } = require('./peer-methods');
const fetch = require('./fetch');

const peers = {};

let rtc;

function setRTC(rtcImpl) {
  rtc = rtcImpl;
}

function getRPCPeer({hostName, temporary, timeout = 10000, hsyncClient}) {
  let peer = peers[hostName];
  if (!peer) {
    debug('creating peer', hostName);
    peer = createRPCPeer({hostName, hsyncClient, timeout});
    if (temporary) {
      peer.rpcTemporary = true;
    }
    peers[hostName] = peer;
  }
  return peer;
}


function createRPCPeer({ hostName, hsyncClient, timeout = 10000, useRTC = true }) {
  if (!hostName) {
    throw new Error('No hostname specified');
  }
  if (hostName === hsyncClient.myHostName) {
    throw new Error('Peer must be a different host');
  }
  const myAuth = b64id.generateId();
  const transport = new EventEmitter();
  const peer = rawr({transport, methods: Object.assign({}, hsyncClient.peerMethods), timeout, idGenerator: b64id.generateId});

  transport.send = async (msg) => {
    const fullMsg = {
      msg,
      myAuth,
      toHost: hostName,
      fromHost: hsyncClient.webUrl,
    };
    // const toSend = JSON.stringify(fullMsg);
    // const topic = `rpc/${hsyncClient.myHostName}`;
    debug('↑ peer rpc', `${hostName}/_hs/rpc`, msg);
    // hsyncClient.mqConn.publish(topic, Buffer.from(toSend));
    try {
      const result = await fetch.post(`${hostName}/_hs/rpc`, fullMsg);
      transport.receiveData({id: msg.id, result, jsonrpc: msg.jsonrpc});
      if (!peer.rtcCon && useRTC) {

      }
    } catch(e) {
      debug(e);
      transport.receiveData({id: msg.id, error: e, method: msg.method, jsonrpc: msg.jsonrpc});
    }
  
  };
  transport.receiveData = (msg) => {
    debug('↓ peer rpc', msg);
    if(typeof msg === 'string') {
      msg = JSON.parse(msg);
    }
    if (Array.isArray(msg.params)) {
      msg.params.unshift(hostName);
    }
    transport.emit('rpc', msg);
  };

  
  peer.myAuth = myAuth;
  peer.hostName = hostName;
  return peer;
  
}

function createServerPeer(hsyncClient, methods) {
  const transport = new EventEmitter();
  transport.send = (msg) => {
    if(typeof msg === 'object') {
      msg = JSON.stringify(msg);
    }
    const topic = `srpc/${hsyncClient.myHostName}`;
    debug('↑ server rpc request', msg);
    hsyncClient.mqConn.publish(topic, Buffer.from(msg));
  };
  transport.receiveData = (msg) => {
    debug('↓ server rpc reply', msg);
    if(msg) {
      msg = JSON.parse(msg);
    }
    transport.emit('rpc', msg);
  };
  const peer = rawr({transport, methods, timeout: 5000});
  return peer;
}

module.exports = {
  createRPCPeer,
  createServerPeer,
  getRPCPeer,
  setRTC,
};