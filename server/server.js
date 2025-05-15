import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import mongoose from "mongoose"
import cors from "cors"
import dotenv from "dotenv"

dotenv.config()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: "https://dtext.vercel.app",
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
})

app.use(cors())
app.use(express.json())

// MongoDB connection with improved settings
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 50, // Increased connection pool size
  wtimeoutMS: 2500,
}).then(() => {
  console.log("MongoDB connected successfully");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

const RoomSchema = new mongoose.Schema({
  roomId: String,
  text: String,
}, {
  timestamps: true, // Add createdAt and updatedAt timestamps
  bufferCommands: false, // Disable command buffering for faster operations
  autoIndex: true, // Enable automatic index creation
})

const Room = mongoose.model("Room", RoomSchema)

// Cache for frequently accessed rooms
const roomCache = new Map()

// Debounce function to limit database updates
const debounce = (func, delay) => {
  let timeoutId
  return (...args) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

app.get("/", (req, res) => {
  res.send("Server is working properly")
})

io.on("connection", (socket) => {
  console.log("A user connected")

  // Track typing users
  const typingUsers = new Map()

  socket.on("join-room", async (roomId) => {
    socket.join(roomId)
    
    // Check cache first
    if (roomCache.has(roomId)) {
      socket.emit("text-update", roomCache.get(roomId))
    } else {
      const room = await Room.findOne({ roomId }).lean()
      if (room) {
        roomCache.set(roomId, room.text)
        socket.emit("text-update", room.text)
      } else {
        const newRoom = new Room({ roomId, text: "" })
        await newRoom.save()
        roomCache.set(roomId, "")
        socket.emit("text-update", "")
      }
    }
    
    const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0
    io.to(roomId).emit("viewer-update", roomSize)
  })

  // Optimized text change handler with debouncing
  const handleTextChange = debounce(async ({ roomId, text }) => {
    try {
      await Room.findOneAndUpdate(
        { roomId }, 
        { text }, 
        { upsert: true, new: true }
      )
      roomCache.set(roomId, text)
    } catch (err) {
      console.error("Error updating room text:", err)
    }
  }, 500) // 500ms debounce delay

  socket.on("text-change", ({ roomId, text }) => {
    // Immediately broadcast to other users in the room
    socket.to(roomId).emit("text-update", text)
    // Queue the database update
    handleTextChange({ roomId, text })
  })

  // Typing indicator handlers
  socket.on("start-typing", (roomId) => {
    typingUsers.set(socket.id, roomId)
    socket.to(roomId).emit("user-typing", { 
      userId: socket.id, 
      isTyping: true 
    })
  })

  socket.on("stop-typing", (roomId) => {
    typingUsers.delete(socket.id)
    socket.to(roomId).emit("user-typing", { 
      userId: socket.id, 
      isTyping: false 
    })
  })

  socket.on("disconnecting", () => {
    // Clear typing indicators for this user
    for (const [userId, roomId] of typingUsers) {
      if (userId === socket.id) {
        socket.to(roomId).emit("user-typing", { 
          userId: socket.id, 
          isTyping: false 
        })
      }
    }
    
    // Update viewer counts
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0
        io.to(room).emit("viewer-update", roomSize - 1)
      }
    }
  })

  socket.on("disconnect", () => {
    console.log("A user disconnected")
    typingUsers.delete(socket.id)
  })
})

const PORT = process.env.PORT || 5000
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})