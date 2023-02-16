const debug = require('debug')('hsync:rtc-web');
const debugError = require('debug')('errors');

const rtc = {
  PeerConnection: RTCPeerConnection,
};


const defaultOptions = {
  // Recommended for libdatachannel
  // bundlePolicy: "max-bundle",
  iceServers: [{ 'urls': 'stun:stun.l.google.com:19302' }] 
};

const GATHERING_TIMEOUT = 2000;

async function offerPeer(peer) {

  const con = new RTCPeerConnection(defaultOptions);
  // window.rtc = rtc;

  peer.rtcCon = con;
  peer.rtcOfferer = true;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendOffer() {
    const desc = con.localDescription;
    peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
  }

  con.onicegatheringstatechange = (state) => {
      debug('state change', con.iceGatheringState);
      if (con.iceGatheringState === 'complete') {
        debug('icegathering done', Date.now() - start);
        gatheringComplete = true;
        // We only want to provide an answer once all of our candidates have been added to the SDP.
        sendOffer();
      }
  }

  con.onicecandidate = (ice) => {
    debug('ice candidate', ice);
  };

  con.onconnectionstatechange = (event) => {
    debug('connection state', con.connectionState, event);
    if(con.connectionState === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
    }
  };

  con.ondatachannel = (event) => {
    debug('dc from answerer', event);
    peer.dc = event.channel;
  };

  const dc = con.createDataChannel('from web');

  peer.dc = dc;
  dc.onmessage = (event) => { 
    debug('dc event', event.data);
    peer.rtcEvents.emit('packet', event.data);
  };
  dc.onopen = (event) => { 
    peer.dcOpen = true;
    peer.dc = dc;
    peer.rtcEvents.emit('dcOpen', dc);
    peer.rtcSend = (packet) => {
      dc.send(packet);
    };
    dc.send('yo waddup from the browser');
  };

  const offer = await con.createOffer({offerToReceiveAudio:true, offerToReceiveVideo:true});
  await con.setLocalDescription(offer);

  setTimeout(() => {
    if (!gatheringComplete) {
      debug('didnt finish gathering');
      sendOffer();
    }
  }, GATHERING_TIMEOUT);

  peer.handleRtcAnswer = (answer) => {
    debug('node handleRtcAnswer', answer.sdp.length);
    con.setRemoteDescription(answer);
    return 'ok';
  }
}

async function answerPeer(peer, offer) {
  const options = {...defaultOptions, bundlePolicy: "max-bundle"};
  const con = new RTCPeerConnection(options);
  // window.rtc = rtc;

  peer.rtcCon = con;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendAnswer() {
    const desc = con.localDescription;
    peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
  }

  con.onicegatheringstatechange = (state) => {
    if (con.iceGatheringState === 'complete') {
      debug('answerer icegathering done', Date.now() - start);
      sendAnswer();
    }
  }
  await con.setRemoteDescription(offer);

  let answer = await con.createAnswer();
  await con.setLocalDescription(answer);

  con.onicecandidate = (ice) => {
    debug('ice candidate', ice);
  };

  con.onconnectionstatechange = (event) => {
    debug('connection state', con.connectionState, event);
    if(con.connectionState === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
    }
  };

  con.ondatachannel = (event) => {
    debug('dc from node', event);
    peer.dcOpen = true;
    peer.dc = event.channel;
    peer.rtcEvents.emit('dcOpen', dc);
    peer.rtcSend = (packet) => {
      peer.dc.send(packet);
    };
    peer.dc.onmessage = (event) => {
      peer.rtcEvents.emit('packet', event.data);
    };
  };

  setTimeout(() => {
    if (!gatheringComplete) {
      debug('didnt finish gathering');
      sendAnswer();
    }
  }, GATHERING_TIMEOUT);

}


rtc.offerPeer = offerPeer;
rtc.answerPeer = answerPeer;

module.exports = rtc;