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

// MongoDB connection with improved settings
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

const RoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, index: true },
  text: String,
}, {
  timestamps: true,
  bufferCommands: false,
  autoIndex: true,
});

const Room = mongoose.model("Room", RoomSchema);

// Cache for frequently accessed rooms
const roomCache = new Map();

// Debounce function to limit database updates
const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

app.get("/", (req, res) => {
  res.send("Server is working properly");
});

// Track active typing users by room
const activeTypers = new Map();

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-room", async (roomId) => {
    try {
      socket.join(roomId);
      
      // Check cache first
      if (roomCache.has(roomId)) {
        socket.emit("text-update", roomCache.get(roomId));
      } else {
        const room = await Room.findOne({ roomId }).lean();
        if (room) {
          roomCache.set(roomId, room.text);
          socket.emit("text-update", room.text);
        } else {
          const newRoom = new Room({ roomId, text: "" });
          await newRoom.save();
          roomCache.set(roomId, "");
          socket.emit("text-update", "");
        }
      }
      
      const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
      io.to(roomId).emit("viewer-update", roomSize);
      
      // Initialize typing tracker for this room if not exists
      if (!activeTypers.has(roomId)) {
        activeTypers.set(roomId, new Set());
      }
    } catch (err) {
      console.error("Join room error:", err);
    }
  });

  // Optimized text change handler with debouncing
  const handleTextChange = debounce(async ({ roomId, text }) => {
    try {
      await Room.findOneAndUpdate(
        { roomId }, 
        { text }, 
        { upsert: true, new: true }
      );
      roomCache.set(roomId, text);
    } catch (err) {
      console.error("Error updating room text:", err);
    }
  }, 500);

  socket.on("text-change", ({ roomId, text }) => {
    socket.to(roomId).emit("text-update", text);
    handleTextChange({ roomId, text });
  });

  // Typing indicator handlers
  socket.on("start-typing", (roomId) => {
    if (!activeTypers.has(roomId)) {
      activeTypers.set(roomId, new Set());
    }
    activeTypers.get(roomId).add(socket.id);
    updateTypingIndicators(roomId);
  });

  socket.on("stop-typing", (roomId) => {
    if (activeTypers.has(roomId)) {
      activeTypers.get(roomId).delete(socket.id);
      updateTypingIndicators(roomId);
    }
  });

  function updateTypingIndicators(roomId) {
    const typers = activeTypers.get(roomId);
    const count = typers ? typers.size : 0;
    io.to(roomId).emit("typing-update", { 
      count,
      userIds: typers ? Array.from(typers) : []
    });
  }

  socket.on("disconnecting", () => {
    // Clear typing indicators for this user
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id && activeTypers.has(roomId)) {
        activeTypers.get(roomId).delete(socket.id);
        updateTypingIndicators(roomId);
      }
    }
    
    // Update viewer counts
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit("viewer-update", roomSize - 1);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});