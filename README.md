# 🚀 CallBuddy AI

> **An AI-powered real-time voice communication platform built with WebRTC, Socket.IO and LLMs.**

CallBuddy AI is a next-generation communication platform where friends can talk naturally in real-time while an intelligent AI assistant joins the conversation when needed.

Unlike a traditional chatbot, CallBuddy behaves like another participant in the room. Users control exactly when the AI can listen, respond, and who can hear its responses.

---

# ✨ Features

## 🔐 Authentication

* User Signup & Login
* JWT Authentication
* Secure Protected Routes
* Session Restoration

---

## 🎙️ Voice Rooms

* Create Voice Rooms
* Share Room Links
* Host Auto Join
* Guest Join
* Anonymous Guest Support
* Room Participant Management
* Voice Archive
* End Room Flow

---

## 📞 Real-Time Communication

* WebRTC Audio Calling
* Socket.IO Signaling
* Low-Latency Communication
* STUN Server Integration
* Automatic Peer Connection
* Real-Time Transcript Updates

---

## 🤖 AI Assistant

* AI Voice Assistant
* Context-Aware Responses
* Conversation Memory
* Speech-to-Text
* Text-to-Speech
* AI Private Mode
* AI Shared Mode

---

## 🎤 Triple Audio System (V3)

Every participant has independent controls.

### Friend Mic

* Friends hear you
* AI can be disabled independently

### AI Mic

* AI listens only when enabled
* No hidden listening
* No transcript when disabled

### AI Speaker

* Private AI responses
* Shared AI responses
* User-controlled AI privacy

---

## 👥 Smart Participant Panel

* Host Indicator
* Guest Indicator
* Online Status
* Joined Participants
* Recently Left Participants
* Speaking Status
* AI Status

---

## 🧠 AI Communication

CallBuddy behaves like a real participant instead of a traditional chatbot.

The AI can:

* Answer questions
* Remember conversation context
* Participate naturally
* Maintain privacy
* Speak using Text-to-Speech

---

## 📱 Responsive Design

* Desktop
* Tablet
* Mobile

Optimized for modern browsers.

---

# 🛠 Tech Stack

## Frontend

* React (Vite)
* Axios
* Socket.IO Client
* WebRTC
* Web Speech API
* Speech Synthesis API
* Lucide Icons
* CSS3

---

## Backend

* Node.js
* Express.js
* Socket.IO
* MongoDB
* Mongoose
* JWT
* Groq API
* dotenv

---

## Database

MongoDB

---

## Real-Time Communication

* WebRTC
* Socket.IO

---

# 🏗️ Architecture

```text
               Users
                  │
      ┌───────────┴───────────┐
      │                       │
 React Frontend         React Frontend
      │                       │
      └───────────┬───────────┘
                  │
             Socket.IO
                  │
         Express + Node.js
                  │
        ┌─────────┴─────────┐
        │                   │
     MongoDB             Groq AI
```

---

# ⚙️ Installation

## Clone Repository

```bash
git clone https://github.com/Rishi-dev-pro/CallBuddy-AI.git

cd CallBuddy-AI
```

---

## Backend

```bash
cd backend

npm install

npm run dev
```

---

## Frontend

```bash
cd frontend

npm install

npm run dev
```

---

# 🔑 Environment Variables

## Backend

Create:

```text
backend/.env
```

Example:

```env
PORT=5000

MONGO_URI=YOUR_MONGODB_URI

JWT_SECRET=YOUR_SECRET

GROQ_API_KEY=YOUR_GROQ_KEY

CORS_ORIGINS=http://localhost:5173
```

---

## Frontend

Create:

```text
frontend/.env
```

Example:

```env
VITE_API_URL=http://localhost:5000

VITE_PUBLIC_APP_URL=http://localhost:5173
```

---

# 📂 Project Structure

```text
CallBuddy-AI

├── frontend
│   ├── src
│   ├── public
│   └── ...
│
├── backend
│   ├── models
│   ├── routes
│   ├── server.js
│   └── ...
│
└── README.md
```

---

# 🔒 Privacy

CallBuddy gives users complete control over AI interaction.

* Friend Mic Control
* AI Mic Control
* AI Speaker Privacy
* User-Controlled AI Listening
* User-Controlled AI Responses

The AI never listens unless the user explicitly enables AI Mic.

---

# 🚧 Roadmap

## ✅ V1

* Authentication
* Voice Rooms
* WebRTC
* AI Responses

---

## ✅ V2

* Stable Voice Platform
* Host Auto Join
* Guest Join
* Voice Archive
* Improved AI

---

## 🚀 V3

* Triple Audio System
* Participant Panel
* AI Privacy Controls
* Improved AI Context
* Better UI
* Better Mobile Experience

---

## 🔮 Future

* Live Meeting Notes
* AI Memory Dashboard
* Smarter Speech Recognition
* Better AI Voice
* Production Deployment
* Named Cloudflare Tunnel

---

# 👨‍💻 Developer

**Rishi Kumar Shaw**

Full Stack Developer

Brainware University

Passionate about

* Artificial Intelligence
* Full Stack Development
* WebRTC
* Real-Time Systems
* Machine Learning

GitHub

https://github.com/Rishi-dev-pro

---

# ⭐ Support

If you like this project,

please consider giving it a ⭐ on GitHub.

It helps the project grow and motivates future development.

---

# 📄 License

This project is licensed under the MIT License.

---

<p align="center">
Made by <strong>Rishi Kumar Shaw</strong>
</p>
