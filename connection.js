const EventEmitter = require('events').EventEmitter;
const b64id = require('b64id');
const debug = require('debug')('hsync:info');
const debugVerbose = require('debug')('hsync:verbose');
const debugError = require('debug')('hsync:error');
const { getRPCPeer, createServerPeer } = require('./lib/peers');
const { createWebHandler, setNet: webSetNet } = require('./lib/web-handler');
const { createSocketListenHandler, setNet: listenSetNet, receiveRelayData } = require('./lib/socket-listen-handler');
const { createSocketRelayHandler, setNet: relaySetNet, receiveListenerData, connectSocket } = require('./lib/socket-relay-handler');
const fetch = require('./lib/fetch');

debug.color = 3;
debugVerbose.color = 2;
debugError.color = 1;

let mqtt;

function setNet(netImpl) {
  webSetNet(netImpl);
  listenSetNet(netImpl);
  relaySetNet(netImpl);
}

function setMqtt(mqttImpl) {
  mqtt = mqttImpl;
}

async function createHsync(config) {
  let {
    hsyncServer,
    hsyncSecret,
    localHost,
    port,
    hsyncBase,
    keepalive,
    dynamicHost,
  } = config;

  let dynamicTimeout;

  if (dynamicHost) {
    const result = await fetch.post(`${dynamicHost}/${hsyncBase}/dyn`, {});
    if (dynamicHost.toLowerCase().startsWith('https')) {
      hsyncServer = `wss://${result.url}`;
    } else {
      hsyncServer = `ws://${result.url}`;
    }
    hsyncSecret = result.secret;
    dynamicTimeout = result.timeout;
  }

  const hsyncClient = {};
  hsyncClient.config = config;
  // const peers = {};
  const socketListeners = {};
  const socketRelays= {};
  const events = new EventEmitter();
  
  hsyncClient.on = events.on;
  hsyncClient.emit = events.emit;
  // hsyncClient.peers = peers;
  
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
    debugError('error on mqConn', myHostName, error.code, error);
    if ((error.code === 4) || (error.code === 5)) {
      debug('ending');
      mqConn.end();
    }
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
      }
      else if (!action && (segment3 === 'srpc')) {
        hsyncClient.serverPeer.transport.receiveData(message.toString());
      }
    }

  });

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

  function getSocketRelays () {
    return Object.keys(socketRelays).map((id) => {
      return { info: socketRelays[id].info, id };
    });
  }

  function addSocketListener (port, hostName, targetPort, targetHost = 'localhost') {
    const handler = createSocketListenHandler({port, hostName, targetPort, targetHost, hsyncClient});
    const id = b64id.generateId();
    socketListeners[id] = {handler, info: {port, hostName, targetPort, targetHost}, id};
    return getSocketListeners();
  }

  function addSocketRelay(port, hostName, targetPort, targetHost = 'localhost') {
    const handler = createSocketRelayHandler({port, hostName, targetPort, targetHost, hsyncClient});
    const id = b64id.generateId();
    socketRelays[id] = {handler, info: {port, hostName, targetPort, targetHost}, id};
    debug('relay added', port);
    return getSocketRelays();
  }

  const serverReplyMethods = {
    ping: (greeting) => {
      return `${greeting} back atcha from client. ${Date.now()}`;
    },
    addSocketListener,
    getSocketListeners,
    getSocketRelays,
    addSocketRelay,
    peerRpc: async (requestInfo) => {
      requestInfo.hsyncClient = hsyncClient;
      const { msg } = requestInfo;
      debug('peerRpc handler', requestInfo.fromHost, msg.method);
      const peer = getRPCPeer({hostName: requestInfo.fromHost, hsyncClient});
      if (!msg.id) {
        // notification
        peer.transport.emit('rpc', msg);
        return { result: {}, id: msg.id};
      }
      const reply = {id: msg.id, jsonrpc:'2.0'};
      try {
        if (!peer.localMethods[msg.method]) {
          const notFoundError = new Error('method not found');
          notFoundError.code = -32601;
          throw notFoundError;
        }
        const result = await peer.localMethods[msg.method](requestInfo, ...msg.params);
        reply.result = result;
        return result;
      } catch (e) {
        debug('peer rpc error', e, msg);
        reply.error = {
          code: e.code || 500,
          message: e.toString(),
        };
        return reply;
      }
    }
  };

  const peerMethods = {
    ping: (host, greeting) => {
      debug('ping called', host, greeting);
      return `${greeting} back atcha, ${host}.`;
    },
    connectSocket,
    receiveListenerData,
    receiveRelayData,
  };

  hsyncClient.serverPeer = createServerPeer(hsyncClient, serverReplyMethods);
  hsyncClient.getPeer = (hostName) => {
    return getRPCPeer({hostName, hsyncClient});
  };
  hsyncClient.hsyncBase = hsyncBase;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getRPCPeer = getRPCPeer;
  hsyncClient.peerMethods = peerMethods;
  hsyncClient.hsyncSecret = hsyncSecret;
  hsyncClient.hsyncServer = hsyncServer;
  hsyncClient.dynamicTimeout = dynamicTimeout;
  const { host, protocol } = new URL(hsyncServer);
  if (protocol === 'wss:') {
    hsyncClient.webUrl = `https://${host}`;
  } else {
    hsyncClient.webUrl = `http://${host}`;
  }
  debug('url', host, protocol, hsyncClient.webUrl);
  hsyncClient.webAdmin = `${hsyncClient.webUrl}/${hsyncBase}/admin`;
  hsyncClient.webBase = `${hsyncClient.webUrl}/${hsyncBase}`;
  hsyncClient.port = port;

  return hsyncClient;
}

module.exports = {
  createHsync,
  setNet,
  setMqtt,
};
