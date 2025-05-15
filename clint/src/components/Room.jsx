import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import io from "socket.io-client";
import toast from "react-hot-toast";
import { FiCopy, FiUsers, FiEdit2 } from "react-icons/fi";

const socket = io("https://text-share-kzce.onrender.com", {
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

const Room = () => {
  const { roomId } = useParams();
  const [text, setText] = useState("");
  const [typingUsers, setTypingUsers] = useState({});
  const [viewers, setViewers] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(() => {
    // Get theme from localStorage or default to light
    const savedTheme = localStorage.getItem('darkMode');
    return savedTheme === 'true' ? 'dark' : 'light';
  });
  const typingTimeoutRef = useRef(null);
  const textareaRef = useRef(null);

    useEffect(() => {
    localStorage.setItem('darkMode', theme === 'dark');
  }, [theme]);

    const toggleTheme = () => {
    setTheme(prev => prev === "light" ? "dark" : "light");
  };

  // Join room and set up socket listeners
  useEffect(() => {
    if (!roomId) return;

    setIsLoading(true);
    socket.emit("join-room", roomId);

    socket.on("text-update", (updatedText) => {
      setText(updatedText);
      setIsLoading(false);
    });

    socket.on("viewer-update", (viewerCount) => {
      setViewers(viewerCount);
    });

    socket.on("user-typing", ({ userId, isTyping }) => {
      setTypingUsers(prev => {
        const newState = { ...prev };
        if (isTyping) {
          newState[userId] = true;
        } else {
          delete newState[userId];
        }
        return newState;
      });
    });

    socket.on("connect_error", (err) => {
      console.error("Connection error:", err);
      setError("Connection issues. Trying to reconnect...");
      toast.error("Connection issues. Trying to reconnect...");
    });

    return () => {
      socket.off("text-update");
      socket.off("viewer-update");
      socket.off("user-typing");
      socket.off("connect_error");
    };
  }, [roomId]);

  // Handle text changes with typing indicators
  const handleTextChange = (e) => {
    const newText = e.target.value;
    setText(newText);
    
    // Emit typing start if not already typing
    if (!typingTimeoutRef.current) {
      socket.emit("start-typing", roomId);
    }
    
    // Clear any existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set new timeout for typing end
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stop-typing", roomId);
      typingTimeoutRef.current = null;
    }, 1000);
    
    // Emit text change
    socket.emit("text-change", { roomId, text: newText });
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
    toast.success("Text copied to clipboard!");
  };

  const focusTextarea = () => {
    textareaRef.current?.focus();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"
          />
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-lg text-gray-700 dark:text-gray-300"
          >
            Connecting to room...
          </motion.p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-900 dark:to-gray-800">
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 max-w-md rounded-lg shadow-lg dark:bg-red-900 dark:border-red-700 dark:text-red-100">
          <div className="flex items-center">
            <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="font-bold">Connection Error</h3>
          </div>
          <p className="mt-2">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const typingUsersCount = Object.keys(typingUsers).length;
  const isSomeoneTyping = typingUsersCount > 0;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme === "dark" ? "dark bg-gray-900" : "bg-gray-50"}`}>
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-between items-center mb-8"
        >
          <div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
              TextEdit
            </h1>
            <p className="text-gray-500 dark:text-gray-400">Room: {roomId}</p>
          </div>
          
          <div className="flex items-center space-x-4">
           <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <svg className="w-6 h-6 text-gray-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
                    
            <div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded-full">
              <FiUsers className="text-gray-500 dark:text-gray-400" />
              <span className="font-medium text-sky-50">{viewers}</span>
            </div>
          </div>
        </motion.header>

        {/* Main Editor */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mb-6 relative"
        >
          <div className="absolute -top-3 -right-3">
            <button
              onClick={focusTextarea}
              className="p-2 bg-blue-500 text-white rounded-full shadow-lg hover:bg-blue-600 transition-colors"
              aria-label="Focus editor"
            >
              <FiEdit2 />
            </button>
          </div>
          
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            className={`w-full h-96 p-6 text-lg rounded-xl shadow-sm border transition-all duration-300 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:shadow-lg ${
              theme === "dark" 
                ? "bg-gray-800 text-gray-100 border-gray-700" 
                : "bg-white text-gray-800 border-gray-200"
            }`}
            placeholder="Start collaborating with others in real-time..."
          />
        </motion.div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex justify-between items-center"
        >
          <AnimatePresence>
            {isSomeoneTyping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex items-center space-x-2 bg-blue-100 dark:bg-blue-900 px-4 py-2 rounded-full"
              >
                <div className="flex space-x-1">
                  {[1, 2, 3].map(i => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -5, 0] }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        delay: i * 0.2
                      }}
                      className="w-2 h-2 bg-blue-500 rounded-full"
                    />
                  ))}
                </div>
                <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  {typingUsersCount} {typingUsersCount === 1 ? "person is" : "people are"} typing...
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={handleCopyText}
            className="flex items-center space-x-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-full shadow hover:shadow-lg transition-all"
          >
            <FiCopy />
            <span>Copy Text</span>
          </button>
        </motion.footer>

        {/* Watermark */}
        <motion.div 
          className="mt-12 text-center text-gray-400 dark:text-gray-600 text-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Real-time collaborative editing • Changes saved automatically
        </motion.div>
      </div>
    </div>
  );
};

export default Room;