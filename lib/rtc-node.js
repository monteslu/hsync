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

async function offerPeer(peer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  return new Promise((resolve, reject) => {
    const con = new rtc.PeerConnection('pc', defaultOptions);

    peer.rtcCon = con;
    peer.rtcOfferer = true;

    let offerSent = false;
    let hasRemoteDescription = false;
    const pendingCandidates = [];
    const start = Date.now();

    // Handle incoming answer
    peer.handleRtcAnswer = async (answer) => {
      debug('node handle RtcAnswer', answer.sdp?.length || 'no sdp');
      if (answer.sdp) {
        await peer.rtcCon.setRemoteDescription(answer.sdp, answer.type);
        hasRemoteDescription = true;
        // Flush any buffered candidates
        if (pendingCandidates.length > 0) {
          debug('flushing', pendingCandidates.length, 'buffered ICE candidates');
          for (const c of pendingCandidates) {
            try {
              peer.rtcCon.addRemoteCandidate(c.candidate, c.mid || '0');
            } catch (e) {
              debug('error adding buffered candidate', e.message);
            }
          }
          pendingCandidates.length = 0;
        }
      }
      return 'node handle RtcAnswer ok';
    };

    // Handle incoming ICE candidate from remote peer
    peer.handleIceCandidate = (candidate) => {
      debug('node handle remote ICE candidate', candidate.candidate?.substring(0, 50));
      if (candidate.candidate && peer.rtcCon) {
        if (!hasRemoteDescription) {
          // Buffer candidates until we have the remote description
          debug('buffering ICE candidate (no remote description yet)');
          pendingCandidates.push(candidate);
          return;
        }
        try {
          peer.rtcCon.addRemoteCandidate(candidate.candidate, candidate.mid || '0');
        } catch (e) {
          debug('error adding remote candidate', e.message);
        }
      }
    };

    // Trickle ICE - send candidates as they're discovered
    con.onLocalCandidate((candidate, mid) => {
      debug('offerer local candidate', candidate.substring(0, 50), 'mid:', mid);
      peer.methods.rtcSignal({ type: 'candidate', candidate, mid });
    });

    con.onGatheringStateChange((state) => {
      debug('offerer onGatheringStateChange', state, Date.now() - start, 'ms');
    });

    con.onStateChange((state) => {
      debug('offerer onStateChange:', state);
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
      } else if (state === 'failed') {
        peer.connected = false;
        peer.rtcEvents.emit('failed', con);
      }
    });

    con.onDataChannel((dc) => {
      debug('offerer onDataChannel', dc);
      peer.dc = dc;
    });

    const dc = con.createDataChannel('fromofferer');
    dc.onOpen(() => {
      debug('offerer dataChannel open');
      peer.dc = dc;
      peer.dcOpen = true;
      peer.rtcSend = (packet) => {
        dc.sendMessageBinary(packet);
      };
      peer.rtcEvents.emit('dcOpen', dc);
    });

    dc.onMessage((msg) => {
      debug('node offerer received msg:', msg.length);
      peer.rtcEvents.emit('packet', msg);
    });

    dc.onClosed(() => {
      debug('offerer dataChannel closed');
      peer.dcOpen = false;
    });

    dc.onError((err) => {
      debug('offerer dataChannel error:', err);
    });

    con.setLocalDescription();

    // Send offer immediately after setLocalDescription
    // node-datachannel creates the SDP synchronously
    setTimeout(() => {
      if (!offerSent) {
        offerSent = true;
        const desc = con.localDescription();
        debug('offerer sending offer, sdp length:', desc.sdp?.length);
        peer.methods
          .rtcSignal({ type: desc.type, sdp: desc.sdp })
          .then((resp) => {
            debug('offer sent, response:', resp);
            resolve(resp);
          })
          .catch((e) => {
            debugError('error sending offer', e);
            reject(e);
          });
      }
    }, 10);
  });
}

async function answerPeer(peer, offer) {
  if (!rtc.PeerConnection) {
    throw new Error('node-datachannel not installed');
  }

  const con = new rtc.PeerConnection('pc', defaultOptions);
  peer.rtcCon = con;
  peer.answerer = true;

  let answerSent = false;

  // Handle incoming ICE candidate from remote peer
  peer.handleIceCandidate = (candidate) => {
    debug('answerer handle remote ICE candidate', candidate.candidate?.substring(0, 50));
    if (candidate.candidate && peer.rtcCon) {
      try {
        peer.rtcCon.addRemoteCandidate(candidate.candidate, candidate.mid || '0');
      } catch (e) {
        debug('error adding remote candidate', e.message);
      }
    }
  };

  // Trickle ICE - send candidates as they're discovered
  con.onLocalCandidate((candidate, mid) => {
    debug('answerer local candidate', candidate.substring(0, 50), 'mid:', mid);
    peer.methods.rtcSignal({ type: 'candidate', candidate, mid });
  });

  con.onGatheringStateChange((state) => {
    debug('answerer onGatheringStateChange:', state);
  });

  con.onStateChange((state) => {
    debug('answerer onStateChange:', state);
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
    } else if (state === 'failed') {
      peer.connected = false;
      peer.rtcEvents.emit('failed', con);
    }
  });

  con.setRemoteDescription(offer.sdp, offer.type);
  con.setLocalDescription();

  // Flush any candidates that arrived before we had the remote description
  if (peer.pendingCandidates && peer.pendingCandidates.length > 0) {
    debug('answerer flushing', peer.pendingCandidates.length, 'early ICE candidates');
    for (const c of peer.pendingCandidates) {
      try {
        con.addRemoteCandidate(c.candidate, c.mid || '0');
      } catch (e) {
        debug('error adding early candidate', e.message);
      }
    }
    peer.pendingCandidates.length = 0;
  }

  // Send answer immediately after setLocalDescription
  setTimeout(() => {
    if (!answerSent) {
      answerSent = true;
      const desc = con.localDescription();
      // Fix SDP: answers must have a=setup:passive or a=setup:active, not actpass
      let sdp = desc.sdp;
      if (sdp && sdp.includes('a=setup:actpass')) {
        debug('answerer fixing SDP setup role from actpass to active');
        sdp = sdp.replace(/a=setup:actpass/g, 'a=setup:active');
      }
      debug(
        'answerer sending answer, sdp length:',
        sdp?.length,
        'setup role:',
        sdp?.match(/a=setup:(\w+)/)?.[1]
      );
      peer.methods.rtcSignal({ type: 'answer', sdp });
    }
  }, 10);

  con.onDataChannel((dc) => {
    debug('answerer onDataChannel', dc.getLabel());
    dc.onOpen(() => {
      debug('answerer dataChannel open');
      peer.dcOpen = true;
      peer.dc = dc;
      peer.rtcSend = (packet) => {
        dc.sendMessageBinary(packet);
      };
      peer.rtcEvents.emit('dcOpen', dc);
    });

    dc.onMessage((msg) => {
      debug('node answerer received msg:', msg.length);
      peer.rtcEvents.emit('packet', msg);
    });

    dc.onClosed(() => {
      debug('answerer dataChannel closed');
      peer.dcOpen = false;
    });

    dc.onError((err) => {
      debug('answerer dataChannel error:', err);
    });
  });
}

rtc.offerPeer = offerPeer;
rtc.answerPeer = answerPeer;

export default rtc;
