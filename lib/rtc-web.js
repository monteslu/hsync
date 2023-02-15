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

async function offerPeer(rtcPeer) {

  const con = new RTCPeerConnection(defaultOptions);
  // window.rtc = rtc;

  rtcPeer.con = con;
  rtcPeer.offerer = true;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendOffer() {
    const desc = con.localDescription;
    rtcPeer.rpcPeer.methods.rtcSignal({"type": desc.type, sdp: desc.sdp});
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
      rtcPeer.connected = true;
      rtcPeer.events.emit('connected', con);
    }
  };

  con.ondatachannel = (event) => {
    debug('dc from answerer', event);
    rtcPeer.dc = event.channel;
  };

  const dc = con.createDataChannel('from web');

  rtcPeer.dc = dc;
  dc.onmessage = (event) => { 
    debug('dc event', event.data);
  };
  dc.onopen = (event) => { 
    rtcPeer.dcOpen = true;
    rtcPeer.events.emit('dcOpen', dc);
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

  rtcPeer.handleAnswer = (answer) => {
    con.setRemoteDescription(answer);
  }
}

async function answerPeer(rtcPeer, offer) {
  const options = {...defaultOptions, bundlePolicy: "max-bundle"};
  const con = new RTCPeerConnection(options);
  // window.rtc = rtc;

  rtcPeer.con = con;
  
  let gatheringComplete = false;
  const start = Date.now();

  function sendAnswer() {
    const desc = con.localDescription;
    rtcPeer.rpcPeer.methods.rtcSignal({"type": desc.type, sdp: desc.sdp});
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
      rtcPeer.connected = true;
      rtcPeer.events.emit('connected', con);
    }
  };

  con.ondatachannel = (event) => {
    debug('dc from node', event);
    rtcPeer.dc = event.channel;
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