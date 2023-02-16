const rawr = require('rawr');
const b64id = require('b64id');
const debug = require('debug')('hsync:peers');
const EventEmitter = require('events').EventEmitter;
const mqttPacket = require('mqtt-packet');

const { handleSocketPacket } = require('./socket-map');
const fetch = require('./fetch');

const peers = {};

let rtc;

function setRTC(rtcImpl) {
  rtc = rtcImpl;
}

function createPacket(topic, payload) {
  let payloadStr = payload;
  if (typeof payload === 'object') {
    payloadStr = JSON.stringify(payload);
  }
  const packet =  mqttPacket.generate({
    qos: 0,
    cmd: 'publish',
    topic,
    payload: payloadStr,
  });
  // console.log('packet', packet);
  return packet;
}

function parsePacket(packet) {
  const parser = mqttPacket.parser();
  return new Promise((resolve, reject) => {
    parser.on('packet', resolve);
    parser.on('error', reject);
    parser.parse(packet);
  });
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
  peer.rtcEvents = new EventEmitter();
  peer.localMethods = Object.assign({}, hsyncClient.peerMethods);

  peer.localMethods.rtcSignal = (peerInfo, signal) => {
    debug('rtcSignal', signal.type);
    if (signal.type === 'offer' && !peer.rtcCon) {
      rtc.answerPeer(peer, signal);
    } else if (signal.type === 'answer') {
      peer.handleRtcAnswer(signal);
    }
    return 'ok';
  }

  peer.rtcEvents.on('packet', async (packet) => {
    try {
      const msg = await parsePacket(packet);
      const [p1, p2, p3] = msg.topic.split('/');
      if (p1 === 'rpc') {
        transport.receiveData(JSON.parse(msg.payload.toString()));
      } else if (p1 === 'socketData'){
        handleSocketPacket(msg);
      } else {
        debug('other topic', msg.topic);
      }
    } catch (e) {
      debug('bad packet', e);
    }
  });

  peer.rtcEvents.on('dcOpen', () => {
    debug('dcOpen');
    peer.packAndSend = (topic, payload) => {
      const packet = createPacket(topic, payload);
      peer.rtcSend(packet);
    }
  });

  transport.send = async (msg) => {
    const fullMsg = {
      msg,
      myAuth,
      toHost: hostName,
      fromHost: hsyncClient.webUrl,
    };

    debug('↑ peer rpc', `${hostName}/_hs/rpc`, msg.method);

    if (peer.dcOpen) {
      const packet = createPacket('rpc', msg);
      peer.rtcSend(packet);
      return;
    }

    try {
      const result = await fetch.post(`${hostName}/_hs/rpc`, fullMsg);
      transport.receiveData({id: msg.id, result, jsonrpc: msg.jsonrpc});
      if (!peer.rtcCon && useRTC) {
        debug('starting rtc creation');
        rtc.offerPeer(peer);
      }
    } catch(e) {
      debug(e);
      transport.receiveData({id: msg.id, error: e, method: msg.method, jsonrpc: msg.jsonrpc});
    }
  
  };

  transport.receiveData = (msg) => {
    if(typeof msg === 'string') {
      msg = JSON.parse(msg);
    }
    debug('↓ peer rpc', msg.method, !!msg.result, msg.id);
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
    if(msg) {
      msg = JSON.parse(msg);
    }
    debug('↓ server rpc reply', msg.method, msg.id);
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
