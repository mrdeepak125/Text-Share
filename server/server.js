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
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
})

app.use(cors())
app.use(express.json())

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})

const RoomSchema = new mongoose.Schema({
  roomId: String,
  text: String,
})

const Room = mongoose.model("Room", RoomSchema)

io.on("connection", (socket) => {
  console.log("A user connected")

  socket.on("join-room", async (roomId) => {
    socket.join(roomId)
    const room = await Room.findOne({ roomId })
    if (room) {
      socket.emit("text-update", room.text)
    } else {
      const newRoom = new Room({ roomId, text: "" })
      await newRoom.save()
      socket.emit("text-update", "")
    }
    io.to(roomId).emit("viewer-update", io.sockets.adapter.rooms.get(roomId).size)
  })

  socket.on("text-change", async ({ roomId, text }) => {
    await Room.findOneAndUpdate({ roomId }, { text }, { upsert: true })
    socket.to(roomId).emit("text-update", text)
  })

  socket.on("disconnecting", () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        io.to(room).emit("viewer-update", io.sockets.adapter.rooms.get(room).size - 1)
      }
    }
  })

  socket.on("disconnect", () => {
    console.log("A user disconnected")
  })
})

const PORT = process.env.PORT || 5000
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

