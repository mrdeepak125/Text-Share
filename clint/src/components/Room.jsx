import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import io from "socket.io-client";
import toast from "react-hot-toast";

const socket = io("http://localhost:5000"); // Update this with your backend URL

const Room = () => {
  const { roomId } = useParams();
  const [text, setText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [viewers, setViewers] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (roomId) {
      setIsLoading(true);
      socket.emit("join-room", roomId);
    }

    socket.on("text-update", (updatedText) => {
      setText(updatedText);
      setIsLoading(false);
      // toast.success("Room created successfully!");
    });

    socket.on("viewer-update", (viewerCount) => {
      setViewers(viewerCount);
    });

    socket.on("connect_error", (err) => {
      console.error("Connection error:", err);
      setError("Failed to connect to the server. Please try again later.");
      setIsLoading(false);
      toast.error("Failed to connect to the server. Please try again later.");
    });

    return () => {
      socket.off("text-update");
      socket.off("viewer-update");
      socket.off("connect_error");
    };
  }, [roomId]);

  useEffect(() => {
    const typingTimeout = setTimeout(() => setIsTyping(false), 1000);
    return () => clearTimeout(typingTimeout);
  }, []); // Fixed unnecessary dependency

  const handleTextChange = (e) => {
    const newText = e.target.value;
    setText(newText);
    setIsTyping(true);
    socket.emit("text-change", { roomId, text: newText });
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
    toast.success("Text copied to clipboard!");
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error:</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <motion.h2
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-bold mb-4 text-gray-800 dark:text-white"
      >
        Room: {roomId}
      </motion.h2>
      <div className="mb-4">
        <textarea
          value={text}
          onChange={handleTextChange}
          className="w-full h-64 p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
          placeholder="Start typing your text here..."
        ></textarea>
      </div>
      <div className="flex justify-between items-center">
        <div>
          {isTyping && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-gray-500 dark:text-gray-400 flex items-center"
            >
              <span className="mr-2">Someone is typing</span>
              <motion.span
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
              >
                ...
              </motion.span>
            </motion.span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Viewers: {viewers}</span>
          <button
            onClick={handleCopyText}
            className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
          >
            Copy Text
          </button>
        </div>
      </div>
    </div>
  );
};

export default Room;

