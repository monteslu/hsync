import createDebug from 'debug';

const debug = createDebug('hsync:rtc-node');
const debugError = createDebug('errors');

let nodeDataChannel;
try {
  nodeDataChannel = await import('node-datachannel');
  // Handle both default export and named export
  if (nodeDataChannel.default) {
    nodeDataChannel = nodeDataChannel.default;
  }
} catch (e) {
  debugError('node-datachannel not installed:', e.message);
}

const rtc = {
  PeerConnection: nodeDataChannel?.PeerConnection,
};

const defaultOptions = { iceServers: ['stun:stun.l.google.com:19302'] };

const GATHERING_TIMEOUT = 4000;

async function offerPeer(peer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  return new Promise((resolve, reject) => {
    const con = new rtc.PeerConnection('pc', defaultOptions);
    // window.rtc = rtc;

    peer.rtcCon = con;
    peer.rtcOfferer = true;

    let gatheringComplete = false;
    // offerSent tracking removed - not currently used
    const start = Date.now();

    peer.handleRtcAnswer = async (answer) => {
      debug('node handle RtcAnswer', answer.sdp.length);
      await peer.rtcCon.setRemoteDescription(answer.sdp, answer.type);
      return 'node handle RtcAnswer ok';
    };

    async function sendOffer() {
      const desc = con.localDescription();
      try {
        const resp = await peer.methods.rtcSignal({ type: desc.type, sdp: desc.sdp });
        resolve(resp);
      } catch (e) {
        debugError('error sending offer', e);
        reject(e);
      }
      // peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
    }

    con.onGatheringStateChange = (state) => {
      debug('onGatheringStateChange', state);
      if (state === 'complete') {
        debug('icegathering done', Date.now() - start);
        gatheringComplete = true;
        // We only want to provide an answer once all of our candidates have been added to the SDP.
        sendOffer();
      }
    };

    con.onStateChange((state) => {
      debug('offerer onStateChange: ', state);
      if (state === 'connected') {
        peer.connected = true;
        peer.rtcEvents.emit('connected', con);
      } else if (state === 'disconnected') {
        peer.connected = false;
        peer.rtcEvents.emit('disconnected', con);
        peer.rtcCon = null;
        peer.dc = null;
      } else if (state === 'closed') {
        peer.connected = false;
        peer.rtcEvents.emit('closed', con);
        peer.rtcCon = null;
        peer.dc = null;
      }
    });

    con.onDataChannel((dc) => {
      debug('offerer onDataChannel', dc);
      peer.dc = dc;
    });

    const dc = con.createDataChannel('fromofferer');
    dc.onOpen(() => {
      peer.dc = dc;
      peer.dcOpen = true;
      peer.rtcSend = (packet) => {
        dc.sendMessageBinary(packet);
      };
      peer.rtcEvents.emit('dcOpen', dc);
      debug('keys', Object.keys(dc));
    });

    dc.onMessage((msg) => {
      debug('node offerer received msg:', msg.length);
      peer.rtcEvents.emit('packet', msg);
    });

    con.setLocalDescription();

    setTimeout(() => {
      if (!gatheringComplete) {
        debug('didnt finish gathering');
        sendOffer();
      }
    }, GATHERING_TIMEOUT);
  });
}

async function answerPeer(peer, offer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  peer.rtcCon = con;
  peer.answerer = true;

  function sendAnswer() {
    const desc = con.localDescription();
    peer.methods.rtcSignal({ type: desc.type, sdp: desc.sdp });
  }

  con.onStateChange((state) => {
    debug('answerer onStateChange: ', state);
    if (state === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
    } else if (state === 'disconnected') {
      peer.connected = false;
      peer.rtcEvents.emit('disconnected', con);
      peer.rtcCon = null;
      peer.dc = null;
    } else if (state === 'closed') {
      peer.connected = false;
      peer.rtcEvents.emit('closed', con);
      peer.rtcCon = null;
      peer.dc = null;
    }
  });

  con.onGatheringStateChange((state) => {
    debug('answerer GATHERING STATE: ', state);

    if (state == 'complete') {
      sendAnswer();
    }
  });

  con.setRemoteDescription(offer.sdp, offer.type);
  con.setLocalDescription();

  con.onDataChannel((dc) => {
    debug('answerer onDataChannel', dc.getLabel());
    dc.onMessage((msg) => {
      debug('node answerer Received Msg:', msg.length);
      peer.rtcEvents.emit('packet', msg);
    });

    // dc.sendMessage("Hello From node answerer");
    peer.dcOpen = true;
    peer.dc = dc;
    peer.rtcSend = (packet) => {
      dc.sendMessageBinary(packet);
    };
    peer.rtcEvents.emit('dcOpen', dc);
  });
}

rtc.offerPeer = offerPeer;
rtc.answerPeer = answerPeer;

export default rtc;
