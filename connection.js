const mqtt = require('mqtt');
const EventEmitter = require('events').EventEmitter;
const b64id = require('b64id');
const debug = require('debug')('hsync:info');
const debugVerbose = require('debug')('hsync:verbose');
const debugError = require('debug')('hsync:error');
const { getPRCPeer, createServerReplyPeer, getRPCPeer } = require('./lib/rpc');
const createWebHandler = require('./lib/web-handler');
const { createSocketListenHandler, receiveRelayData } = require('./lib/socket-listen-handler');
const { createSocketRelayHandler, connectRelaySocket, receiveSocketData } = require('./lib/socket-relay-handler');
const { receiveRTCSignal } = require('./lib/data-channel');

debug.color = 3;
debugVerbose.color = 2;
debugError.color = 1;

function createHsync(config) {
  const {
    hsyncServer,
    hsyncSecret,
    localHost,
    port,
    hsyncBase,
    keepalive
  } = config;

  const hsyncClient = {};
  hsyncClient.config = config;
  const peers = {};
  const socketListeners = {};
  const socketRelays = {};
  const events = new EventEmitter();
  
  hsyncClient.on = events.on;
  hsyncClient.emit = events.emit;
  hsyncClient.peers = peers;
  
  let lastConnect;
  const connectURL = `${hsyncServer}${hsyncServer.endsWith('/') ? '' : '/'}${hsyncBase}`;
  const myHostName = (new URL(connectURL)).hostname;
  hsyncClient.myHostName = myHostName;
  
  debug('connecting to', connectURL, '…' );
  const mqConn = mqtt.connect(connectURL, { password: hsyncSecret, username: myHostName, keepalive });
  mqConn.myHostName = myHostName;
  hsyncClient.mqConn = mqConn;

  const webHandler = config.webHandler || createWebHandler({myHostName, localHost, port, mqConn});
  hsyncClient.webHandler = webHandler;

  mqConn.on('connect', () => {
    const now = Date.now();
    debug('connected to', myHostName, lastConnect ? (now - lastConnect) : '', lastConnect ? 'since last connect' : '');
    lastConnect = now;
    hsyncClient.emit('connected', config);
  });

  mqConn.on('error', (error) => {
    debugError('error on mqConn', myHostName, error);
  });

  mqConn.on('message', (topic, message) => {
    if (!topic) {
      return;
    }
    // message is Buffer
    const [name, hostName, segment3, action, segment5] = topic.split('/');
    debugVerbose('\n↓ MQTT' , topic);
    if (name === 'web') {
      webHandler.handleWebRequest(hostName, segment3, action, message);
      return;
    } else if (name === 'msg') {
      const from = segment3;
      if (action === 'json') {
        try {
          const msg = JSON.parse(message.toString());
          msg.from = from;
          hsyncClient.emit('json', msg);
        } catch (e) {
          debugError('error parsing json message');
        }
      } else if (action === 'ssrpc') {
        const peer = createServerReplyPeer({requestId: from, hsyncClient, methods: serverReplyMethods});
        peer.transport.receiveData(message.toString());
      }
      else if (action === 'rpc') {
        const peer = getRPCPeer({hostName: from, temporary: true, hsyncClient});
        peer.transport.receiveData(message.toString());
      }
      else if (action === 'rtc') {
        receiveRTCSignal(from, message, hsyncClient);
      }
      else if (action === 'socketData') {
        // events.emit('socketData', from, segment5, message);
        receiveSocketData(segment5, message);
      }
      else if (action === 'relayData') {
        // events.emit('socketData', from, segment5, message);
        receiveRelayData(segment5, message);
      }
      else if (action === 'socketClose') {
        events.emit('socketClose', from, segment5);
      }
    }

  });

  function sendJson(host, json) {
    if (!host || !json) {
      return;
    }

    if (host === myHostName) {
      debugError('cannot send message to self', host);
    }

    if (typeof json === 'object') {
      json = JSON.stringify(json);
    } else if (typeof json === 'string') {
      try {
        json = JSON.stringify(JSON.parse(json));
      } catch(e) {
        debugError('not well formed json or object', e);
        return;
      }
    } else {
      return;
    }
    mqConn.publish(`msg/${host}/${myHostName}/json`, json);
  }

  function endClient(force, callback) {
    if (force) {
      mqConn.end(force);
      if (webHandler.end) {
        webHandler.end();
      }
      return;
    }
    mqConn.end(force, (a, b) => {
      if (webHandler.end) {
        webHandler.end();
      }
      if (callback) {
        callback(a, b);
      }
    })
  }

  function getSocketListeners () {
    return Object.keys(socketListeners).map((id) => {
      return { info: socketListeners[id].info, id };
    });
  }

  function addSocketListener (port, hostName, targetPort, targetHost = 'localhost') {
    const handler = createSocketListenHandler({port, hostName, targetPort, targetHost, hsyncClient});
    const id = b64id.generateId();
    socketListeners[id] = {handler, info: {port, hostName, targetPort, targetHost}, id};
    return getSocketListeners();
  }

  function getSocketRelays () {
    return Object.keys(socketRelays).map((id) => {
      return { info: socketRelays[id].info, id };
    });
  }

  function addSocketRelay (from, targetPort, targetHost = 'localhost') {
    const handler = createSocketRelayHandler({from, targetPort, targetHost, hsyncClient});
    const id = b64id.generateId();
    socketRelays[id] = {handler, info: {from, targetPort, targetHost}, id};
    return getSocketRelays();
  }

  const serverReplyMethods = {
    ping: (greeting) => {
      return `${greeting} back atcha from client. ${Date.now()}`;
    },
    addSocketListener,
    getSocketListeners,
    addSocketRelay,
    getSocketRelays,
  };

  const peerMethods = {
    ping: (host, greeting) => {
      return `${greeting} back atcha, ${host}.`;
    },
    connectSocket: (hostName, socketId, targetPort, targetHost) => {
      console.log('connectiung', hostName, targetPort, targetHost);
      return connectRelaySocket({socketId, hostName, targetPort, hsyncClient});
    }
  };

  hsyncClient.sendJson = sendJson;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getPRCPeer = getPRCPeer;
  hsyncClient.peerMethods = peerMethods;

  return hsyncClient;
}

module.exports = {
  createHsync,
};
