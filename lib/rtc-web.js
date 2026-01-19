import createDebug from 'debug';

const debug = createDebug('hsync:rtc-web');
const debugError = createDebug('errors');

const rtc = {
  PeerConnection: RTCPeerConnection,
};

const defaultOptions = {
  // Recommended for libdatachannel
  // bundlePolicy: "max-bundle",
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const GATHERING_TIMEOUT = 4000;

async function offerPeer(peer) {
  const con = new RTCPeerConnection(defaultOptions);
  // window.rtc = rtc;

  peer.rtcCon = con;
  peer.rtcOfferer = true;

  let gatheringComplete = false;
  let offerSent = false;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    async function sendOffer(alreadySent) {
      debug('send offer', alreadySent);
      const desc = con.localDescription;
      try {
        const resp = await peer.methods.rtcSignal({ type: desc.type, sdp: desc.sdp, alreadySent });
        resolve(resp);
      } catch (e) {
        debugError('error sending offer', e);
        reject(e);
      }
    }

    con.onicegatheringstatechange = (_state) => {
      debug('state change', con.iceGatheringState);
      if (con.iceGatheringState === 'complete') {
        debug('icegathering done', Date.now() - start);
        gatheringComplete = true;
        // We only want to provide an answer once all of our candidates have been added to the SDP.
        sendOffer(offerSent);
      }
    };

    con.onicecandidate = (ice) => {
      debug('ice candidate', ice);
    };

    con.onconnectionstatechange = (event) => {
      debug('offerer connection state', con.connectionState, event);
      if (con.connectionState === 'connected') {
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
    dc.onopen = (_event) => {
      peer.dcOpen = true;
      peer.dc = dc;
      peer.rtcSend = (packet) => {
        debug('sending packet', packet.toString(), dc.readyState);
        dc.send(packet);
      };
      peer.rtcEvents.emit('dcOpen', dc);
      // dc.send('yo waddup from the browser');
    };

    con
      .createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then((offer) => {
        return con.setLocalDescription(offer);
      })
      .then(() => {
        setTimeout(() => {
          if (!gatheringComplete) {
            debug('didnt finish gathering');
            sendOffer();
            offerSent = true;
          }
        }, GATHERING_TIMEOUT);

        let hasRemoteDescription = false;
        const pendingCandidates = [];

        peer.handleRtcAnswer = async (answer) => {
          debug('web handle RtcAnswer', answer.sdp?.length);
          await con.setRemoteDescription(answer);
          hasRemoteDescription = true;
          // Flush any buffered candidates
          if (pendingCandidates.length > 0) {
            debug('flushing', pendingCandidates.length, 'buffered ICE candidates');
            for (const c of pendingCandidates) {
              try {
                await con.addIceCandidate(
                  new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid || '0' })
                );
              } catch (e) {
                debug('error adding buffered candidate', e.message);
              }
            }
            pendingCandidates.length = 0;
          }
          return 'web handle RtcAnswer ok';
        };

        // Handle incoming ICE candidate from remote peer (trickle ICE)
        peer.handleIceCandidate = async (candidate) => {
          debug('web handle remote ICE candidate', candidate.candidate?.substring(0, 50));
          if (candidate.candidate && con) {
            if (!hasRemoteDescription) {
              debug('buffering ICE candidate (no remote description yet)');
              pendingCandidates.push(candidate);
              return;
            }
            try {
              await con.addIceCandidate(
                new RTCIceCandidate({
                  candidate: candidate.candidate,
                  sdpMid: candidate.mid || '0',
                })
              );
            } catch (e) {
              debug('error adding remote candidate', e.message);
            }
          }
        };
      })
      .catch((e) => {
        debugError('error creating data channel', e);
        reject(e);
      });
  });
}

async function answerPeer(peer, offer) {
  const options = { ...defaultOptions, bundlePolicy: 'max-bundle' };
  const con = new RTCPeerConnection(options);
  // window.rtc = rtc;

  peer.rtcCon = con;
  peer.answerer = true;

  let gatheringComplete = false;
  const start = Date.now();

  async function sendAnswer() {
    const desc = con.localDescription;
    try {
      await peer.methods.rtcSignal({ type: desc.type, sdp: desc.sdp });
    } catch (e) {
      debugError('error sending answer', e);
    }
  }

  con.onicegatheringstatechange = (_state) => {
    if (con.iceGatheringState === 'complete') {
      gatheringComplete = true;
      debug('answerer icegathering done', Date.now() - start);
      sendAnswer();
    }
  };

  // Handle incoming ICE candidate from remote peer (trickle ICE)
  peer.handleIceCandidate = async (candidate) => {
    debug('web answerer handle remote ICE candidate', candidate.candidate?.substring(0, 50));
    if (candidate.candidate && con) {
      try {
        await con.addIceCandidate(
          new RTCIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.mid || '0' })
        );
      } catch (e) {
        debug('error adding remote candidate', e.message);
      }
    }
  };

  await con.setRemoteDescription(offer);

  // Flush any candidates that arrived before we had the remote description
  if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
    debug('web answerer flushing', peer.pendingCandidates.length, 'early ICE candidates');
    for (const c of peer.pendingCandidates) {
      try {
        await con.addIceCandidate(
          new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.mid || '0' })
        );
      } catch (e) {
        debug('error adding early candidate', e.message);
      }
    }
    peer.pendingCandidates.length = 0;
  }

  const answer = await con.createAnswer();
  await con.setLocalDescription(answer);

  con.onicecandidate = (ice) => {
    debug('ice candidate', ice);
  };

  con.onconnectionstatechange = (event) => {
    debug('answerer connection state', con.connectionState, event);
    if (con.connectionState === 'connected') {
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

export default rtc;
