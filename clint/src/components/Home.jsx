"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

const Home = () => {
  const [roomCode, setRoomCode] = useState("");
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    const newRoomCode = Math.random().toString(36).substring(2, 6);
    navigate(`/room/${newRoomCode}`);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (roomCode.length === 4) {
      navigate(`/room/${roomCode}`);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <motion.h1
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-4xl font-bold text-center mb-8 text-gray-800 dark:text-white"
      >
        Welcome to TextShare
      </motion.h1>
      <div className="max-w-md mx-auto">
        <form onSubmit={handleJoinRoom} className="mb-4">
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            placeholder="Enter room code"
            className="w-full px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            maxLength={4}
          />
          <button
            type="submit"
            className="mt-2 w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
          >
            Join Room
          </button>
        </form>
        <button
          onClick={handleCreateRoom}
          className="w-full bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 transition-colors"
        >
          Create New Room
        </button>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="mt-16 text-center"
      >
        <p className="text-xl text-gray-600 dark:text-gray-300">Share your text with others in real-time!</p>
        <div className="flex justify-center mt-4 space-x-4">
          {["🚀", "💡", "🔗", "🌟"].map((emoji, index) => (
            <motion.span
              key={index}
              className="text-4xl"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, delay: index * 0.2 }}
            >
              {emoji}
            </motion.span>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default Home;

