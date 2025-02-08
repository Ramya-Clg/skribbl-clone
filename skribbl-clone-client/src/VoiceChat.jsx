// src/VoiceChat.jsx
import { useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';

const VoiceChat = ({ socket, roomId, isInitiator }) => {
  const [peers, setPeers] = useState([]);
  const userAudio = useRef();

  useEffect(() => {
    // Get user's audio stream
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      userAudio.current.srcObject = stream;
      
      // Create a peer for every new connection (this is a simplified example)
      // When this client connects, it will announce itself to others.
      socket.emit('voiceJoin', { roomId });
      
      // When receiving a voice signal from others, either create a new peer or signal an existing one.
      socket.on('voiceSignal', ({ signal, from }) => {
        // Check if we already have a peer connection for this sender
        let existingPeer = peers.find(p => p.peerId === from);
        if (existingPeer) {
          existingPeer.peer.signal(signal);
        } else {
          // Create a new peer (non-initiator)
          const newPeer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream,
          });
          newPeer.peerId = from;
          newPeer.on('signal', signalData => {
            socket.emit('voiceSignal', { roomId, signal: signalData });
          });
          newPeer.on('stream', remoteStream => {
            // Create an audio element to play the remote stream.
            const audioElem = document.createElement('audio');
            audioElem.srcObject = remoteStream;
            audioElem.play();
          });
          newPeer.signal(signal);
          setPeers(prev => [...prev, newPeer]);
        }
      });
      
      // When another user joins, initiate a peer connection if you are the initiator.
      socket.on('voiceUserJoined', ({ socketId }) => {
        // Create a new peer (initiator)
        const initiatorPeer = new Peer({
          initiator: true,
          trickle: false,
          stream: stream,
        });
        initiatorPeer.peerId = socketId;
        initiatorPeer.on('signal', signalData => {
          socket.emit('voiceSignal', { roomId, signal: signalData });
        });
        initiatorPeer.on('stream', remoteStream => {
          const audioElem = document.createElement('audio');
          audioElem.srcObject = remoteStream;
          audioElem.play();
        });
        setPeers(prev => [...prev, initiatorPeer]);
      });
      
      // Clean up on unmount.
      return () => {
        socket.off('voiceSignal');
        socket.off('voiceUserJoined');
        peers.forEach(p => p.destroy());
      };
    });
  }, []);
  
  return (
    <div>
      <p>Voice Chat Active</p>
      {/* Hidden audio element for the user's own stream */}
      <audio ref={userAudio} autoPlay muted />
    </div>
  );
};

export default VoiceChat;
