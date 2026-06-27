const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const OpenAI = require("openai");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Session = require("./models/Session");
const User = require("./models/User");
const VoiceRoom = require("./models/VoiceRoom");
const { createSpeechProvider } = require("./services/speechProvider");
const { createVoiceRoomAudioPipeline } = require("./services/voiceRoomAudioPipeline");
const {
  shouldCallBuddyReply: shouldCallBuddyReplyFromMemory,
} = require("./services/voiceRoomAi");

require("dotenv").config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
    const isCloudflareTunnel =
      protocol === "https:" &&
      (hostname === "trycloudflare.com" ||
        hostname.endsWith(".trycloudflare.com"));

    return isLocalhost || isCloudflareTunnel;
  } catch {
    return false;
  }
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      callback(isOriginAllowed(origin) ? null : new Error("Origin not allowed"), true);
    },
    methods: ["GET", "POST"],
  },
});


const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const speechProvider = createSpeechProvider({ client: groq });
let voiceRoomAudioPipeline = null;
const apiRateLimits = new Map();

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
}

function apiRateLimit(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();

  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = Number(process.env.API_RATE_WINDOW_MS || 60_000);
  const maxRequests = Number(process.env.API_RATE_MAX_REQUESTS || 180);
  const entry = apiRateLimits.get(key) || {
    count: 0,
    resetAt: now + windowMs,
  };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count += 1;
  apiRateLimits.set(key, entry);

  if (entry.count > maxRequests) {
    return res.status(429).json({
      error: "Too many requests. Please slow down and try again.",
    });
  }

  next();
}

