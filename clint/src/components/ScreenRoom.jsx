import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';
import Peer from 'peerjs';
import toast, { Toaster } from 'react-hot-toast';

const ScreenRoom = () => {
  const { roomCode } = useParams();
  const [screenStream, setScreenStream] = useState(null);
  const [audioStream, setAudioStream] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());
  const [participantCount, setParticipantCount] = useState(1);
  const [roomFull, setRoomFull] = useState(false);
  const [remoteMuteStates, setRemoteMuteStates] = useState({});
  
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  const socketRef = useRef();
  const peerRef = useRef();
  const userVideoRef = useRef();
  const screenAudioRef = useRef();
  const audioContextRef = useRef();
  const analyserRef = useRef();
  const animationRef = useRef();
  const peersRef = useRef({});

  // Initialize audio analyzer for visualization
  const initAudioAnalyzer = (stream) => {
    if (!stream || !stream.getAudioTracks().length) return;
    
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('AudioContext not supported');
        return;
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 32;
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      
      visualizeAudio();
    } catch (err) {
      console.error('Audio analyzer error:', err);
    }
  };

  const visualizeAudio = () => {
    if (!analyserRef.current) return;
    
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      if (average > 20 && !isMicMuted && audioStream?.getAudioTracks()[0]?.enabled) {
        socketRef.current.emit('speaking', true);
      } else {
        socketRef.current.emit('speaking', false);
      }
    };
    
    draw();
  };

  // Cleanup resources
  const cleanup = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
    }
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    if (peerRef.current) {
      peerRef.current.destroy();
    }
  };

  // Initialize peer and socket connections
  useEffect(() => {
    const userId = `user-${Math.random().toString(36).substr(2, 9)}`;
    
    socketRef.current = io('http://localhost:5000');
    peerRef.current = new Peer(userId, {
      host: '/',
      port: '5000',
      path: '/peerjs',
    });

    // Handle room full event
    socketRef.current.on('room-full', () => {
      setRoomFull(true);
      toast.error('Room is full (maximum 2 participants allowed)');
    });

    // Handle current participants
    socketRef.current.on('current-participants', (participantIds) => {
      setParticipants(participantIds);
    });

    // Handle participant count updates
    socketRef.current.on('participant-count', (count) => {
      setParticipantCount(count);
      toast.success(`${count} participants in room`);
    });

    // Handle speaking events
    socketRef.current.on('user-speaking', ({ userId, isSpeaking }) => {
      setSpeakingUsers(prev => {
        const newSet = new Set(prev);
        if (isSpeaking) {
          newSet.add(userId);
        } else {
          newSet.delete(userId);
        }
        return newSet;
      });
    });

    // Handle mute state changes
    socketRef.current.on('user-mute-state', ({ userId, isMuted }) => {
      setRemoteMuteStates(prev => ({
        ...prev,
        [userId]: isMuted
      }));
      toast(`${isMuted ? 'Muted' : 'Unmuted'} by ${userId.substring(0, 6)}`, {
        icon: isMuted ? '🔇' : '🔊'
      });
    });

    peerRef.current.on('open', () => {
      socketRef.current.emit('join-room', roomCode, userId);
    });

    peerRef.current.on('call', (call) => {
      const streamToSend = screenStream || audioStream;
      call.answer(streamToSend || null);
      
      call.on('stream', (remoteStream) => {
        const peerId = call.peer;
        peersRef.current[peerId] = call;
        
        setParticipants(prev => [...prev, peerId]);

        // Create video/audio element for remote peer
        const container = document.getElementById('remote-peers');
        const mediaElement = remoteStream.getVideoTracks().length > 0 ? 
          document.createElement('video') : 
          document.createElement('audio');
        
        mediaElement.srcObject = remoteStream;
        mediaElement.autoplay = true;
        mediaElement.className = 'w-full h-full rounded-lg object-cover';
        mediaElement.id = `media-${peerId}`;
        
        // Add border when speaking
        if (speakingUsers.has(peerId)) {
          mediaElement.classList.add('border-2', 'border-green-500');
        }
        
        container.appendChild(mediaElement);
      });

      call.on('close', () => {
        const peerId = call.peer;
        delete peersRef.current[peerId];
        setParticipants(prev => prev.filter(id => id !== peerId));
        
        const mediaElement = document.getElementById(`media-${peerId}`);
        if (mediaElement) {
          mediaElement.remove();
        }
      });
    });

    socketRef.current.on('user-connected', (userId) => {
      const streamToSend = screenStream || audioStream;
      if (!streamToSend) return;
      
      const call = peerRef.current.call(userId, streamToSend);
      call.on('close', () => {
        delete peersRef.current[userId];
        setParticipants(prev => prev.filter(id => id !== userId));
      });
      peersRef.current[userId] = call;
    });

    socketRef.current.on('user-disconnected', (userId) => {
      if (peersRef.current[userId]) {
        peersRef.current[userId].close();
      }
      toast(`${userId.substring(0, 6)} left the room`);
    });

    return cleanup;
  }, [roomCode]);

  // Handle stream changes
  useEffect(() => {
    if (userVideoRef.current && screenStream) {
      userVideoRef.current.srcObject = screenStream;
    }
    if (screenAudioRef.current && audioStream) {
      screenAudioRef.current.srcObject = audioStream;
      initAudioAnalyzer(audioStream);
    }
  }, [screenStream, audioStream]);

  const startSharing = async (shareScreen = true, shareAudio = true) => {
    try {
      setError(null);
      
      // Check if we're running on HTTPS or localhost
      const isSecure = window.location.protocol === 'https:' || 
                       window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1';

      if (!isSecure) {
        throw new Error('Audio access requires HTTPS or localhost');
      }

      let newScreenStream = null;
      let newAudioStream = null;

      if (shareScreen) {
        try {
          newScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
          });
          
          newScreenStream.getVideoTracks()[0].onended = () => {
            stopSharing();
          };
        } catch (err) {
          if (shareAudio) {
            // If screen sharing fails but audio was requested, continue with audio only
            toast.error('Screen sharing failed, continuing with audio only');
          } else {
            throw err;
          }
        }
      }

      if (shareAudio) {
        try {
          newAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
        } catch (err) {
          if (shareScreen && newScreenStream) {
            // If audio fails but we have screen, continue with screen only
            toast.error('Microphone access denied, continuing without audio');
          } else {
            throw err;
          }
        }
      }

      setScreenStream(newScreenStream);
      setAudioStream(newAudioStream);
      setIsSharing(true);
      setIsMicMuted(false);
      
      toast.success(`Started ${shareScreen ? 'screen sharing' : 'audio call'}`);
      
    } catch (err) {
      setError(err.message);
      console.error(err);
      toast.error(err.message);
    }
  };

  const stopSharing = () => {
    cleanup();
    setIsSharing(false);
    setIsMicMuted(false);
    toast('Stopped sharing', { icon: '🛑' });
  };

  const toggleMic = () => {
    if (audioStream) {
      const audioTracks = audioStream.getAudioTracks();
      const newMuteState = !audioTracks[0].enabled;
      
      audioTracks.forEach(track => {
        track.enabled = newMuteState;
      });
      
      setIsMicMuted(newMuteState);
      socketRef.current.emit('speaking', !newMuteState);
      socketRef.current.emit('mute-state', newMuteState);
      
      toast(newMuteState ? 'Microphone muted' : 'Microphone unmuted', {
        icon: newMuteState ? '🔇' : '🔊'
      });
    }
  };

  const startAudioOnly = () => {
    startSharing(false, true);
  };

  const copyRoomLink = () => {
    const link = `${window.location.origin}/screen/${roomCode}`;
    navigator.clipboard.writeText(link);
    toast.success('Room link copied to clipboard!');
  };

  // Update speaking indicators when speakingUsers changes
  useEffect(() => {
    participants.forEach(peerId => {
      const mediaElement = document.getElementById(`media-${peerId}`);
      if (mediaElement) {
        if (speakingUsers.has(peerId)) {
          mediaElement.classList.add('border-2', 'border-green-500');
        } else {
          mediaElement.classList.remove('border-2', 'border-green-500');
        }
      }
    });
  }, [speakingUsers, participants]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <Toaster position="top-right" />
      
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-purple-400">ScreenShare Pro</h1>
          <div className="flex items-center space-x-4">
            <span className="bg-gray-700 px-3 py-1 rounded-full text-sm">
              Room: {roomCode} ({participantCount}/2)
            </span>
            <button
              onClick={copyRoomLink}
              className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg transition"
            >
              Copy Room Link
            </button>
          </div>
        </header>

        {roomFull ? (
          <div className="bg-red-600 text-white p-4 rounded-lg mb-6">
            Room is full (maximum 2 participants allowed)
          </div>
        ) : (
          <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Local Screen/Audio Preview */}
              <div className="bg-gray-800 rounded-xl overflow-hidden shadow-lg">
                <div className="p-4 bg-gray-700 flex justify-between items-center">
                  <h2 className="font-semibold">
                    {screenStream ? 'Your Screen' : 'Your Audio'}
                  </h2>
                  {isSharing && (
                    <div className="flex items-center space-x-3">
                      <span className="flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                        <span className="text-sm">Live</span>
                      </span>
                      {audioStream && (
                        <div className="flex space-x-1 items-center">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <div 
                              key={i}
                              className={`w-1 h-1 rounded-full ${speakingUsers.has(peerRef.current?.id) ? 'bg-green-500' : 'bg-gray-500'}`}
                              style={{
                                height: speakingUsers.has(peerRef.current?.id) ? 
                                  `${Math.random() * 6 + 2}px` : '2px'
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="aspect-video bg-black flex items-center justify-center">
                  {isSharing ? (
                    screenStream ? (
                      <video
                        ref={userVideoRef}
                        autoPlay
                        muted
                        className={`w-full h-full object-contain bg-black ${speakingUsers.has(peerRef.current?.id) ? 'border-2 border-green-500' : ''}`}
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${speakingUsers.has(peerRef.current?.id) ? 'border-2 border-green-500' : ''}`}>
                        <div className="text-center p-8 text-gray-400">
                          <div className="flex justify-center space-x-1 mb-4">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <div 
                                key={i}
                                className="w-1 h-6 bg-green-500 rounded-full"
                                style={{
                                  height: speakingUsers.has(peerRef.current?.id) ? 
                                    `${Math.random() * 12 + 4}px` : '4px'
                                }}
                              />
                            ))}
                          </div>
                          <p>Audio only mode</p>
                          <p className="text-sm">Your microphone is active</p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="text-center p-8 text-gray-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-12 w-12 mx-auto mb-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      <p>Your {screenStream ? 'screen' : 'audio'} will appear here</p>
                    </div>
                  )}
                </div>
                <div className="p-4 bg-gray-700 flex flex-wrap justify-center gap-4">
                  {!isSharing ? (
                    <>
                      <button
                        onClick={() => startSharing(true, true)}
                        disabled={isMobile}
                        className={`bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg font-medium flex items-center transition ${isMobile ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Share Screen + Audio
                      </button>
                      <button
                        onClick={startAudioOnly}
                        className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-medium flex items-center transition"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Audio Only
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={stopSharing}
                        className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-medium flex items-center transition"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-5 w-5 mr-2"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Stop Sharing
                      </button>
                      {audioStream && (
                        <button
                          onClick={toggleMic}
                          className={`px-6 py-3 rounded-lg font-medium flex items-center transition ${
                            isMicMuted ? 'bg-gray-600 hover:bg-gray-700' : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5 mr-2"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            {isMicMuted ? (
                              <path
                                fillRule="evenodd"
                                d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                                clipRule="evenodd"
                              />
                            ) : (
                              <path
                                fillRule="evenodd"
                                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                                clipRule="evenodd"
                              />
                            )}
                          </svg>
                          {isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Remote Participants */}
              <div className="bg-gray-800 rounded-xl overflow-hidden shadow-lg">
                <div className="p-4 bg-gray-700 flex justify-between items-center">
                  <h2 className="font-semibold">Participants ({participants.length})</h2>
                </div>
                <div
                  id="remote-peers"
                  className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 min-h-[200px]"
                >
                  {participants.length === 0 && (
                    <div className="col-span-full text-center p-8 text-gray-400">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-12 w-12 mx-auto mb-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                        />
                      </svg>
                      <p>Other participants will appear here when they join</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Room Info */}
              <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
                <h2 className="font-semibold text-lg mb-4 text-purple-300">
                  Room Information
                </h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-400">Room Code</p>
                    <p className="font-mono bg-gray-700 px-3 py-2 rounded">
                      {roomCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Status</p>
                    <p className="flex items-center">
                      {isSharing ? (
                        <>
                          <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                          <span>
                            {screenStream ? 'Sharing screen' : 'Sharing audio'}
                            {audioStream && !isMicMuted && screenStream && ' + audio'}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 bg-gray-500 rounded-full mr-2"></span>
                          <span>Not sharing</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400">Participants</p>
                    <p className="flex items-center">
                      <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                      <span>{participantCount} connected</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Audio Controls */}
              {isSharing && audioStream && (
                <div className="bg-gray-800 rounded-xl p-6 shadow-lg">
                  <h2 className="font-semibold text-lg mb-4 text-purple-300">
                    Audio Controls
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="flex items-center justify-between mb-2">
                        <span>Microphone</span>
                        <span className={`px-2 py-1 rounded text-sm ${
                          isMicMuted ? 'bg-red-500' : 'bg-green-500'
                        }`}>
                          {isMicMuted ? 'Muted' : 'Active'}
                        </span>
                      </label>
                      <div className="flex justify-between items-center">
                        <button
                          onClick={toggleMic}
                          className={`flex items-center justify-center w-10 h-10 rounded-full ${
                            isMicMuted ? 'bg-gray-600 hover:bg-gray-700' : 'bg-red-600 hover:bg-red-700'
                          } transition`}
                          title={isMicMuted ? 'Unmute' : 'Mute'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            {isMicMuted ? (
                              <path
                                fillRule="evenodd"
                                d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            ) : (
                              <path
                                fillRule="evenodd"
                                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                                clipRule="evenodd"
                              />
                            )}
                          </svg>
                        </button>
                        <div className="flex-1 ml-4">
                          <div className="flex items-center h-10">
                            {Array.from({ length: 8 }).map((_, i) => (
                              <div 
                                key={i}
                                className="w-1 h-2 mx-0.5 bg-green-500 rounded-full"
                                style={{
                                  height: speakingUsers.has(peerRef.current?.id) ? 
                                    `${Math.random() * 12 + 2}px` : '2px'
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </main>
        )}

        {error && (
          <div className="fixed bottom-4 right-4 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg max-w-xs">
            <div className="flex items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 mr-2"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScreenRoom;