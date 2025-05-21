import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Peer from 'peerjs';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FiMic, FiMicOff, FiVideo, FiVideoOff, FiMonitor, FiCopy,
  FiUsers, FiMessageSquare, FiSend, FiX
} from 'react-icons/fi';
import { IoMdExit } from 'react-icons/io';
import { BsArrowsFullscreen } from 'react-icons/bs';
import toast from 'react-hot-toast';
import { LuMonitorOff } from "react-icons/lu";
import { io } from 'socket.io-client';
import Avatar from 'react-avatar';

const ScreenRoom = () => {
  const { roomId } = useParams();
  const [peers, setPeers] = useState({});
  const [myStream, setMyStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState([]);
  const [fullscreenPeer, setFullscreenPeer] = useState(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(false);
  const [activeUsers, setActiveUsers] = useState(0);
  const [screenShareSupported, setScreenShareSupported] = useState(true);

  const myVideoRef = useRef();
  const myScreenRef = useRef();
  const peersRef = useRef({});
  const socketRef = useRef();
  const myPeerRef = useRef();
  const messagesEndRef = useRef();

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Check if screen sharing is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setScreenShareSupported(false);
      toast.error("Screen sharing not supported in this browser");
    }
  }, []);

  const initMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      }).catch(err => {
        console.error("User denied media access", err);
        throw err;
      });
      
      setMyStream(stream);
      if (myVideoRef.current) {
        myVideoRef.current.srcObject = stream;
      }
      setMediaPermissionGranted(true);

      return stream;
    } catch (err) {
      console.error("Failed to get media devices", err);
      toast.error("Could not access camera/microphone. Please check your permissions.");
      setMediaPermissionGranted(false);
      return null;
    }
  }, []);

  const setupPeerConnections = useCallback((stream) => {
    myPeerRef.current.on('open', id => {
      setMyPeerId(id);
      socketRef.current.emit('join-video-room', roomId, id);
    });

    myPeerRef.current.on('call', call => {
      const streamToAnswerWith = isScreenSharing && screenStream ? screenStream : stream;
      call.answer(streamToAnswerWith || undefined);
      call.on('stream', userStream => {
        addPeer(call.peer, userStream, call.metadata?.isScreen);
      });
    });

    socketRef.current.on('user-connected', userId => {
      toast.success(`New user joined: ${userId.slice(0, 5)}`);
      if (stream) {
        connectToNewUser(userId, stream);
      }
    });

    socketRef.current.on('user-disconnected', userId => {
      toast.error(`User left: ${userId.slice(0, 5)}`);
      removePeer(userId);
    });

    socketRef.current.on('room-state', ({ users, messages }) => {
      setUsers(users);
      setMessages(messages || []);
      setActiveUsers(users.length);
    });

    socketRef.current.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    socketRef.current.on('users-updated', (users) => {
      setUsers(users);
      setActiveUsers(users.length);
    });

    socketRef.current.on('media-state-update', (userId, state) => {
      setUsers(prev => prev.map(user => 
        user[0] === userId ? [user[0], { ...user[1], ...state }] : user
      ));
    });

    socketRef.current.on('screen-sharing', (userId, isSharing) => {
      setUsers(prev => prev.map(user => 
        user[0] === userId ? [user[0], { ...user[1], screenSharing: isSharing }] : user
      ));
      if (isSharing) {
        toast.info(`User ${userId.slice(0, 5)} started screen sharing`);
      }
    });

    socketRef.current.on('screen-sharing-status', ({ success, error }) => {
      if (!success) {
        setIsScreenSharing(false);
        toast.error(error || "Screen sharing failed");
      }
    });
  }, [roomId, isScreenSharing, screenStream]);

  // Initialize connection
  useEffect(() => {
    socketRef.current = io('https://text-share-1.onrender.com', {
      path: '/video-socket/'
    });

    myPeerRef.current = new Peer(undefined, {
      host: 'text-share-1.onrender.com',
      port: 443,
      path: '/video-peerjs',
      secure: true
    });

    const initialize = async () => {
      const stream = await initMedia();
      setupPeerConnections(stream);
    };

    initialize();

    return () => {
      if (myStream) myStream.getTracks().forEach(track => track.stop());
      if (screenStream) screenStream.getTracks().forEach(track => track.stop());
      socketRef.current.disconnect();
      if (myPeerRef.current) myPeerRef.current.destroy();
    };
  }, [initMedia, setupPeerConnections]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const connectToNewUser = (userId, stream) => {
    const call = myPeerRef.current.call(userId, isScreenSharing && screenStream ? screenStream : stream, {
      metadata: { isScreen: isScreenSharing }
    });
    call.on('stream', userStream => {
      addPeer(userId, userStream, isScreenSharing);
    });
    call.on('close', () => {
      removePeer(userId);
    });
    peersRef.current[userId] = call;
  };

  const addPeer = (userId, stream, isScreen = false) => {
    setPeers(prev => ({
      ...prev,
      [userId]: { stream, isScreen }
    }));
  };

  const removePeer = (userId) => {
    setPeers(prev => {
      const newPeers = { ...prev };
      delete newPeers[userId];
      return newPeers;
    });
  };

  const toggleAudio = () => {
    if (myStream) {
      const newState = !isAudioMuted;
      myStream.getAudioTracks()[0].enabled = newState;
      setIsAudioMuted(newState);
      socketRef.current.emit('media-state', roomId, myPeerId, { muted: newState });
    }
  };

  const toggleVideo = () => {
    if (myStream) {
      const newState = !isVideoOff;
      myStream.getVideoTracks()[0].enabled = newState;
      setIsVideoOff(newState);
      socketRef.current.emit('media-state', roomId, myPeerId, { videoOff: newState });
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        await startScreenShare();
      } catch (err) {
        console.error("Screen sharing failed:", err);
        toast.error("Could not start screen sharing. Please check your permissions.");
      }
    }
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: true,
        audio: true 
      }).catch(err => {
        console.error("User denied screen share", err);
        throw err;
      });

      // User might close the screen share picker without selecting anything
      if (!stream.getVideoTracks().length) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error("No screen selected");
      }

      setScreenStream(stream);
      setIsScreenSharing(true);
      if (myScreenRef.current) myScreenRef.current.srcObject = stream;
      socketRef.current.emit('screen-sharing', roomId, myPeerId, true);

      // Replace all peer connections with screen stream
      Object.keys(peersRef.current).forEach(userId => {
        peersRef.current[userId].close();
        const call = myPeerRef.current.call(userId, stream, {
          metadata: { isScreen: true }
        });
        call.on('stream', userStream => {
          addPeer(userId, userStream, true);
        });
        peersRef.current[userId] = call;
      });

      // Handle screen share ending
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
        toast.info("Screen sharing stopped");
      };

      return stream;
    } catch (err) {
      console.error("Screen sharing failed", err);
      toast.error("Screen sharing failed or was denied");
      throw err;
    }
  };

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
      socketRef.current.emit('screen-sharing', roomId, myPeerId, false);

      // Switch back to camera for all peers
      if (myStream) {
        Object.keys(peersRef.current).forEach(userId => {
          peersRef.current[userId].close();
          connectToNewUser(userId, myStream);
        });
      }
    }
  };

  const handleSendMessage = () => {
    if (newMessage.trim() === '') return;
    
    const message = {
      id: Date.now(),
      senderId: myPeerId,
      text: newMessage,
      timestamp: new Date().toISOString()
    };
    
    socketRef.current.emit('send-message', roomId, message);
    setNewMessage('');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    toast.success('Room ID copied!');
  };

  const leaveRoom = () => {
    window.location.href = '/';
  };

  const toggleFullscreen = (userId) => {
    setFullscreenPeer(prev => prev === userId ? null : userId);
  };

  const getUserState = (userId) => {
    return users.find(user => user[0] === userId)?.[1] || {};
  };

  const getAvatarProps = (userId) => {
    const colors = ['#FF6633', '#FFB399', '#FF33FF', '#FFFF99', '#00B3E6'];
    const color = colors[parseInt(userId.slice(-1)) % colors.length];
    return {
      name: `User ${userId.slice(0, 5)}`,
      size: "40",
      round: true,
      color
    };
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-blue-600 dark:text-blue-400">Video Chat Room</h1>
          <div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">
            <FiUsers className="text-gray-500 dark:text-gray-300" />
            <span className="font-medium">{activeUsers} online</span>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowChat(!showChat)}
            className="md:hidden flex items-center space-x-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 p-2 rounded-full transition-colors"
          >
            {showChat ? <FiX size={18} /> : <FiMessageSquare size={18} />}
          </button>
          <button
            onClick={copyRoomId}
            className="hidden md:flex items-center space-x-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 px-3 py-1 rounded-full transition-colors"
          >
            <FiCopy className="text-blue-500" />
            <span>Copy Room ID</span>
          </button>
          <button
            onClick={leaveRoom}
            className="flex items-center space-x-1 bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-full transition-colors"
          >
            <IoMdExit />
            <span>Leave</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video Grid */}
        <div className={`${fullscreenPeer || showChat ? 'hidden md:block md:flex-1' : 'flex-1'} bg-gray-200 dark:bg-gray-800 p-4 overflow-auto`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* My Video */}
            <motion.div 
              layout
              className={`relative bg-black rounded-lg overflow-hidden ${fullscreenPeer === myPeerId ? 'hidden' : ''}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              {!mediaPermissionGranted ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 p-4">
                  <div className="text-red-500 mb-2 text-center">
                    <FiVideoOff size={32} className="mx-auto" />
                    <p className="mt-2">Camera/microphone access denied</p>
                  </div>
                  <button 
                    onClick={initMedia}
                    className="mt-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
                  >
                    Retry Permissions
                  </button>
                </div>
              ) : isVideoOff ? (
                <div className="w-full h-full flex items-center justify-center bg-gray-800">
                  <Avatar {...getAvatarProps(myPeerId)} size="80" />
                </div>
              ) : (
                <video
                  ref={myVideoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                You {isAudioMuted && '(Muted)'} {isVideoOff && '(Camera Off)'}
              </div>
              <div className="absolute top-2 right-2 flex space-x-1">
                <button
                  onClick={toggleAudio}
                  className={`p-1 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-gray-700 bg-opacity-70'} text-white`}
                >
                  {isAudioMuted ? <FiMicOff size={16} /> : <FiMic size={16} />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-1 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-gray-700 bg-opacity-70'} text-white`}
                >
                  {isVideoOff ? <FiVideoOff size={16} /> : <FiVideo size={16} />}
                </button>
              </div>
            </motion.div>

            {/* My Screen Share (only visible to others) */}
            {isScreenSharing && (
              <motion.div
                layout
                className="relative bg-black rounded-lg overflow-hidden"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <video
                  ref={myScreenRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                  Your Screen
                </div>
              </motion.div>
            )}

            {/* Other Participants */}
            {Object.entries(peers).map(([userId, { stream, isScreen }]) => {
              const userState = getUserState(userId);
              return (
                <motion.div
                  key={userId}
                  layout
                  className={`relative bg-black rounded-lg overflow-hidden ${fullscreenPeer === userId ? 'hidden' : ''}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {userState.videoOff && !isScreen ? (
                    <div className="w-full h-full flex items-center justify-center bg-gray-800">
                      <Avatar {...getAvatarProps(userId)} size="80" />
                    </div>
                  ) : (
                    <video
                      autoPlay
                      className="w-full h-full object-cover"
                      ref={videoRef => {
                        if (videoRef) videoRef.srcObject = stream;
                      }}
                    />
                  )}
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                    {isScreen ? `Screen (${userId.slice(0, 5)})` : `User ${userId.slice(0, 5)}`}
                    {userState.muted && !isScreen && ' (Muted)'}
                    {userState.videoOff && !isScreen && ' (Camera Off)'}
                  </div>
                  <button
                    onClick={() => toggleFullscreen(userId)}
                    className="absolute top-2 right-2 p-1 bg-gray-700 bg-opacity-70 text-white rounded-full"
                  >
                    <BsArrowsFullscreen size={16} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Fullscreen View */}
        {fullscreenPeer && (
          <div className="flex-1 bg-gray-800 relative">
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-black"
              >
                {fullscreenPeer === myPeerId ? (
                  isVideoOff ? (
                    <div className="flex flex-col items-center">
                      <Avatar {...getAvatarProps(myPeerId)} size="100" />
                      <div className="mt-4 text-white">Your camera is off</div>
                    </div>
                  ) : (
                    <video
                      ref={myVideoRef}
                      autoPlay
                      muted
                      className="max-w-full max-h-full"
                    />
                  )
                ) : (
                  peers[fullscreenPeer]?.isScreen ? (
                    <video
                      autoPlay
                      className="max-w-full max-h-full"
                      ref={videoRef => {
                        if (videoRef && peers[fullscreenPeer]) {
                          videoRef.srcObject = peers[fullscreenPeer].stream;
                        }
                      }}
                    />
                  ) : getUserState(fullscreenPeer).videoOff ? (
                    <div className="flex flex-col items-center">
                      <Avatar {...getAvatarProps(fullscreenPeer)} size="100" />
                      <div className="mt-4 text-white">User&apos;s camera is off</div>
                    </div>
                  ) : (
                    <video
                      autoPlay
                      className="max-w-full max-h-full"
                      ref={videoRef => {
                        if (videoRef && peers[fullscreenPeer]) {
                          videoRef.srcObject = peers[fullscreenPeer].stream;
                        }
                      }}
                    />
                  )
                )}
                <button
                  onClick={() => setFullscreenPeer(null)}
                  className="absolute top-4 right-4 bg-gray-700 bg-opacity-70 text-white p-2 rounded-full hover:bg-gray-600 transition-colors"
                >
                  <BsArrowsFullscreen size={20} />
                </button>
                <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white px-3 py-1 rounded">
                  {fullscreenPeer === myPeerId 
                    ? `You ${isAudioMuted ? '(Muted)' : ''} ${isVideoOff ? '(Camera Off)' : ''}`
                    : `User ${fullscreenPeer.slice(0, 5)}`}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* Chat Panel */}
        <div className={`${showChat ? 'block' : 'hidden'} md:block ${fullscreenPeer ? 'hidden md:block md:w-1/3' : 'w-full md:w-1/3'} bg-white dark:bg-gray-800 border-l dark:border-gray-700 flex flex-col`}>
          <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-semibold flex items-center">
              <FiMessageSquare className="mr-2" />
              Chat ({activeUsers} online)
            </h2>
            <button
              onClick={() => setShowChat(false)}
              className="md:hidden p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              <FiX size={18} />
            </button>
          </div>
          <div className="flex-1 p-4 overflow-auto">
            <div className="space-y-4">
              {messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`flex ${message.senderId === myPeerId ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-xs md:max-w-md rounded-lg p-3 ${message.senderId === myPeerId 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 dark:bg-gray-700'}`}
                  >
                    <div className="flex items-center space-x-2">
                      <Avatar {...getAvatarProps(message.senderId)} size="24" />
                      <div>
                        <div className="text-xs font-semibold">
                          {message.senderId === myPeerId ? 'You' : `User ${message.senderId.slice(0, 5)}`}
                        </div>
                        <div className="mt-1">{message.text}</div>
                        <div className="text-xs mt-1 opacity-70">
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
          <div className="p-4 border-t dark:border-gray-700">
            <div className="flex space-x-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                className="flex-1 p-2 border dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900"
                placeholder="Type a message..."
              />
              <button
                onClick={handleSendMessage}
                className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                <FiSend />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 border-t dark:border-gray-700 p-3 flex justify-center space-x-4">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleAudio}
          className={`p-3 rounded-full flex flex-col items-center ${isAudioMuted ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700'}`}
        >
          {isAudioMuted ? <FiMicOff size={20} /> : <FiMic size={20} />}
          <span className="text-xs mt-1">{isAudioMuted ? 'Unmute' : 'Mute'}</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleVideo}
          className={`p-3 rounded-full flex flex-col items-center ${isVideoOff ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300' : 'bg-gray-100 dark:bg-gray-700'}`}
        >
          {isVideoOff ? <FiVideoOff size={20} /> : <FiVideo size={20} />}
          <span className="text-xs mt-1">{isVideoOff ? 'Start Video' : 'Stop Video'}</span>
        </motion.button>

        <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={screenShareSupported ? toggleScreenShare : () => toast.error("Screen sharing not supported")}
            disabled={!screenShareSupported}
            className={`p-3 rounded-full flex flex-col items-center ${
                isScreenSharing ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300' : 
                !screenShareSupported ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed' : 
                'bg-gray-100 dark:bg-gray-700'
            }`}
            >
            {isScreenSharing ? <LuMonitorOff size={20} /> : <FiMonitor size={20} />}
            <span className="text-xs mt-1">
                {isScreenSharing ? 'Stop Sharing' : 
                !screenShareSupported ? 'Unavailable' : 
                'Share Screen'}
            </span>
            </motion.button>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowChat(!showChat)}
          className="md:hidden p-3 rounded-full flex flex-col items-center bg-gray-100 dark:bg-gray-700"
        >
          <FiMessageSquare size={20} />
          <span className="text-xs mt-1">Chat</span>
        </motion.button>
      </div>
    </div>
  );
};

export default ScreenRoom;