app.use(
  cors({
    origin: (origin, callback) => {
      callback(isOriginAllowed(origin) ? null : new Error("Origin not allowed"), true);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

app.use(securityHeaders);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "8mb" }));
app.use(apiRateLimit);


/* =========================
   SOCKET.IO + WEBRTC SIGNALING
========================= */

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("voice-room:join", ({ roomId, participant }) => {
    if (!roomId || !participant?.participantId) return;

    const socketRoom = `voice-room:${roomId}`;

    socket.join(socketRoom);

    /*
      Tell the new participant which already-connected browsers
      they need to make WebRTC connections to.
    */
    const existingSocketIds = [];

    for (const socketId of io.sockets.adapter.rooms.get(socketRoom) || []) {
      if (socketId !== socket.id) {
        existingSocketIds.push(socketId);
      }
    }

    socket.emit("webrtc:existing-peers", {
      peerIds: existingSocketIds,
    });

    socket.to(socketRoom).emit("webrtc:peer-joined", {
      peerId: socket.id,
      participant,
    });

    socket.to(socketRoom).emit("voice-room:participant-joined", {
      participant,
    });
  });

  socket.on("voice-room:audio-chunk", (payload) => {
    if (!voiceRoomAudioPipeline) {
      socket.emit("voice-room:speech-error", {
        error: "Voice transcription is not ready yet.",
      });
      return;
    }

    voiceRoomAudioPipeline.handleAudioChunk(socket, payload);
  });

  socket.on("voice-room:privacy-state", ({ roomId, participant, state }) => {
    if (!roomId || !participant?.participantId || !state) return;

    socket.to(`voice-room:${roomId}`).emit("voice-room:privacy-state", {
      participant,
      state,
      updatedAt: new Date().toISOString(),
    });
  });

  /*
    WebRTC signaling:
    These events only pass connection setup data.
    Actual microphone audio travels browser-to-browser through WebRTC.
  */
  socket.on("webrtc:offer", ({ targetPeerId, offer }) => {
    if (!targetPeerId || !offer) return;

    io.to(targetPeerId).emit("webrtc:offer", {
      fromPeerId: socket.id,
      offer,
    });
  });

  socket.on("webrtc:answer", ({ targetPeerId, answer }) => {
    if (!targetPeerId || !answer) return;

    io.to(targetPeerId).emit("webrtc:answer", {
      fromPeerId: socket.id,
      answer,
    });
  });

  socket.on("webrtc:ice-candidate", ({ targetPeerId, candidate }) => {
    if (!targetPeerId || !candidate) return;

    io.to(targetPeerId).emit("webrtc:ice-candidate", {
      fromPeerId: socket.id,
      candidate,
    });
  });

  socket.on("voice-room:leave", ({ roomId, participant }) => {
    if (!roomId || !participant?.participantId) return;

    const socketRoom = `voice-room:${roomId}`;

    socket.to(socketRoom).emit("webrtc:peer-left", {
      peerId: socket.id,
      participant,
    });

    socket.to(socketRoom).emit("voice-room:participant-left", {
      participant,
    });

    socket.leave(socketRoom);
  });

  socket.on("disconnecting", () => {
    for (const socketRoom of socket.rooms) {
      if (socketRoom.startsWith("voice-room:")) {
        socket.to(socketRoom).emit("webrtc:peer-left", {
          peerId: socket.id,
        });
      }
    }
  });

  socket.on("disconnect", () => {
    voiceRoomAudioPipeline?.cleanupSocket(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const SYSTEM_PROMPT = `
You are CallBuddy AI, a friendly conversational voice-agent project created by Rishi.

Your identity:
- Your name is CallBuddy AI.
- You were created by Rishi as a college/project demonstration.
- Your purpose is to have natural short conversations, explain the project, and later make consent-based demonstration phone calls.
- You are currently chatting through text, so never claim that you are on a phone call or that you made a call.

Conversation style:
- Be warm, respectful, natural, and friend-like.
- Keep answers concise: usually 1 to 4 sentences.
- You are especially helpful with coding, debugging, web apps, APIs, databases, deployment, security basics, and system design.
- For coding questions, give the practical next step first, then explain only as much as needed.
- You may use simple Hinglish if the user writes in Hinglish.
- If someone asks who created you, say Rishi created you.
- If someone asks what technologies were used, say Node.js, Express, Groq API, React frontend, MongoDB database, and browser voice technology.
- If someone asks whether you are a real person, clearly say you are an AI.
- If someone asks something you do not know, say so instead of inventing details.
`;

function createSessionTitle(message) {
  const cleaned = message
    .replace(/[^\w\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");

  return cleaned
    ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    : "New Transmission";
}

function getSessionSummary(session) {
  return {
    id: session._id.toString(),
    type: session.type,
    title: session.title,
    isTitleCustom: session.isTitleCustom,
    memorySnapshot: session.memorySnapshot || [],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

function getSafeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    lastActiveSessionId: user.lastActiveSessionId
      ? user.lastActiveSessionId.toString()
      : null,
  };
}

function createToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || "callbuddy_dev_secret_change_this",
    { expiresIn: "30d" }
  );
}

function authRequired(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Login required." });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "callbuddy_dev_secret_change_this"
    );

    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Your login session expired. Please log in again." });
  }
}

app.post("/api/speech/transcribe", authRequired, async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body || {};

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({ error: "Audio data is required." });
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");

    if (!audioBuffer.length || audioBuffer.length > 6_000_000) {
      return res.status(400).json({ error: "Audio clip is too large or empty." });
    }

    const text = await speechProvider.transcribe(audioBuffer, mimeType);

    res.json({ text });
  } catch (error) {
    console.error("Speech transcription error:", error);
    res.status(500).json({ error: "Could not transcribe this voice note." });
  }
});

async function createGreetingSession(user) {
  const greeting = `Hey ${user.name}, the line is open. What are we building today?`;

  const session = await Session.create({
    owner: user._id,
    type: "text",
    title: "New Transmission",
    isTitleCustom: false,
    messages: [
      {
        role: "assistant",
        content: greeting,
        createdAt: new Date(),
      },
    ],
  });

  user.lastActiveSessionId = session._id;
  await user.save();

  return session;
}

async function getOwnedSession(sessionId, userId, type = null) {
  const query = {
    _id: sessionId,
    owner: userId,
  };

  if (type) {
    query.type = type;
  }

  return Session.findOne(query);
}

app.get("/", (req, res) => {
  res.json({
    message: "CallBuddy AI backend is running!",
    database:
      mongoose.connection.readyState === 1 ? "connected" : "connecting",
  });
});

/* =========================
   AUTH
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const cleanName = name?.trim();
    const cleanEmail = email?.trim().toLowerCase();

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        error: "Please enter a name with at least 2 characters.",
      });
    }

    if (!cleanEmail || !cleanEmail.includes("@")) {
      return res.status(400).json({
        error: "Please enter a valid email address.",
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        error: "Password must contain at least 6 characters.",
      });
    }

    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email already exists. Please log in.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: cleanName.slice(0, 40),
      email: cleanEmail,
      password: hashedPassword,
    });

    const greetingSession = await createGreetingSession(user);
    const token = createToken(user._id.toString());

    res.status(201).json({
      token,
      user: getSafeUser(user),
      session: {
        ...getSessionSummary(greetingSession),
        messages: greetingSession.messages,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Could not create your account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email?.trim().toLowerCase();

    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({
        error: "No account was found with this email.",
      });
    }

    const passwordMatches = await bcrypt.compare(password || "", user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Incorrect password.",
      });
    }

    let session = null;

    if (user.lastActiveSessionId) {
      session = await Session.findOne({
        _id: user.lastActiveSessionId,
        owner: user._id,
        type: "text",
      });
    }

    if (!session) {
      session = await Session.findOne({
        owner: user._id,
        type: "text",
      }).sort({ updatedAt: -1 });
    }

    if (!session) {
      session = await createGreetingSession(user);
    } else if (
      !user.lastActiveSessionId ||
      user.lastActiveSessionId.toString() !== session._id.toString()
    ) {
      user.lastActiveSessionId = session._id;
      await user.save();
    }

    const token = createToken(user._id.toString());

    res.json({
      token,
      user: getSafeUser(user),
      session: {
        ...getSessionSummary(session),
        messages: session.messages,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Could not log you in." });
  }
});

app.get("/api/auth/me", authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    let session = null;

    if (user.lastActiveSessionId) {
      session = await Session.findOne({
        _id: user.lastActiveSessionId,
        owner: user._id,
        type: "text",
      });
    }

    if (!session) {
      session = await Session.findOne({
        owner: user._id,
        type: "text",
      }).sort({ updatedAt: -1 });
    }

    if (!session) {
      session = await createGreetingSession(user);
    } else if (
      !user.lastActiveSessionId ||
      user.lastActiveSessionId.toString() !== session._id.toString()
    ) {
      user.lastActiveSessionId = session._id;
      await user.save();
    }

    res.json({
      user: getSafeUser(user),
      session: {
        ...getSessionSummary(session),
        messages: session.messages,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({ error: "Could not restore your account session." });
  }
});

/* =========================
   TEXT SESSIONS
========================= */

app.post("/api/sessions", authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    const greeting = `Hey ${user.name}, the line is open. What are we building today?`;

    const session = await Session.create({
      owner: user._id,
      type: "text",
      title: "New Transmission",
      isTitleCustom: false,
      messages: [
        {
          role: "assistant",
          content: greeting,
          createdAt: new Date(),
        },
      ],
    });

    user.lastActiveSessionId = session._id;
    await user.save();

    res.status(201).json({
      session: {
        ...getSessionSummary(session),
        messages: session.messages,
      },
    });
  } catch (error) {
    console.error("Create session error:", error);
    res.status(500).json({ error: "Could not create a new chat." });
  }
});

app.get("/api/sessions", authRequired, async (req, res) => {
  try {
    const sessions = await Session.find({
      owner: req.userId,
      type: "text",
    })
      .sort({ updatedAt: -1 })
      .select("type title isTitleCustom memorySnapshot createdAt updatedAt messages");

    res.json({
      sessions: sessions.map(getSessionSummary),
    });
  } catch (error) {
    console.error("Get text sessions error:", error);
    res.status(500).json({ error: "Could not load your chat archive." });
  }
});

app.get("/api/sessions/:sessionId", authRequired, async (req, res) => {
  try {
    const session = await getOwnedSession(req.params.sessionId, req.userId);

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (session.type === "text") {
      await User.findByIdAndUpdate(req.userId, {
        lastActiveSessionId: session._id,
      });
    }

    res.json({
      session: {
        ...getSessionSummary(session),
        messages: session.messages,
      },
    });
  } catch {
    res.status(400).json({ error: "Invalid session ID." });
  }
});

app.patch("/api/sessions/:sessionId", authRequired, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "A session title is required." });
    }

    const session = await Session.findOneAndUpdate(
      {
        _id: req.params.sessionId,
        owner: req.userId,
      },
      {
        title: title.trim().slice(0, 60),
        isTitleCustom: true,
      },
      { new: true, runValidators: true }
    );

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    res.json({ session: getSessionSummary(session) });
  } catch {
    res.status(400).json({ error: "Could not rename session." });
  }
});

app.delete("/api/sessions/:sessionId", authRequired, async (req, res) => {
  try {
    const session = await Session.findOneAndDelete({
      _id: req.params.sessionId,
      owner: req.userId,
      type: "text",
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    const user = await User.findById(req.userId);

    if (
      user?.lastActiveSessionId &&
      user.lastActiveSessionId.toString() === session._id.toString()
    ) {
      const nextSession = await Session.findOne({
        owner: req.userId,
        type: "text",
      }).sort({ updatedAt: -1 });

      user.lastActiveSessionId = nextSession?._id || null;
      await user.save();
    }

    res.json({ message: "Session deleted." });
  } catch {
    res.status(400).json({ error: "Could not delete session." });
  }
});

app.post("/api/sessions/:sessionId/memory", authRequired, async (req, res) => {
  try {
    const session = await getOwnedSession(
      req.params.sessionId,
      req.userId,
      "text"
    );

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (session.messages.length === 0) {
      return res.status(400).json({
        error: "Send a few messages before creating session memory.",
      });
    }

    const conversation = session.messages
      .slice(-30)
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n");

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
Create a compact memory snapshot of this one conversation.

Return ONLY valid JSON:
{"memories":["short point 1","short point 2"]}

Rules:
- Return 2 to 5 useful points.
- Keep each point under 18 words.
- Include only facts or decisions actually stated.
- Do not invent personal details.
          `,
        },
        { role: "user", content: conversation },
      ],
      temperature: 0.2,
      max_tokens: 180,
    });

    const rawReply = completion.choices[0]?.message?.content || "";

    let parsedMemory;

    try {
      parsedMemory = JSON.parse(
        rawReply.replace(/```json/gi, "").replace(/```/g, "").trim()
      );
    } catch {
      parsedMemory = {
        memories: rawReply
          .split("\n")
          .map((line) => line.replace(/^[-•\d.\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 5),
      };
    }

    const memories = Array.isArray(parsedMemory.memories)
      ? parsedMemory.memories
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    if (!memories.length) {
      return res.status(500).json({
        error: "Could not create a usable memory snapshot.",
      });
    }

    session.memorySnapshot = memories;
    await session.save();

    res.json({
      memorySnapshot: session.memorySnapshot,
      session: getSessionSummary(session),
    });
  } catch (error) {
    console.error("Memory snapshot error:", error);
    res.status(500).json({ error: "Could not generate session memory." });
  }
});

/* =========================
   VOICE ROOMS
========================= */

function getVoiceRoomSummary(room) {
  return {
    id: room._id.toString(),

    title: room.title,

    hostUserId: room.hostUserId,

    hostName: room.hostName,

    status: room.status,

    participants: room.participants,

    transcript: room.transcript,

    createdAt: room.createdAt,

    endedAt: room.endedAt,

    participantCount: room.participants.filter(
      (participant) => !participant.leftAt
    ).length,
  };
}

function getPublicVoiceRoom(room) {
  return {
    ...getVoiceRoomSummary(room),
    hostUserId: room.hostUserId.toString(),
    participants: room.participants
  .filter((participant) => !participant.leftAt)
  .map((participant) => ({
    participantId: participant.participantId,
    userId: participant.userId?.toString() || null,
    name: participant.name,
    isHost: participant.isHost,
    joinedAt: participant.joinedAt,
  })),
    recentlyLeft: room.participants
  .filter((participant) => participant.leftAt)
  .slice(-8)
  .map((participant) => ({
    participantId: participant.participantId,
    userId: participant.userId?.toString() || null,
    name: participant.name,
    isHost: participant.isHost,
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
  })),
    transcript: room.transcript.map((line) => ({
      id: line._id?.toString() || `${line.createdAt}_${line.participantId}`,
      participantId: line.participantId,
      speakerName: line.speakerName,
      speakerType: line.speakerType,
      content: line.content,
      createdAt: line.createdAt,
    })),
  };
}

/* Host creates a shareable Voice Room */
app.post("/api/voice-rooms", authRequired, async (req, res) => {
  try {
    const { roomName } = req.body;
    const cleanRoomName = roomName?.trim() || "Voice Room";

    const host = await User.findById(req.userId);

    if (!host) {
      return res.status(404).json({ error: "User account not found." });
    }

    const hostParticipantId = `host_${host._id}_${Date.now()}`;

    const room = await VoiceRoom.create({
      title: cleanRoomName.slice(0, 60),
      hostUserId: host._id,
      hostName: host.name,
      status: "active",
      participants: [
        {
          participantId: hostParticipantId,
          name: host.name,
          userId: host._id,
          isHost: true,
          joinedAt: new Date(),
        },
      ],
      transcript: [
        {
          participantId: null,
          speakerName: "CALLBUDDY AI",
          speakerType: "system",
          content: `${host.name} opened this Voice Room. Turn on AI Mic when you want CallBuddy to listen and respond.`,
          createdAt: new Date(),
        },
      ],
    });

    res.status(201).json({
      room: {
        ...getVoiceRoomSummary(room),
        hostParticipantId,
      },
    });
  } catch (error) {
    console.error("Create voice room error:", error);
    res.status(500).json({ error: "Could not create the Voice Room." });
  }
});

/* Anyone with the link can view the room.
   Login is optional here. */
app.get("/api/voice-rooms/:roomId", async (req, res) => {
  try {
    const room = await VoiceRoom.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "Voice Room not found." });
    }

    res.json({
      room: getPublicVoiceRoom(room),
    });
  } catch {
    res.status(400).json({ error: "Invalid Voice Room link." });
  }
});

/* Guest joins by name.
   If they send a valid token, their account name is used automatically. */
app.post("/api/voice-rooms/:roomId/join", async (req, res) => {
  try {
    const room = await VoiceRoom.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "Voice Room not found." });
    }

    if (room.status === "ended") {
      return res.status(410).json({ error: "This Voice Room has ended." });
    }

    let loggedInUser = null;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (token) {
      try {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || "callbuddy_dev_secret_change_this"
        );

        loggedInUser = await User.findById(decoded.userId);
      } catch {
        loggedInUser = null;
      }
    }

    const typedName = req.body?.name?.trim();
    const participantName = loggedInUser?.name || typedName;

    if (!participantName || participantName.length < 2) {
      return res.status(400).json({
        error: "Please enter a name with at least 2 characters.",
      });
    }
    /*
-------------------------------------------------------
Already joined?
Return existing participant instead of creating another.
-------------------------------------------------------
*/
if (loggedInUser) {
  const existingParticipant = room.participants.find(
    (participant) =>
      String(participant.userId || "") ===
        String(loggedInUser._id) &&
      !participant.leftAt
  );

  if (existingParticipant) {
    return res.json({
      participant: {
        participantId: existingParticipant.participantId,
        name: existingParticipant.name,
        isHost: existingParticipant.isHost,
        isLoggedIn: true,
      },
      room: getPublicVoiceRoom(room),
    });
  }
}
    const participantId = `guest_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    room.participants.push({
      participantId,
      name: participantName.slice(0, 40),
      userId: loggedInUser?._id || null,
      isHost: false,
      joinedAt: new Date(),
    });

    room.transcript.push({
      participantId,
      speakerName: "SYSTEM",
      speakerType: "system",
      content: `${participantName} joined the room.`,
      createdAt: new Date(),
    });

    await room.save();

io.to(`voice-room:${room._id}`).emit("voice-room:updated", {
  room: getPublicVoiceRoom(room),
  event: "participant-joined",
});

res.status(201).json({
      participant: {
        participantId,
        name: participantName,
        isHost: false,
        isLoggedIn: Boolean(loggedInUser),
      },
      room: getPublicVoiceRoom(room),
    });
  } catch (error) {
    console.error("Join voice room error:", error);
    res.status(500).json({ error: "Could not join the Voice Room." });
  }
});

/* Guest leaves: only that guest disconnects */
app.post("/api/voice-rooms/:roomId/leave", async (req, res) => {
  try {
    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({ error: "participantId is required." });
    }

    const room = await VoiceRoom.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: "Voice Room not found." });
    }

    const participant = room.participants.find(
      (item) => item.participantId === participantId
    );

    if (!participant) {
      return res.status(404).json({ error: "Participant not found." });
    }

    if (participant.isHost) {
      return res.status(403).json({
        error: "The host must use End Room for Everyone.",
      });
    }

    if (!participant.leftAt) {
      participant.leftAt = new Date();

      room.transcript.push({
        participantId,
        speakerName: "SYSTEM",
        speakerType: "system",
        content: `${participant.name} left the room.`,
        createdAt: new Date(),
      });

      await room.save();

      io.to(`voice-room:${room._id}`).emit("voice-room:updated", {
  room: getPublicVoiceRoom(room),
  event: "participant-left",
});
    }

    res.json({
      message: "You left the Voice Room.",
      room: getPublicVoiceRoom(room),
    });
  } catch (error) {
    console.error("Leave voice room error:", error);
    res.status(500).json({ error: "Could not leave the Voice Room." });
  }
});

