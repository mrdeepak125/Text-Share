"use client"

import { BrowserRouter as Router, Route, Routes } from "react-router-dom"
import { useState, useEffect } from "react"
import Navbar from "./components/Navbar"
import Home from "./components/Home.jsx"
import Room from "./components/Room"
import { Toaster } from "react-hot-toast"
import { Analytics } from "@vercel/analytics/react"

function App() {
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    const savedMode = localStorage.getItem("darkMode")
    if (savedMode) {
      setDarkMode(JSON.parse(savedMode))
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("darkMode", JSON.stringify(darkMode))
    if (darkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [darkMode])

  const toggleDarkMode = () => {
    setDarkMode(!darkMode)
  }

  return (
    <>
    <Analytics />
    <Toaster position="top-right" reverseOrder={false} />
    <Router>
      <div className={`relative min-h-screen ${darkMode ? "dark" : ""}`}>
        <div className="absolute inset-0 -z-10 h-full w-full items-center px-5 py-24 [background:radial-gradient(125%_125%_at_50%_10%,#000_40%,#63e_100%)]"></div>
        <Navbar darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
        </Routes>
      </div>
    </Router>
    </>
  )
}

export default App