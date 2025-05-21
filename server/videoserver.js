import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["https://dtext.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

app.use(cors({
  origin: ["https://dtext.vercel.app", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 50,
  wtimeoutMS: 2500,
}).then(() => {
  console.log("MongoDB connected successfully");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

// Room Schema for video sessions
const VideoRoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, index: true },
  participants: [{
    userId: String,
    socketId: String,
    joinedAt: Date
  }],
  activeConnections: { type: Number, default: 0 }
}, {
  timestamps: true,
  bufferCommands: false,
  autoIndex: true,
});

const VideoRoom = mongoose.model("VideoRoom", VideoRoomSchema);

// Cache for frequently accessed rooms
const roomCache = new Map();
const MAX_ROOM_CAPACITY = 2;

// Track active connections by room
const activeConnections = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-video-room", async (roomId, userId) => {
    try {
      // Check if room exists in cache
      if (roomCache.has(roomId)) {
        const cachedRoom = roomCache.get(roomId);
        if (cachedRoom.participants.length >= MAX_ROOM_CAPACITY) {
          socket.emit("room-full");
          return;
        }
      }

      // Check MongoDB if not in cache
      let room = await VideoRoom.findOne({ roomId }).lean();
      if (!room) {
        room = new VideoRoom({
          roomId,
          participants: [{
            userId,
            socketId: socket.id,
            joinedAt: new Date()
          }],
          activeConnections: 1
        });
        await room.save();
      } else {
        if (room.participants.length >= MAX_ROOM_CAPACITY) {
          socket.emit("room-full");
          return;
        }

        // Add participant if room exists
        await VideoRoom.updateOne(
          { roomId },
          {
            $push: {
              participants: {
                userId,
                socketId: socket.id,
                joinedAt: new Date()
              }
            },
            $inc: { activeConnections: 1 }
          }
        );
      }

      // Update cache
      roomCache.set(roomId, {
        participants: [...(room?.participants || []), { userId, socketId: socket.id }],
        activeConnections: (room?.activeConnections || 0) + 1
      });

      socket.join(roomId);
      
      // Notify others in the room
      socket.to(roomId).emit("user-connected", userId);
      
      // Send current room participants to the new user
      const participants = roomCache.get(roomId).participants
        .filter(p => p.userId !== userId)
        .map(p => p.userId);
      
      socket.emit("current-participants", participants);

      // Update all clients with participant count
      const participantCount = roomCache.get(roomId).participants.length;
      io.to(roomId).emit("participant-count", participantCount);

      // WebRTC signaling handlers
      socket.on("signal", ({ to, signal }) => {
        io.to(to).emit("signal", { from: userId, signal });
      });

      socket.on("speaking", (isSpeaking) => {
        socket.to(roomId).emit("user-speaking", { userId, isSpeaking });
      });

      socket.on("mute-state", (isMuted) => {
        socket.to(roomId).emit("user-mute-state", { userId, isMuted });
      });

    } catch (err) {
      console.error("Error joining video room:", err);
      socket.emit("room-error", "Failed to join room");
    }
  });

  socket.on("disconnecting", async () => {
    try {
      // Find all rooms this socket is in
      const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
      
      for (const roomId of rooms) {
        // Update MongoDB
        await VideoRoom.updateOne(
          { roomId },
          {
            $pull: { participants: { socketId: socket.id } },
            $inc: { activeConnections: -1 }
          }
        );

        // Update cache
        if (roomCache.has(roomId)) {
          const cachedRoom = roomCache.get(roomId);
          const updatedParticipants = cachedRoom.participants
            .filter(p => p.socketId !== socket.id);
          
          roomCache.set(roomId, {
            participants: updatedParticipants,
            activeConnections: cachedRoom.activeConnections - 1
          });

          // Notify remaining participants
          const userId = cachedRoom.participants.find(p => p.socketId === socket.id)?.userId;
          if (userId) {
            socket.to(roomId).emit("user-disconnected", userId);
          }

          // Update participant count
          const participantCount = updatedParticipants.length;
          io.to(roomId).emit("participant-count", participantCount);
        }
      }
    } catch (err) {
      console.error("Error handling disconnection:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Cleanup inactive rooms periodically
setInterval(async () => {
  try {
    const inactiveRooms = await VideoRoom.find({ 
      updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24 hours
    });
    
    for (const room of inactiveRooms) {
      await VideoRoom.deleteOne({ _id: room._id });
      roomCache.delete(room.roomId);
      console.log(`Cleaned up inactive room: ${room.roomId}`);
    }
  } catch (err) {
    console.error("Error cleaning up rooms:", err);
  }
}, 60 * 60 * 1000); // Run hourly

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});