/* Only the creator can end the room for everyone */
app.post("/api/voice-rooms/:roomId/end", authRequired, async (req, res) => {
  try {
    const room = await VoiceRoom.findOne({
      _id: req.params.roomId,
      hostUserId: req.userId,
    });

    if (!room) {
      return res.status(404).json({
        error: "Voice Room not found or you are not the host.",
      });
    }

    if (room.status !== "ended") {
      room.status = "ended";
      room.endedAt = new Date();

      room.participants.forEach((participant) => {
        if (!participant.leftAt) {
          participant.leftAt = new Date();
        }
      });

      room.transcript.push({
        participantId: null,
        speakerName: "SYSTEM",
        speakerType: "system",
        content: "The host ended the Voice Room for everyone.",
        createdAt: new Date(),
      });

      await room.save();

      io.to(`voice-room:${room._id}`).emit("voice-room:ended", {
  room: getPublicVoiceRoom(room),
});
    }

    res.json({
      message: "Voice Room ended for everyone.",
      room: getPublicVoiceRoom(room),
    });
  } catch (error) {
    console.error("End voice room error:", error);
    res.status(500).json({ error: "Could not end the Voice Room." });
  }
});


/* =========================
   VOICE ROOM MESSAGES
========================= */

function shouldCallBuddyReply(message) {
  return shouldCallBuddyReplyFromMemory(message);
}

