const mqtt = require('mqtt');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('hsync:info');
const debugVerbose = require('debug')('hsync:verbose');
const debugError = require('debug')('hsync:error');
const { createRPCPeer, createServerReplyPeer } = require('./rpc');
const createWebHandler = require('./web-handler');

debug.color = 3;
debugVerbose.color = 2;
debugError.color = 1;

function createhsync(config) {
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
    const [name, hostName, segment3, action] = topic.split('/');
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
        const peer = getPeer({hostName: from, temporary: true});
        peer.transport.receiveData(message.toString());
      }
    }

  });

  function getPeer({hostName, temporary, timeout = 10000}) {
    let peer = peers[host];
    if (!peer) {
      peer = createRPCPeer({hostName, hsyncClient, timeout, methods: peerMethods});
      if (temporary) {
        peer.rpcTemporary = true;
      }
      peers[host] = peer;
    }
    return peer;
  }

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

  const serverReplyMethods = {
    ping: (greeting) => {
      return `${greeting} back atcha from client. ${Date.now()}`;
    },
  };

  const peerMethods = {
    ping: (host, greeting) => {
      return `${greeting} back atcha, ${host}.`;
    },
  };

  hsyncClient.sendJson = sendJson;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getPeer = getPeer;
  hsyncClient.peerMethods = peerMethods;

  return hsyncClient;
}

module.exports = {
  createhsync,
};
