const b64id = require('b64id');
const mqttPacket = require('mqtt-packet');
const debug = require('debug')('hsync:rtc');
const debugError = require('debug')('errors');
let nodeDataChannel;
try {
  nodeDataChannel = require('node-datachannel');
} catch (e) {
  debugError(e);
}



const peers = {};

function createPubPacket(topic, payload) {
  return mqttPacket.generate({
    qos: 0,
    cmd: 'publish',
    topic,
    payload,
  });
}

function receiveRTCSignal(hostName, data, hsyncClient) {
  const msg = JSON.parse(data.toString());

  debug('inbound msg', msg);
  let peer;
  switch (msg.type) {
    case 'offer':
      peer = getRTCPeer(hostName, hsyncClient);
      if (peer.pc) {
        debug('setting offer', hostName);
        peer.pc.setRemoteDescription(msg.description, msg.type);
      }
      break;
    case 'answer':
      peer = getRTCPeer(hostName, hsyncClient);
      if (peer.pc) {
        debug('setting answer', hostName);
        peer.pc.setRemoteDescription(msg.description, msg.type);
      }
      break;
    case 'candidate':
      peer = getRTCPeer(hostName, hsyncClient);
      if (peer.pc) {
        debug('adding candidate', hostName);
        peer.pc.addRemoteCandidate(msg.candidate, msg.mid);
      }
      break;
    default:
      break;
  }
}

function getRTCPeer(hostName, hsyncClient) {
  if (!peers[hostName]) {
    peers[hostName] = createPeerConnection(hostName, hsyncClient);
  }
  return peers[hostName];
}


function createPeerConnection(hostName, hsyncClient) {
  let peer = {};
  const parser = mqttPacket.parser({ protocolVersion: 4 });

  parser.on('packet', (packet) => {
    debug('packet parsed', packet.topic, packet.payload.length);
    hsyncClient.mqConn.emit('message', `msg/${hsyncClient.myHostName}/${hostName}/${packet.topic}`, packet.payload);
  });

  parser.on('error', (e) => {
    debug('parser error', e, hostName);
  })

  if (nodeDataChannel) {
    const pc = new nodeDataChannel.PeerConnection('pc', { iceServers: ['stun:stun.l.google.com:19302'] });
    peer.pc = pc;
    peer.send = (topic, payload) => {
      if (peer.connected) {
        debug('sending packet', topic);
        const packet = createPubPacket(topic, payload);
        peer.dc.sendMessageBinary(packet);
      }
      
    }

    function addDCHandlers(adc) {
      peer.dc = adc;
      adc.onMessage((msg) => {
        debug('Message received from:', hostName, msg.length);
        parser.parse(msg);
      });

      adc.onError((e) => {
        debugError('error on dc', e);
      });

      adc.onClosed((e) => {
        debug('closed on dc', e);
      });

      debug('dc created', adc.onError, adc.maxMessageSize());
    }

    peer.createDC = () => {
      if (peer.dc) {
        return;
      }
      const dc = peer.pc.createDataChannel('fromOfferer');
      dc.onOpen(() => {
        debug('datachannel connected', hostName);
        peer.connected = true;
      });

      addDCHandlers(dc);
    }

    pc.onStateChange((state) => {
      debug('State: ', state);
    });

    pc.onGatheringStateChange((state) => {
      debug('GatheringState: ', state);
    });

    pc.onLocalDescription((description, type) => {
      const topic = `msg/${hostName}/${hsyncClient.myHostName}/rtc`;
      debug('onLocalDescription sending', type, hostName, topic);
      const data = JSON.stringify({ description, type });
      hsyncClient.mqConn.publish(topic, data);
    });

    pc.onLocalCandidate((candidate, mid) => {
      const topic = `msg/${hostName}/${hsyncClient.myHostName}/rtc`;
      debug('onLocalCandidate sending candidate', mid, hostName, topic);
      const data = JSON.stringify({ type: 'candidate', candidate, mid });
      hsyncClient.mqConn.publish(topic, data);
    });

    pc.onDataChannel((dc) => {
      debug('onDataChannel', hostName);

      dc.onOpen(() => {
        debug('dc.onOpen from answerer', hsyncClient.myHostName);
      });
      
      addDCHandlers(dc);

      peer.connected = true;
    });

  }
  
  debug('peer created', peer);
  peers[hostName] = peer;
  return peer;
}

module.exports = {
  getRTCPeer,
  createPeerConnection,
  receiveRTCSignal,
  createPubPacket,
};