function getVoiceRoomParticipant(room, participantId) {
  return room.participants.find(
    (participant) =>
      participant.participantId === participantId && !participant.leftAt
  );
}

voiceRoomAudioPipeline = createVoiceRoomAudioPipeline({
  io,
  llmClient: groq,
  speechProvider,
  VoiceRoom,
  getPublicVoiceRoom,
  getVoiceRoomParticipant,
});

app.post("/api/voice-rooms/:roomId/message", async (req, res) => {
  try {
    const { participantId, message } = req.body;
    console.log("========== MESSAGE API ==========");
console.log("Participant:", participantId);
console.log("Message:", message);
console.log("=================================");

    if (!participantId) {
      return res.status(400).json({
        error: "participantId is required.",
      });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    const room = await VoiceRoom.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({
        error: "Voice Room not found.",
      });
    }

    if (room.status === "ended") {
      return res.status(410).json({
        error: "This Voice Room has ended.",
      });
    }

    const participant = getVoiceRoomParticipant(room, participantId);

    if (!participant) {
      return res.status(403).json({
        error: "You are not an active participant in this Voice Room.",
      });
    }

    const cleanMessage = message.trim();

    const userLine = {
      participantId: participant.participantId,
      speakerName: participant.name,
      speakerType: participant.isHost ? "host" : "guest",
      content: cleanMessage,
      createdAt: new Date(),
    };

    room.transcript.push(userLine);

    const aiWasCalled = shouldCallBuddyReply(cleanMessage);

    let assistantLine = null;

    if (aiWasCalled) {
      const recentTranscript = room.transcript
        .slice(-18)
        .map((line) => {
          const speaker =
            line.speakerType === "assistant"
              ? "CALLBUDDY AI"
              : line.speakerName;

          return `${speaker}: ${line.content}`;
        })
        .join("\n");

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `
You are CallBuddy AI inside a shared Voice Room.

Rules:
- Reply because AI Mic is enabled and the latest speech was sent to you.
- Be friendly, short, and natural.
- Usually reply in 1 to 3 sentences.
- You are speaking to a group, so use the person's name when useful.
- Never pretend you can hear raw audio; you receive only speech transcripts.
- You were created by Rishi as a college project.
            `,
          },
          {
            role: "user",
            content: `Live Voice Room transcript:\n${recentTranscript}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      const reply =
        completion.choices[0]?.message?.content ||
        "I heard you, but I could not generate a complete response.";

      assistantLine = {
        participantId: null,
        speakerName: "CALLBUDDY AI",
        speakerType: "assistant",
        content: reply,
        createdAt: new Date(),
      };

      room.transcript.push(assistantLine);
    }

    await room.save();

io.to(`voice-room:${room._id}`).emit("voice-room:updated", {
  room: getPublicVoiceRoom(room),
  event: assistantLine ? "ai-replied" : "message-sent",
});

res.json({
      userMessage: {
        participantId: userLine.participantId,
        speakerName: userLine.speakerName,
        speakerType: userLine.speakerType,
        content: userLine.content,
        createdAt: userLine.createdAt,
      },
      assistantMessage: assistantLine
        ? {
            speakerName: assistantLine.speakerName,
            speakerType: assistantLine.speakerType,
            content: assistantLine.content,
            createdAt: assistantLine.createdAt,
          }
        : null,
      aiWasCalled,
      room: getPublicVoiceRoom(room),
    });
  } catch (error) {
    console.error("Voice Room message error:", error);

    res.status(500).json({
      error: "CallBuddy could not process the Voice Room message.",
    });
  }
});
/* =========================
   CHAT
========================= */

app.post("/api/chat", authRequired, async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const session = await getOwnedSession(sessionId, req.userId);

    if (!session) {
      return res.status(404).json({
        error: "Session not found or you do not have access.",
      });
    }

    const cleanMessage = message.trim();

    if (
      session.type === "text" &&
      session.messages.length <= 1 &&
      !session.isTitleCustom
    ) {
      session.title = createSessionTitle(cleanMessage);
    }

    session.messages.push({
      role: "user",
      content: cleanMessage,
      createdAt: new Date(),
    });

    const recentMessages = session.messages.slice(-12).map((item) => ({
      role: item.role,
      content: item.content,
    }));

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...recentMessages,
      ],
      temperature: 0.7,
      max_tokens: 150,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Sorry, I could not generate a reply.";

    const assistantMessage = {
      role: "assistant",
      content: reply,
      createdAt: new Date(),
    };

    session.messages.push(assistantMessage);
    await session.save();

    if (session.type === "text") {
      await User.findByIdAndUpdate(req.userId, {
        lastActiveSessionId: session._id,
      });
    }

    res.json({
      reply,
      assistantMessage,
      session: getSessionSummary(session),
    });
  } catch (error) {
    console.error("Groq / chat error:", error);
    res.status(500).json({
      error: "Something went wrong while talking to CallBuddy AI.",
    });
  }
});

/* =========================
   CALL PREVIEW
========================= */

app.post("/api/call-preview", authRequired, async (req, res) => {
  try {
    const { recipientName, purpose, duration, script } = req.body;

    if (!recipientName || !recipientName.trim()) {
      return res.status(400).json({
        error: "Recipient name is required.",
      });
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
You are CallBuddy AI, a consent-based college project voice agent.
Create a short natural demo call script.

Return ONLY valid JSON:
{
  "title": "short title",
  "estimatedDuration": "30 seconds",
  "steps": [
    {"label":"01 / OPENING","text":"..."},
    {"label":"02 / PURPOSE","text":"..."},
    {"label":"03 / RESPONSE","text":"..."},
    {"label":"04 / CLOSING","text":"..."}
  ]
}
          `,
        },
        {
          role: "user",
          content: `
Recipient name: ${recipientName}
Call purpose: ${purpose || "Project demonstration"}
Target duration: ${duration || "30 seconds"}
Opening script: ${script || "No custom opening script provided."}
          `,
        },
      ],
      temperature: 0.6,
      max_tokens: 350,
    });

    const rawReply = completion.choices[0]?.message?.content || "";

    let preview;

    try {
      preview = JSON.parse(
        rawReply.replace(/```json/gi, "").replace(/```/g, "").trim()
      );
    } catch {
      return res.status(500).json({
        error: "CallBuddy could not format the call preview.",
      });
    }

    res.json({ preview });
  } catch (error) {
    console.error("Call preview error:", error);
    res.status(500).json({
      error: "Could not generate the call preview.",
    });
  }
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected: callbuddy_ai database");


    /* =========================
   VOICE ARCHIVE
========================= */

