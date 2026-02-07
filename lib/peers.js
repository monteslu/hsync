import rawr from 'rawr';
import b64id from 'b64id';
import createDebug from 'debug';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import mqttPacket from 'mqtt-packet';
import { handleSocketPacket } from './socket-map.js';
import fetch from './fetch.js';

const debug = createDebug('hsync:peers');

globalThis.Buffer = Buffer;

function createPacket(topic, payload) {
  const payloadStr = payload;
  const packet = mqttPacket.generate({
    qos: 0,
    cmd: 'publish',
    topic,
    payload: payloadStr,
  });
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

export function setRTC(rtcImpl) {
  rtc = rtcImpl;
}

export function initPeers(hsyncClient) {
  const cachedPeers = {};
  const peerLib = new EventEmitter();
  function getRPCPeer(options = {}) {
    const { hostName, temporary, timeout = 10000 } = options;
    let peer = cachedPeers[hostName];
    if (!peer) {
      debug('CREATING peer', hostName);
      peer = createRPCPeer({ hostName, hsyncClient: this, timeout });
      peerLib.emit('peerCreated', peer);
      peer.myAuth = b64id.generateId();
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
    const peer = rawr({
      transport,
      methods: Object.assign({}, hsyncClient.peerMethods),
      timeout,
      idGenerator: b64id.generateId,
    });
    debug('createRPCPeer rawr', peer);

    peer.hostName = hostName;
    peer.rtcEvents = new EventEmitter();
    peer.localMethods = Object.assign({}, hsyncClient.peerMethods);
    peer.sockets = {};
    peer.pendingCandidates = []; // Buffer for ICE candidates that arrive before offer

    peer.localMethods.rtcSignal = async (peerInfo, signal) => {
      debug('rtcSignal', signal.type);
      try {
        if (signal.type === 'offer') {
          peer.rtcStatus = 'connecting';
          await rtc.answerPeer(peer, signal);
        } else if (signal.type === 'answer') {
          await peer.handleRtcAnswer(signal);
        } else if (signal.type === 'candidate') {
          // ICE candidate trickling
          if (peer.handleIceCandidate) {
            peer.handleIceCandidate(signal);
          } else {
            // Buffer candidates that arrive before answerPeer sets up handleIceCandidate
            debug('buffering early candidate (handleIceCandidate not ready)');
            peer.pendingCandidates.push(signal);
          }
        }
      } catch (e) {
        debug('error handling rtcSignal', e, signal);
        return e.message;
      }

      return `rtcSignal ${signal.type} handled ok`;
    };

    peer.rtcEvents.on('packet', async (packet) => {
      debug('↓ on packet', packet);
      let toParse = packet;
      try {
        if (packet instanceof Blob) {
          toParse = await packet.arrayBuffer();
        }
        const msg = await parsePacket(toParse);
        const [p1] = msg.topic.split('/');
        if (p1 === 'rpc') {
          let rpcMsg;
          try {
            rpcMsg = JSON.parse(msg.payload.toString());
          } catch (parseErr) {
            debug('error parsing RPC message', parseErr);
            return;
          }
          debug('↓ peer RTC rpc', rpcMsg);
          // if (rpcMsg.method) {
          transport.receiveData(rpcMsg);
          //   return;
          // }
        } else if (p1 === 'jsonMsg') {
          try {
            const jsonMsg = JSON.parse(msg.payload.toString());
            peer.rtcEvents.emit('jsonMsg', jsonMsg);
          } catch (e) {
            debug('error parsing jsonMsg', e);
          }
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
      debug(peer.answerer ? 'answerer' : 'offerer', 'dcOpen');
      peer.packAndSend = (topic, payload) => {
        const packet = createPacket(topic, payload);
        if (topic === 'test') {
          debug('sending test packet', packet);
        }
        peer.rtcSend(packet);
      };
      // firefox is weird about the first bit of data, so send a test packet
      peer.packAndSend('test', 'test');
    });

    peer.rtcEvents.on('closed', () => {
      peer.dcOpen = false;
      delete peer.packAndSend;
      debug('rtc closed');
      for (const s in peer.sockets) {
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
      for (const s in peer.sockets) {
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
      peer.rtcStatus = 'connecting';
      peer.rtcEvents.emit('connecting');
      try {
        const offer = await rtc.offerPeer(peer);
        debug('offer', offer);
        return new Promise((resolve) => {
          peer.rtcEvents.once('dcOpen', () => {
            peer.rtcStatus = 'connected';
            debug('offerer dcOpen!');
            resolve(offer);
          });
        });
      } catch (e) {
        debug('error connecting to rtc', e);
        peer.rtcStatus = 'error';
        throw e;
      }
    };

    peer.sendJSONMsg = (msg) => {
      if (typeof msg !== 'object') {
        throw new Error('sendJSONMsg requires an object');
      }
      if (!peer.packAndSend) {
        throw new Error('peer not connected');
      }
      const payload = JSON.stringify(msg);
      peer.packAndSend('jsonMsg', payload);
    };

    transport.send = async (msg) => {
      const fullMsg = {
        msg,
        myAuth,
        toHost: hostName,
        fromHost: hsyncClient.webUrl,
      };

      debug('↑ peer rpc', peer.dcOpen ? 'RTC' : 'REST', `${hostName}/_hs/rpc`, msg.method);

      let msgObj = msg;
      if (typeof msg !== 'object') {
        try {
          msgObj = JSON.parse(msg);
        } catch (_e) {
          msgObj = { error: 'invalid JSON' };
        }
      }

      // sometimes it takes a while for RTC do detect a disconnect
      // do not rtcSignal messages over the RTC connection
      if (peer.dcOpen && msgObj.method !== 'rtcSignal') {
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
          transport.receiveData({ id: msg.id, result, jsonrpc: msg.jsonrpc });
        }
      } catch (e) {
        debug('error sending peer RPC request', e);
        if (msg.id) {
          // only send error if it's a request, not a notification
          transport.receiveData({
            id: msg.id,
            error: e.message,
            method: msg.method,
            jsonrpc: msg.jsonrpc,
          });
        }
      }
    };

    transport.receiveData = (msg) => {
      debug('↓ transport.receiveData', msg);
      if (typeof msg === 'string') {
        try {
          msg = JSON.parse(msg);
        } catch (parseErr) {
          debug('error parsing transport message', parseErr);
          return;
        }
      }
      // Ensure msg is a valid object before processing
      if (!msg || typeof msg !== 'object') {
        debug('invalid message format, ignoring');
        return;
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
      if (typeof msg === 'object') {
        msg = JSON.stringify(msg);
      }
      const topic = `srpc/${hsyncClient.myHostName}`;
      debug('↑ server rpc outbound', msg);
      hsyncClient.mqConn.publish(topic, Buffer.from(msg));
    };
    transport.receiveData = (msg) => {
      if (!msg) {
        debug('↓ server rpc inbound: empty message, ignoring');
        return;
      }
      try {
        msg = JSON.parse(msg);
      } catch (parseErr) {
        debug('error parsing server RPC message', parseErr);
        return;
      }
      debug('↓ server rpc inbound', msg);
      transport.emit('rpc', msg);
    };
    const peer = rawr({ transport, methods, timeout: 5000 });
    return peer;
  }

  hsyncClient.cachedPeers = cachedPeers;
  hsyncClient.getRPCPeer = getRPCPeer;
  hsyncClient.createServerPeer = createServerPeer;
  hsyncClient.createRPCPeer = createRPCPeer;

  peerLib.cachedPeers = cachedPeers;
  peerLib.getRPCPeer = getRPCPeer;
  peerLib.createRPCPeer = createRPCPeer;
  peerLib.createServerPeer = createServerPeer;

  return peerLib;
}
