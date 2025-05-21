import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ExpressPeerServer } from 'peer';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Configure CORS properly
app.use(cors({
  origin: ["https://dtext.vercel.app", "http://localhost:5173", "http://192.168.133.187:5173"],
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

// Add middleware to handle preflight requests
app.options('*', cors());

// Socket.IO Server with proper path configuration
const io = new Server(httpServer, {
  cors: {
    origin: ["https://dtext.vercel.app", "http://localhost:5173", "http://192.168.133.187:5173"],
    methods: ["GET", "POST"],
    credentials: true
  },
  path: '/video-socket/',
  transports: ['websocket', 'polling']
});

app.get("/", (req, res) => {
  res.send("Video Server is working properly");
});

// Enhanced PeerJS Server configuration
const peerServer = ExpressPeerServer(httpServer, {
  debug: true,
  path: '/video-peerjs',
  proxied: true,
  allow_discovery: true,
  key: 'peerjs',
  ssl: process.env.NODE_ENV === 'production' ? {} : undefined
});

// Add error handling for PeerJS
peerServer.on('connection', (client) => {
  console.log(`Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`Peer disconnected: ${client.getId()}`);
});

app.use('/video-peerjs', peerServer);

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Room state management
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-video-room', (roomId, userId) => {
    console.log(`User ${userId} joining room ${roomId}`);
    socket.join(roomId);
    
    // Initialize room if not exists
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        users: new Map(),
        messages: []
      });
    }
    
    const room = rooms.get(roomId);
    room.users.set(userId, { 
      muted: false, 
      videoOff: false,
      screenSharing: false,
      peerId: userId
    });
    
    // Notify others in the room with error handling
    try {
      socket.to(roomId).emit('user-connected', userId);
    } catch (error) {
      console.error('Error notifying user connection:', error);
    }
    
    // Send current room state to the new user
    try {
      socket.emit('room-state', {
        users: Array.from(room.users.entries()),
        messages: room.messages
      });
    } catch (error) {
      console.error('Error sending room state:', error);
    }

    // Notify all users about the updated user list
    try {
      io.to(roomId).emit('users-updated', Array.from(room.users.entries()));
    } catch (error) {
      console.error('Error updating user list:', error);
    }
  });

  // Enhanced message handling with error handling
  socket.on('send-message', (roomId, message) => {
    try {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.messages.push(message);
        io.to(roomId).emit('new-message', message);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  // Enhanced media state updates with error handling
  socket.on('media-state', (roomId, userId, state) => {
    try {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (room.users.has(userId)) {
          const user = room.users.get(userId);
          Object.assign(user, state);
          socket.to(roomId).emit('media-state-update', userId, state);
        }
      }
    } catch (error) {
      console.error('Error updating media state:', error);
    }
  });

  // Enhanced screen sharing with permission checks
  socket.on('screen-sharing', (roomId, userId, isSharing) => {
    try {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (room.users.has(userId)) {
          room.users.get(userId).screenSharing = isSharing;
          io.to(roomId).emit('screen-sharing', userId, isSharing);
          
          // Additional event to confirm screen sharing status
          socket.emit('screen-sharing-status', { success: true, isSharing });
        }
      }
    } catch (error) {
      console.error('Error handling screen sharing:', error);
      socket.emit('screen-sharing-status', { success: false, error: error.message });
    }
  });

  // Add heartbeat to detect dead connections
  socket.on('heartbeat', () => {
    socket.emit('heartbeat-ack');
  });

  // Disconnection handling with cleanup
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const [roomId, room] of rooms) {
      if (room.users.has(socket.id)) {
        try {
          socket.to(roomId).emit('user-disconnected', socket.id);
          room.users.delete(socket.id);
          
          // Clean up empty rooms
          if (room.users.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
          } else {
            // Notify remaining users about the updated user list
            io.to(roomId).emit('users-updated', Array.from(room.users.entries()));
          }
        } catch (error) {
          console.error('Error during disconnection cleanup:', error);
        }
        break;
      }
    }
  });
});

// Add error handling for the HTTP server
httpServer.on('error', (error) => {
  console.error('Server error:', error);
});

const PORT = process.env.VIDEO_PORT || 5001;
httpServer.listen(PORT, () => {
  console.log(`Video server running on port ${PORT}`);
  console.log(`Socket.IO path: /video-socket/`);
  console.log(`PeerJS path: /video-peerjs`);
});