/* Logged-in user sees only Voice Rooms they created */
app.get("/api/voice-archive", authRequired, async (req, res) => {
  try {
    const rooms = await VoiceRoom.find({
      hostUserId: req.userId,
    })
      .sort({ updatedAt: -1 })
      .select("title hostName status createdAt updatedAt endedAt transcript participants");

    const archive = rooms.map((room) => ({
      id: room._id.toString(),
      title: room.title,
      hostName: room.hostName,
      status: room.status,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      endedAt: room.endedAt,
      messageCount: room.transcript.length,
      participantCount: room.participants.length,
      preview:
        room.transcript
          .slice(-1)[0]
          ?.content?.slice(0, 100) || "No voice activity yet.",
    }));

    res.json({ archive });
  } catch (error) {
    console.error("Load voice archive error:", error);
    res.status(500).json({
      error: "Could not load the Voice Archive.",
    });
  }
});

/* Host can open one of their archived Voice Rooms */
app.get("/api/voice-archive/:roomId", authRequired, async (req, res) => {
  try {
    const room = await VoiceRoom.findOne({
      _id: req.params.roomId,
      hostUserId: req.userId,
    });

    if (!room) {
      return res.status(404).json({
        error: "Voice archive item not found.",
      });
    }

    res.json({
      room: getPublicVoiceRoom(room),
    });
  } catch {
    res.status(400).json({
      error: "Invalid Voice Archive item.",
    });
  }
});
    server.listen(PORT, () => {
  console.log(`CallBuddy AI server running at http://localhost:${PORT}`);
});
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  });
