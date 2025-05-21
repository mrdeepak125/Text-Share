const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map(); // roomId -> Set of socketIds
const MAX_ROOM_CAPACITY = 2;

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-room', (roomId, userId) => {
    // Check room capacity
    const room = rooms.get(roomId) || new Set();
    if (room.size >= MAX_ROOM_CAPACITY) {
      socket.emit('room-full');
      return;
    }

    socket.join(roomId);
    rooms.set(roomId, room.add(userId));
    
    // Notify others in the room
    socket.to(roomId).emit('user-connected', userId);
    
    // Send current room participants to the new user
    const participants = Array.from(room).filter(id => id !== userId);
    socket.emit('current-participants', participants);

    // Update all clients with participant count
    io.to(roomId).emit('participant-count', room.size);

    socket.on('disconnect', () => {
      room.delete(userId);
      socket.to(roomId).emit('user-disconnected', userId);
      io.to(roomId).emit('participant-count', room.size);
      
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    });

    socket.on('signal', ({ to, signal }) => {
      io.to(to).emit('signal', { from: userId, signal });
    });

    socket.on('speaking', (isSpeaking) => {
      socket.to(roomId).emit('user-speaking', { userId, isSpeaking });
    });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));