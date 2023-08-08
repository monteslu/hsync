const EventEmitter = require('events').EventEmitter;
const b64id = require('b64id');
const debug = require('debug')('hsync:info');
const debugVerbose = require('debug')('hsync:verbose');
const debugError = require('debug')('hsync:error');
const { getRPCPeer, createServerPeer } = require('./lib/rpc');
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
    listenerLocalPort,
    listenerTargetHost,
    listenerTargetPort,
    relayInboundPort,
    relayTargetHost,
    relayTargetPort,
  } = config;

  // console.log('config', config);

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
      } else if (action === 'rpc') {
        const peer = getRPCPeer({hostName: from, temporary: true, hsyncClient});
        // const peer = getPeer({hostName: from, temporary: true});
        peer.transport.receiveData(message.toString());
      }
      else if (!action && (segment3 === 'srpc')) {
        hsyncClient.serverPeer.transport.receiveData(message.toString());
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

  // function getPeer({hostName, temporary, timeout = 10000}) {
  //   let peer = peers[hostName];
  //   if (!peer) {
  //     peer = createRPCPeer({hostName, hsyncClient, timeout, methods: peerMethods});
  //     if (temporary) {
  //       peer.rpcTemporary = true;
  //     }
  //     peers[host] = peer;
  //   }
  //   return peer;
  // }

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

  function getSocketRelays () {
    return Object.keys(socketRelays).map((id) => {
      return { info: socketRelays[id].info, id };
    });
  }

  function addSocketListener (port, hostName, targetPort, targetHost) {
    console.log('addSocketListener', port, hostName, targetPort, targetHost);
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
      debug('peerRpc handler', requestInfo.fromHost, msg);
      const reply = {id: msg.id};
      try {
        if (!peerMethods[msg.method]) {
          const notFoundError = new Error('method not found');
          notFoundError.code = -32601;
          throw notFoundError;
        }
        const result = await peerMethods[msg.method](requestInfo, ...msg.params);
        reply.result = result;
        return result;
      } catch (e) {
        debug('peer rpc error', e, msg);
        msg.error = {
          code: e.code || 500,
          message: e.toString(),
        };
        return msg;
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

  hsyncClient.hsyncBase = hsyncBase;
  hsyncClient.sendJson = sendJson;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getRPCPeer = getRPCPeer;
  hsyncClient.peerMethods = peerMethods;
  hsyncClient.hsyncSecret = hsyncSecret;
  hsyncClient.hsyncServer = hsyncServer;
  hsyncClient.dynamicTimeout = dynamicTimeout;
  const { host, protocol } = new URL(hsyncServer);
  debug('url', host, protocol);
  if (protocol === 'wss:') {
    hsyncClient.webUrl = `https://${host}`;
  } else {
    hsyncClient.webUrl = `http://${host}`;
  }
  hsyncClient.webAdmin = `${hsyncClient.webUrl}/${hsyncBase}/admin`;
  hsyncClient.webBase = `${hsyncClient.webUrl}/${hsyncBase}`;
  hsyncClient.port = port;

  if (listenerLocalPort) {
    listenerLocalPort.forEach((llp, i) => {
      const lth = listenerTargetHost ? listenerTargetHost[i] : null;
      if (lth) {
        const ltp = listenerTargetPort ? listenerTargetPort[i] : llp;
        addSocketListener(llp, myHostName, ltp, lth);
        console.log('relaying local', llp, 'to', lth, ltp);
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
