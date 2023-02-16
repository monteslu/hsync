const debug = require('debug')('hsync:rtc-node');
const debugError = require('debug')('errors');
let nodeDataChannel;
try {
  nodeDataChannel = require('node-datachannel');
} catch (e) {
  debugError(e);
}

const rtc = {
  PeerConnection: nodeDataChannel?.PeerConnection,
};


const defaultOptions = { iceServers: ['stun:stun.l.google.com:19302'] };

const GATHERING_TIMEOUT = 2000;

async function offerPeer(peer) {

  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  // window.rtc = rtc;

  peer.rtcCon = con;
  peer.rtcOfferer = true;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendOffer() {
    const desc = con.localDescription();
    peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
  }

  con.onGatheringStateChange = (state) => {
    debug('state change', state);
    if (state === 'complete') {
      debug('icegathering done', Date.now() - start);
      gatheringComplete = true;
      // We only want to provide an answer once all of our candidates have been added to the SDP.
      sendOffer();
    }
  }

  con.onStateChange((state) => {
    debug('offerer state: ', state);
    if (state === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
    }
  });

  con.onDataChannel((dc) => {
    debug('dc from offerer', dc);
    peer.dc = dc;
  });

  const dc = con.createDataChannel('fromofferer');
  dc.onOpen(() => {
    peer.dc = dc;
    peer.dcOpen = true;
    peer.rtcEvents.emit('dcOpen', dc);
    peer.rtcSend = (packet) => {
      dc.sendMessageBinary(packet);
    };
    dc.sendMessage("Hello from node from offerer");
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

  peer.handleRtcAnswer = (answer) => {
    debug('node handleRtcAnswer', answer.sdp.length);
    con.setRemoteDescription(answer.sdp, answer.type);
    return 'ok';
  }
}

async function answerPeer(peer, offer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  peer.rtcCon = con;
  
  function sendAnswer() {
    const desc = con.localDescription();
    peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
  }

  con.onStateChange((state) => {
    debug('answerer state: ', state);
    if (state === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
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
    debug("node answerer got dataChannel: ", dc.getLabel());
    dc.onMessage((msg) => {
      debug('node answerer Received Msg:', msg.length);
      peer.rtcEvents.emit('packet', msg);
    });

    // dc.sendMessage("Hello From node answerer");
    peer.dcOpen = true;
    peer.dc = dc;
    peer.rtcEvents.emit('dcOpen', dc);
    peer.rtcSend = (packet) => {
      dc.sendMessageBinary(packet);
    };
  });

}

rtc.offerPeer = offerPeer;
rtc.answerPeer = answerPeer;


module.exports = rtc;