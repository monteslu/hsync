const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('hsync:info');
const debugVerbose = require('debug')('hsync:verbose');
const debugError = require('debug')('hsync:error');
const { initPeers } = require('./lib/peers');
const { createWebHandler, setNet: webSetNet } = require('./lib/web-handler');
const { 
  setNet: listenSetNet,
  initListeners,
} = require('./lib/socket-listeners');
const {
  setNet: relaySetNet,
  initRelays,
} = require('./lib/socket-relays');
const fetch = require('./lib/fetch');

debug.color = 3;
debugVerbose.color = 2;
debugError.color = 1;

let mqtt;

console.log('connection from hsync');

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
    listenerLocalPort,
    listenerTargetHost,
    listenerTargetPort,
    relayInboundPort,
    relayTargetHost,
    relayTargetPort,
  } = config;

  // console.log('config', config);

  let dynamicTimeout;

  if (dynamicHost && !hsyncSecret) {
    const result = await fetch.post(`${dynamicHost}/${hsyncBase}/dyn`, {});
    if (dynamicHost.toLowerCase().startsWith('https')) {
      hsyncServer = `wss://${result.url}`;
    } else {
      hsyncServer = `ws://${result.url}`;
    }
    hsyncSecret = result.secret;
    dynamicTimeout = result.timeout;
  }

  const hsyncClient = {
    setNet,
    config,
  };

  hsyncClient.peers = initPeers(hsyncClient);
  hsyncClient.listeners = initListeners(hsyncClient);
  hsyncClient.relays = initRelays(hsyncClient);

  const events = new EventEmitter();
  
  hsyncClient.on = events.on;
  hsyncClient.emit = events.emit;
  
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
      if (globalThis.process) {
        process.exit(1);
      }
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

  const serverReplyMethods = {
    ping: (greeting) => {
      return `${greeting} back atcha from client. ${Date.now()}`;
    },
    addSocketListener: hsyncClient.addSocketListener,
    getSocketListeners: hsyncClient.getSocketListeners,
    addSocketRelay: hsyncClient.addSocketRelay,
    getSocketRelays: hsyncClient.getSocketRelays,
    peerRpc: async (requestInfo) => {
      requestInfo.hsyncClient = hsyncClient;
      const { msg } = requestInfo;
      debug('peerRpc handler', requestInfo.fromHost, msg.method);
      const peer = hsyncClient.peers.getRPCPeer({hostName: requestInfo.fromHost, hsyncClient});
      if (!msg.id) {
        // notification
        if (Array.isArray(msg.params)) {
          msg.params.unshift(peer);
        }
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
    ping: (remotePeer, greeting) => {
      debug('ping called', remotePeer.hostName, greeting);
      return `${greeting} back atcha, ${remotePeer.hostName}.`;
    },
    validatePeer: (remotePeer, secret) => {
      return hsyncClient.getPeer(remotePeer.hostName).myAuth === secret;
    },
    connectSocket: hsyncClient.connectSocket,
    // closeListenerSocket: hsyncClient.closeListenerSocket,
    // closeRelaySocket: hsyncClient.closeRelaySocket,
    // receiveListenerData: hsyncClient.receiveListenerData,
    // receiveRelayData: hsyncClient.receiveRelayData,
  };

  hsyncClient.serverPeer = hsyncClient.peers.createServerPeer(hsyncClient, serverReplyMethods);
  hsyncClient.serverPeer.notifications.onexternal_message((msg) => {
    hsyncClient.emit('external_message', msg);
  });
  hsyncClient.getPeer = (hostName) => {
    return peers.getRPCPeer({ hostName });
  };
  hsyncClient.hsyncBase = hsyncBase;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getRPCPeer = hsyncClient.peers.getRPCPeer;
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

  if (listenerLocalPort) {
    listenerLocalPort.forEach((llp, i) => {
      let lth = listenerTargetHost ? listenerTargetHost[i] || listenerTargetHost[0] : null;
      if (lth) {
        if (lth.endsWith('/')) {
          lth = lth.substring(0, lth.length - 1);
        }
        const ltp = listenerTargetPort ? listenerTargetPort[i] : llp;
        hsyncClient.addSocketListener({ port: llp, targetPort: ltp, targetHost: lth });
        debug('relaying local', llp, 'to', lth, ltp);
      }
    });
  }

  if (relayInboundPort) {
    relayInboundPort.forEach((rip, i) => {
      debug('relayInboundPort', rip, i, relayTargetHost);
      const firstRth = relayTargetHost ? relayTargetHost[0] : null;
      const rth = relayTargetHost ? relayTargetHost[i] : firstRth || 'localhost';
      if (rth) {
        if (rth.endsWith('/')) {
          rth = rth.substring(0, rth.length - 1);
        }
        const rtp = relayTargetPort ? relayTargetPort[i] : rip;
        hsyncClient.addSocketRelay({ port: rip, targetHost: rth, targetPort: rtp });
        debug('relaying inbound', rip, 'to', rth, rtp);
      }
    });
  }

  return hsyncClient;
}

module.exports = {
  createHsync,
  setNet,
  setMqtt,
};
