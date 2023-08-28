const rawr = require('rawr');
const b64id = require('b64id');
const debug = require('debug')('hsync:peers');
const EventEmitter = require('events').EventEmitter;
const buffer = require('buffer');
const mqttPacket = require('mqtt-packet-web');

globalThis.Buffer = buffer.Buffer;

const { handleSocketPacket } = require('./socket-map');
const fetch = require('./fetch');

function createPacket(topic, payload) {
  let payloadStr = payload;
  console.log('mqttPacket', { topic, payload });
  // if (payload instanceof Uint8Array) {
  //   console.log('str payload', new TextDecoder().decode(payload));
  // }
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


let rtc;

function setRTC(rtcImpl) {
  rtc = rtcImpl;
}

function initPeers(hsyncClient) {
  const cachedPeers = {};
  function getRPCPeer(options = {}) {
    const { hostName, temporary, timeout = 10000, hsyncClient } = options;
    let peer = cachedPeers[hostName];
    if (!peer) {
      debug('CREATING peer', hostName);
      peer = createRPCPeer({hostName, hsyncClient, timeout});
      if (temporary) {
        peer.rpcTemporary = true;
      }
      cachedPeers[hostName] = peer;
    }
    return peer;
  }
  
  function createRPCPeer(options = {}) {
    const { hostName, timeout = 10000, useRTC = true } = options;
    if (!hostName) {
      throw new Error('No hostname specified');
    }
    if (hostName === hsyncClient.myHostName) {
      throw new Error('Peer must be a different host');
    }
    const myAuth = b64id.generateId();
    const transport = new EventEmitter();
    const peer = rawr({transport, methods: Object.assign({}, hsyncClient.peerMethods), timeout, idGenerator: b64id.generateId});
    peer.hostName = hostName;
    peer.rtcEvents = new EventEmitter();
    peer.localMethods = Object.assign({}, hsyncClient.peerMethods);
    peer.sockets = {};
  
    peer.localMethods.rtcSignal = (peerInfo, signal) => {
      debug('rtcSignal', signal.type);
      if (signal.type === 'offer' && !peer.rtcCon && !signal.alreadySent) {
        rtc.answerPeer(peer, signal);
      } else if (signal.type === 'answer') {
        peer.handleRtcAnswer(signal);
      }
      return 'rtcSignal ok';
    }
  
    peer.rtcEvents.on('packet', async (packet) => {
      debug('↓ on packet', packet);
      let toParse = packet;
      try {
        if (packet instanceof Blob) {
          toParse = await packet.arrayBuffer();
        }
        const msg = await parsePacket(toParse);
        const [p1, p2, p3] = msg.topic.split('/');
        if (p1 === 'rpc') {
          const rpcMsg = JSON.parse(msg.payload.toString());
          debug('↓ peer RTC rpc', rpcMsg);
          // if (rpcMsg.method) {
          transport.receiveData(rpcMsg);
          //   return;
          // }
        } else if (p1 === 'socketData') {
          handleSocketPacket(msg);
        } else if (p1 === 'test') {
          debug('test topic', msg.payload);
        } else {
          debug('other topic', msg.topic);
        }
      } catch (e) {
        debug('bad packet', e, packet);
      }
    });
  
    peer.rtcEvents.on('dcOpen', () => {
      debug('dcOpen');
      peer.packAndSend = (topic, payload) => {
        const packet = createPacket(topic, payload);
        if (topic === 'test') {
          debug('sending test packet', packet);
        }
        peer.rtcSend(packet);
      }
      // firefox is weird about the first bit of data, so send a test packet
      peer.packAndSend('test', 'test');
    });
  
    peer.rtcEvents.on('closed', () => {
      peer.dcOpen = false;
      delete peer.packAndSend;
      debug('rtc closed');
      for (s in peer.sockets) {
        try {
          debug('closing socket', s);
          peer.sockets[s].destroy();
          delete peer.sockets[s];
        } catch (e) {
          debug('error closing socket', e);
        }
      }
    });
  
    peer.rtcEvents.on('disconnected', () => {
      peer.dcOpen = false;
      delete peer.packAndSend;
      debug('rtc disconnected');
      for (s in peer.sockets) {
        try {
          debug('closing socket', s);
          peer.sockets[s].destroy();
          delete peer.sockets[s];
        } catch (e) {
          debug('error closing socket', e);
        }
      }
    });
  
    peer.connectRTC = async () => {
      debug('connectRTC');
      return new Promise(async (resolve, reject) => {
        try {
          const offer = await rtc.offerPeer(peer);
          debug('offer', offer);
          peer.rtcEvents.once('dcOpen', () => {
            debug('dcOpen!');
            resolve(offer);
          });
        } catch (e) {
          debug('error connecting to rtc', e);
          reject(e);
        }
      });
    };
  
    transport.send = async (msg) => {
      const fullMsg = {
        msg,
        myAuth,
        toHost: hostName,
        fromHost: hsyncClient.webUrl,
      };
  
      debug('↑ peer rpc', peer.dcOpen ? 'RTC' : 'REST', `${hostName}/_hs/rpc`, msg.method);
  
      if (peer.dcOpen) {
        let payload = msg;
        if (typeof msg === 'object') {
          payload = JSON.stringify(payload);
        }
        const packet = createPacket('rpc', payload);
        peer.rtcSend(packet);
        return;
      }
  
      try {
        const path = `${hostName}/_hs/rpc`;
        debug('fetching', path, fullMsg, useRTC);
        const result = await fetch.post(path, fullMsg);
        debug('fetch result', result);
        if (msg.id) {
          transport.receiveData({id: msg.id, result, jsonrpc: msg.jsonrpc});
        }
      } catch(e) {
        debug('error sending peer RPC request', e);
        if (msg.id) { // only send error if it's a request, not a notification
          transport.receiveData({
            id: msg.id,
            error: e.message,
            method: msg.method,
            jsonrpc: msg.jsonrpc
          });
        }
      }
    
    };
  
    transport.receiveData = (msg) => {
      debug('↓ transport.receiveData', msg);
      if(typeof msg === 'string') {
        msg = JSON.parse(msg);
      }
      debug('↓ peer rpc receivedData', msg);
      if (msg.params && Array.isArray(msg.params)) {
        debug('unshifting', msg.params);
        msg.params.unshift(peer);
      }
      transport.emit('rpc', msg);
      // debug('transport emitted', msg);
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

  hsyncClient.cachedPeers = cachedPeers;
  hsyncClient.getRPCPeer = getRPCPeer;
  hsyncClient.createServerPeer  = createServerPeer;

  return {
    getRPCPeer,
    createRPCPeer,
    createServerPeer,
  };
}

module.exports = {
  initPeers,
  setRTC,
};
