import { EventEmitter } from 'events';
import createDebug from 'debug';
import { initPeers } from './lib/peers.js';
import { createWebHandler, setNet as webSetNet } from './lib/web-handler.js';
import { setNet as listenSetNet, initListeners } from './lib/socket-listeners.js';
import { setNet as relaySetNet, initRelays } from './lib/socket-relays.js';
import fetch from './lib/fetch.js';

const debug = createDebug('hsync:info');
const debugVerbose = createDebug('hsync:verbose');
const debugError = createDebug('hsync:error');

debug.color = 3;
debugVerbose.color = 2;
debugError.color = 1;

let mqtt;

export function setNet(netImpl) {
  webSetNet(netImpl);
  listenSetNet(netImpl);
  relaySetNet(netImpl);
}

export function setMqtt(mqttImpl) {
  mqtt = mqttImpl;
}

export async function createHsync(config) {
  const {
    localHost,
    port,
    hsyncBase,
    keepalive,
    listenerLocalPort,
    listenerTargetHost,
    listenerTargetPort,
    relayInboundPort,
    relayTargetHost,
    relayTargetPort,
  } = config;
  const { dynamicHost } = config;
  let { hsyncServer, hsyncSecret } = config;

  // console.log('config', config);

  let dynamicTimeout;

  if (dynamicHost && !hsyncSecret) {
    // Validate dynamicHost to prevent URL injection/SSRF (CVE-HSYNC-2026-004)
    let validatedHost;
    let isSecure;
    try {
      const parsed = new URL(dynamicHost);
      // Only allow http/https protocols
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Invalid protocol: ${parsed.protocol}`);
      }
      isSecure = parsed.protocol === 'https:';
      // Reconstruct URL with only origin to strip path/query/fragment
      validatedHost = parsed.origin;
    } catch (urlErr) {
      throw new Error(`Invalid dynamicHost URL: ${urlErr.message}`);
    }
    const result = await fetch.post(`${validatedHost}/${hsyncBase}/dyn`, {});
    hsyncServer = isSecure ? `wss://${result.url}` : `ws://${result.url}`;
    hsyncSecret = result.secret;
    dynamicTimeout = result.timeout;
  }

  const hsyncClient = {
    setNet,
    config,
    status: 'connecting',
  };

  hsyncClient.peers = initPeers(hsyncClient);
  hsyncClient.listeners = initListeners(hsyncClient);
  hsyncClient.relays = initRelays(hsyncClient);

  // Enable auto-relay for web port (issue #15)
  if (port) {
    hsyncClient.relays.setWebPort(port);
  }

  const events = new EventEmitter();

  hsyncClient.on = events.on.bind(events);
  hsyncClient.emit = events.emit.bind(events);
  hsyncClient.removeListener = events.removeListener.bind(events);
  hsyncClient.removeAllListeners = events.removeAllListeners.bind(events);

  let lastConnect;
  const hsu = new URL(hsyncServer.toLowerCase());
  // console.log(hsu);
  let protocol = hsu.protocol;
  if (hsu.protocol === 'https:') {
    protocol = 'wss:';
  } else if (hsu.protocol === 'http:') {
    protocol = 'ws:';
  }
  const connectURL = `${protocol}//${hsu.hostname}${hsu.port ? `:${hsu.port}` : ''}/${hsyncBase}`;
  // const connectURL = `${hsyncServer}${hsyncServer.endsWith('/') ? '' : '/'}${hsyncBase}`;
  // console.log('connectURL', connectURL);
  const myHostName = hsu.hostname;
  hsyncClient.myHostName = myHostName;

  debug('connecting to', connectURL, '…');
  const mqConn = mqtt.connect(connectURL, {
    password: hsyncSecret,
    username: myHostName,
    keepalive,
  });
  mqConn.myHostName = myHostName;
  hsyncClient.mqConn = mqConn;

  const webHandler = config.webHandler || createWebHandler({ myHostName, localHost, port, mqConn });
  hsyncClient.webHandler = webHandler;

  mqConn.on('connect', () => {
    const now = Date.now();
    debug(
      'connected to',
      myHostName,
      lastConnect ? now - lastConnect : '',
      lastConnect ? 'since last connect' : ''
    );
    lastConnect = now;
    hsyncClient.emit('connected', config);
    hsyncClient.status = 'connected';
  });

  mqConn.on('error', (error) => {
    debugError('error on mqConn', myHostName, error.code, error);
    if (error.code === 4 || error.code === 5) {
      debug('ending');
      mqConn.end();
      // if (globalThis.process) {
      //   process.exit(1);
      // }
      hsyncClient.emit('connect_error', error);
    }
  });

  mqConn.on('message', (topic, message) => {
    if (!topic) {
      return;
    }
    // message is Buffer
    const [name, hostName, segment3, action] = topic.split('/');
    debugVerbose('\n↓ MQTT', topic);
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
        } catch (_e) {
          debugError('error parsing json message');
        }
      } else if (!action && segment3 === 'srpc') {
        hsyncClient.serverPeer.transport.receiveData(message.toString());
      }
    }
  });

  function endClient(force, callback) {
    if (force) {
      mqConn.end(force);
      hsyncClient.status = 'disconnected';
      if (webHandler.end) {
        webHandler.end();
      }
      return;
    }
    mqConn.end(force, (a, b) => {
      hsyncClient.status = 'disconnected';
      if (webHandler.end) {
        webHandler.end();
      }
      if (callback) {
        callback(a, b);
      }
    });
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
      const { msg, myAuth } = requestInfo;
      debug('peerRpc handler', requestInfo.fromHost, msg.method);
      const peer = hsyncClient.peers.getRPCPeer({ hostName: requestInfo.fromHost, hsyncClient });
      requestInfo.peer = peer;

      // Security: Validate authentication token before processing any RPC request
      // CVE-HSYNC-2026-003: Previously, myAuth was sent but never verified
      if (peer.myAuth !== myAuth) {
        debug('peerRpc auth failed', requestInfo.fromHost, myAuth ? 'invalid token' : 'missing token');
        const authError = new Error('RPC authentication failed: invalid or missing auth token');
        authError.code = 401;
        throw authError;
      }

      if (!msg.id) {
        // notification
        if (Array.isArray(msg.params)) {
          msg.params.unshift(peer);
        }
        peer.transport.emit('rpc', msg);
        return { result: {}, id: msg.id };
      }
      const reply = { id: msg.id, jsonrpc: '2.0' };
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
    },
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
    return hsyncClient.peers.getRPCPeer({ hostName });
  };
  hsyncClient.hsyncBase = hsyncBase;
  hsyncClient.endClient = endClient;
  hsyncClient.serverReplyMethods = serverReplyMethods;
  hsyncClient.getRPCPeer = hsyncClient.peers.getRPCPeer;
  hsyncClient.peerMethods = peerMethods;
  hsyncClient.hsyncSecret = hsyncSecret;
  hsyncClient.hsyncServer = hsyncServer;
  hsyncClient.dynamicTimeout = dynamicTimeout;
  // const { host, protocol } = new URL(hsyncServer);
  if (hsu.protocol === 'wss:') {
    hsyncClient.webUrl = `https://${hsu.host}`;
  } else if (hsu.protocol === 'ws:') {
    hsyncClient.webUrl = `http://${hsu.host}`;
  } else {
    hsyncClient.webUrl = hsyncServer;
  }

  debug('URL', hsu.host, hsu.protocol, hsyncClient.webUrl);
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
      let rth = relayTargetHost ? relayTargetHost[i] : firstRth || 'localhost';
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
