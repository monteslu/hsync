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

const GATHERING_TIMEOUT = 4000;

async function offerPeer(peer) {
  return new Promise(async (resolve, reject) => {
    const con = new RTCPeerConnection(defaultOptions);
    // window.rtc = rtc;

    peer.rtcCon = con;
    peer.rtcOfferer = true;
    
    let gatheringComplete = false;
    let offerSent = false;
    const start = Date.now();

    async function sendOffer(alreadySent) {
      debug('send offer', alreadySent);
      const desc = con.localDescription;
      try {
        const resp = await peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp, alreadySent});
        resolve(resp);
      } catch (e) {
        debugError('error sending offer', e);
        reject(e);
      }
    }

    con.onicegatheringstatechange = (state) => {
        debug('state change', con.iceGatheringState);
        if (con.iceGatheringState === 'complete') {
          debug('icegathering done', Date.now() - start);
          gatheringComplete = true;
          // We only want to provide an answer once all of our candidates have been added to the SDP.
          sendOffer(offerSent);
        }
    }

    con.onicecandidate = (ice) => {
      debug('ice candidate', ice);
    };

    con.onconnectionstatechange = (event) => {
      debug('offerer connection state', con.connectionState, event);
      if(con.connectionState === 'connected') {
        peer.connected = true;
        peer.rtcEvents.emit('connected', con);
      } else if (con.connectionState === 'disconnected') {
        peer.connected = false;
        peer.rtcEvents.emit('disconnected', con);
        peer.rtcCon = null;
        peer.dc = null;
      } else if (con.connectionState === 'closed') {
        peer.connected = false;
        peer.rtcEvents.emit('closed', con);
        peer.rtcCon = null;
        peer.dc = null;
      }
    };

    con.ondatachannel = (event) => {
      debug('dc from answerer', event);
      peer.dc = event.channel;
    };

    const dc = con.createDataChannel('from web');

    peer.dc = dc;
    dc.onmessage = (event) => { 
      debug('dc.onmessage', event.data);
      peer.rtcEvents.emit('packet', event.data);
    };
    dc.onopen = (event) => { 
      peer.dcOpen = true;
      peer.dc = dc;
      peer.rtcSend = (packet) => {
        debug('sending packet', packet.toString(), dc.readyState);
        dc.send(packet);
      };
      peer.rtcEvents.emit('dcOpen', dc);
      // dc.send('yo waddup from the browser');
    };
    
    try {
      const offer = await con.createOffer({offerToReceiveAudio:true, offerToReceiveVideo:true});
      await con.setLocalDescription(offer);

      setTimeout(() => {
        if (!gatheringComplete) {
          debug('didnt finish gathering');
          sendOffer();
          offerSent = true;
        }
      }, GATHERING_TIMEOUT);

      peer.handleRtcAnswer = async (answer) => {
        debug('web handle RtcAnswer', answer.sdp.length);
        await con.setRemoteDescription(answer);
        return 'web handle RtcAnswer ok';
      };
    } catch (e) {
      debugError('error creating data channel', e);
      reject(e);
    }
  });
}

async function answerPeer(peer, offer) {
  const options = {...defaultOptions, bundlePolicy: "max-bundle"};
  const con = new RTCPeerConnection(options);
  // window.rtc = rtc;

  peer.rtcCon = con;
  peer.answerer = true;
  
  let gatheringComplete = false;
  const start = Date.now();

  async function sendAnswer() {
    const desc = con.localDescription;
    try {
      await peer.methods.rtcSignal({type: desc.type, sdp: desc.sdp});
    } catch (e) {
      debugError('error sending answer', e);
    }
  }

  con.onicegatheringstatechange = (state) => {
    if (con.iceGatheringState === 'complete') {
      gatheringComplete = true;
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
    debug('answerer connection state', con.connectionState, event);
    if(con.connectionState === 'connected') {
      peer.connected = true;
      peer.rtcEvents.emit('connected', con);
    } else if (con.connectionState === 'disconnected') {
      peer.connected = false;
      peer.rtcEvents.emit('disconnected', con);
      peer.rtcCon = null;
      peer.dc = null;
    } else if (con.connectionState === 'closed') {
      peer.connected = false;
      peer.rtcEvents.emit('closed', con);
      peer.rtcCon = null;
      peer.dc = null;
    }
  };

  con.ondatachannel = (event) => {
    debug('ondatachannel', event);
    peer.dcOpen = true;
    peer.dc = event.channel;
    peer.rtcSend = (packet) => {
      debug('sending packet', packet.toString(), peer.dc.readyState);
      peer.dc.send(packet);
    };
    peer.rtcEvents.emit('dcOpen', peer.dc);
    peer.dc.onmessage = (event) => {
      peer.rtcEvents.emit('packet', event.data);
    };
  };

  con.ontrack = (event) => {
    debug('rtc track', event);
    peer.rtcEvents.emit('track', event);
  };

  con.onaddstream = (event) => {
    debug('rtc stream', event);
    peer.rtcEvents.emit('addstream', event);
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