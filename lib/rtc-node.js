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


const defaultOptions = {
  // Recommended for libdatachannel
  // bundlePolicy: "max-bundle",
  iceServers: [{ 'urls': 'stun:stun.l.google.com:19302' }] 
};

const GATHERING_TIMEOUT = 2000;

async function offerPeer(rtcPeer) {

  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  // window.rtc = rtc;

  rtcPeer.con = con;
  rtcPeer.offerer = true;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendOffer() {
    const desc = con.localDescription();
    rtcPeer.rpcPeer.methods.rtcSignal({"type": desc.type, sdp: desc.sdp});
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
      rtcPeer.connected = true;
      rtcPeer.events.emit('connected', con);
    }
  });

  con.onDataChannel((dc) => {
    debug('dc from offerer', dc);
    rtcPeer.dc = dc;
  });

  const dc = con.createDataChannel('fromofferer');
  dc.onOpen(() => {
    rtcPeer.dcOpen = true;
    rtcPeer.events.emit('dcOpen', dc);
    dc.sendMessage("Hello from node from offerer");
  });

  dc.onMessage((msg) => {
    debug('msg from answerer:', msg);
  });

  con.setLocalDescription();

  setTimeout(() => {
    if (!gatheringComplete) {
      debug('didnt finish gathering');
      sendOffer();
    }
  }, GATHERING_TIMEOUT);

  rtcPeer.handleAnswer = (answer) => {
    con.setRemoteDescription(answer.sdb, answer.type);
  }
}

async function answerPeer(rtcPeer, offer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  rtcPeer.con = con;
  
  function sendAnswer() {
    const desc = con.localDescription();
    rtcPeer.rpcPeer.methods.rtcSignal({"type": desc.type, sdp: desc.sdp});
  }

  con.onStateChange((state) => {
    debug('answerer state: ', state);
    if (state === 'connected') {
      rtcPeer.connected = true;
      rtcPeer.events.emit('connected', con);
    }
  });

  con.onGatheringStateChange((state) => {
    debug('answerer GATHERING STATE: ', state);

    if (state == 'complete') {
      sendAnswer();
    }
  });

  peerConnection.setRemoteDescription(offer.sdp, offer.type);
  peerConnection.setLocalDescription();

  con.onDataChannel((dc) => {
    debug("node answerer Got DataChannel: ", dc.getLabel());
    dc.onMessage((msg) => {
      debug('node answerer Received Msg:', msg);
    });
    dc.sendMessage("Hello From node answerer");
  });

}

rtc.offerPeer = offerPeer;
rtc.answerPeer = answerPeer;


module.exports = rtc;