import { useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  Archive,
  ArrowLeft,
  Bot,
  Brain,
  ChevronRight,
  Clock3,
  Cpu,
  FileText,
  Lock,
  LogOut,
  Mail,
  Mic,
  Phone,
  PhoneCall,
  Plus,
  Radio,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Pencil,
  User,
  Waves,
  X,
} from "lucide-react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function formatTime(dateString) {
  if (!dateString) return "NOW";

  return new Date(dateString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSessionDate(dateString) {
  if (!dateString) return "JUST NOW";

  return new Date(dateString)
    .toLocaleDateString([], {
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

function makeUiMessage(role, text, userName, extra = {}) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    time: formatTime(extra.createdAt),
    label: role === "user" ? userName?.toUpperCase() || "YOU" : "CALLBUDDY AI",
    text,
    ...extra,
  };
}

function App({ token, currentUser, initialSession, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isChatRecording, setIsChatRecording] = useState(false);

  const [sessionId, setSessionId] = useState(initialSession?.id || null);
  const [currentSession, setCurrentSession] = useState(initialSession || null);
  const [sessions, setSessions] = useState([]);

  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isVoiceArchiveOpen, setIsVoiceArchiveOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  const [memorySnapshot, setMemorySnapshot] = useState([]);
  const [isGeneratingMemory, setIsGeneratingMemory] = useState(false);

  const [activeView, setActiveView] = useState("chat");

  const [callPreview, setCallPreview] = useState(null);
  const [isGeneratingCallPreview, setIsGeneratingCallPreview] = useState(false);

  const [voiceRoomName, setVoiceRoomName] = useState("");
  const [selectedVoiceRoom, setSelectedVoiceRoom] = useState(null);
  const [isLoadingVoiceTranscript, setIsLoadingVoiceTranscript] = useState(false);
  const [createdVoiceRoom, setCreatedVoiceRoom] = useState(null);
  const [isCreatingVoiceRoom, setIsCreatingVoiceRoom] = useState(false);
  const [voiceRooms, setVoiceRooms] = useState([]);

  const [callForm, setCallForm] = useState({
    recipientName: "",
    phoneNumber: "",
    purpose: "Project demonstration",
    script: `Hello, this is CallBuddy AI, a conversational voice-agent project created by ${
      currentUser?.name || "Rishi"
    }. This is a consent-based project demonstration call.`,
    duration: "30 seconds",
  });

  const chatEndRef = useRef(null);
  const chatRecorderRef = useRef(null);
  const chatRecordChunksRef = useRef([]);

  const authHeaders = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const createGreetingMessage = () =>
    makeUiMessage(
      "assistant",
      `Hey ${currentUser?.name || "there"}. Your new transmission is ready. What are we building today?`,
      currentUser?.name,
      {
        id: `welcome_${Date.now()}`,
        active: true,
      }
    );

  const railItems = [
    { icon: Bot, label: "Chat", key: "chat" },
    { icon: PhoneCall, label: "Call Studio", key: "calls" },
    { icon: Cpu, label: "Memory", key: "memory" },
    { icon: Archive, label: "Archive", key: "archive" },
    { icon: Radio, label: "Voice Archive", key: "voice-archive" },
    { icon: Settings, label: "Settings", key: "settings" },
  ];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, isThinking]);

  useEffect(() => {
    loadSessions();
    loadVoiceRooms();

    if (initialSession?.id) {
      openSession(initialSession.id, false);
    } else {
      createNewSession();
    }
  }, []);

  const loadSessions = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/sessions`, authHeaders);
      setSessions(response.data.sessions || []);
    } catch (error) {
      console.error("Could not load sessions:", error);
    }
  };

  const loadVoiceRooms = async () => {
  try {
    const response = await axios.get(
      `${API_URL}/api/voice-archive`,
      authHeaders
    );

    setVoiceRooms(response.data.archive || []);
  } catch (error) {
    console.error("Could not load Voice Archive:", error);
  }
};

const openVoiceArchiveRoom = async (roomId) => {
  setIsLoadingVoiceTranscript(true);

  try {
    const response = await axios.get(
      `${API_URL}/api/voice-archive/${roomId}`,
      authHeaders
    );

    setSelectedVoiceRoom(response.data.room);
  } catch (error) {
    console.error("Could not open Voice Archive transcript:", error);

    window.alert(
      error.response?.data?.error ||
        "Could not open this Voice Room record."
    );
  } finally {
    setIsLoadingVoiceTranscript(false);
  }
};

  const createNewSession = async () => {
    if (isCreatingSession || isThinking) return;

    setIsCreatingSession(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/sessions`,
        {},
        authHeaders
      );

      const newSession = response.data.session;

      setSessionId(newSession.id);
      setCurrentSession(newSession);
      setMemorySnapshot([]);
      setMessages([createGreetingMessage()]);
      setInput("");

      setIsArchiveOpen(false);
      setIsVoiceArchiveOpen(false);
      setIsMemoryOpen(false);

      await loadSessions();
    } catch (error) {
      console.error("Could not create session:", error);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const openSession = async (selectedSessionId, closeDrawer = true) => {
    if (isThinking) return;

    try {
      const response = await axios.get(
        `${API_URL}/api/sessions/${selectedSessionId}`,
        authHeaders
      );

      const loadedSession = response.data.session;

      const loadedMessages = (loadedSession.messages || []).map(
        (message, index) =>
          makeUiMessage(message.role, message.content, currentUser?.name, {
            id: `${selectedSessionId}_${index}`,
            createdAt: message.createdAt,
            memory: message.role === "assistant",
          })
      );

      setSessionId(loadedSession.id);
      setCurrentSession(loadedSession);
      setMemorySnapshot(loadedSession.memorySnapshot || []);
      setMessages(loadedMessages.length ? loadedMessages : [createGreetingMessage()]);

      if (closeDrawer) {
        setIsArchiveOpen(false);
        setIsMemoryOpen(false);
      }
    } catch (error) {
      console.error("Could not open session:", error);
    }
  };

  const saveSessionTitle = async (event, selectedSessionId) => {
    event.preventDefault();

    const cleanTitle = editingTitle.trim();

    if (!cleanTitle) return;

    try {
      const response = await axios.patch(
        `${API_URL}/api/sessions/${selectedSessionId}`,
        { title: cleanTitle },
        authHeaders
      );

      const updatedSession = response.data.session;

      setSessions((current) =>
        current.map((session) =>
          session.id === selectedSessionId ? updatedSession : session
        )
      );

      if (sessionId === selectedSessionId) {
        setCurrentSession((current) => ({
          ...current,
          ...updatedSession,
        }));
      }

      setEditingSessionId(null);
      setEditingTitle("");
    } catch (error) {
      console.error("Could not rename session:", error);
    }
  };

  const deleteSession = async (selectedSessionId) => {
    const sessionToDelete = sessions.find(
      (session) => session.id === selectedSessionId
    );

    const confirmed = window.confirm(
      `Delete "${sessionToDelete?.title || "this session"}"? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await axios.delete(
        `${API_URL}/api/sessions/${selectedSessionId}`,
        authHeaders
      );

      const remainingSessions = sessions.filter(
        (session) => session.id !== selectedSessionId
      );

      setSessions(remainingSessions);

      if (selectedSessionId === sessionId) {
        await createNewSession();
      }

      setEditingSessionId(null);
    } catch (error) {
      console.error("Could not delete session:", error);
    }
  };

  const handleSend = async (event) => {
    event.preventDefault();

    const cleanMessage = input.trim();

    if (!cleanMessage || isThinking || !sessionId) return;

    const userMessage = makeUiMessage(
      "user",
      cleanMessage,
      currentUser?.name,
      {
        createdAt: new Date().toISOString(),
      }
    );

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsThinking(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/chat`,
        {
          sessionId,
          message: cleanMessage,
        },
        authHeaders
      );

      const aiReply = makeUiMessage(
        "assistant",
        response.data.reply,
        currentUser?.name,
        {
          createdAt: response.data.assistantMessage?.createdAt,
          memory: true,
          active: true,
        }
      );

      setMessages((current) => [...current, aiReply]);
      setCurrentSession(response.data.session);
      setMemorySnapshot(response.data.session?.memorySnapshot || []);

      await loadSessions();
    } catch (error) {
      console.error("CallBuddy backend error:", error);

      if (error.response?.status === 401) {
        window.alert("Your login session expired. Please log in again.");
        onLogout();
        return;
      }

      if (error.response?.status === 404) {
        await createNewSession();

        setMessages([
          makeUiMessage(
            "assistant",
            "That transmission could not be found, so I opened a fresh permanent session for you.",
            currentUser?.name,
            {
              active: true,
            }
          ),
        ]);

        return;
      }

      setMessages((current) => [
        ...current,
        makeUiMessage(
          "assistant",
          "I could not reach my cloud brain. Please make sure the CallBuddy backend is running.",
          currentUser?.name,
          { active: true }
        ),
      ]);
    } finally {
      setIsThinking(false);
    }
  };

  const getChatAudioMimeType = () => {
    if (!window.MediaRecorder) return "";

    return (
      [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/aac",
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
    );
  };

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };

      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const toggleChatMic = async () => {
    if (isThinking || !sessionId) return;

    if (chatRecorderRef.current?.state === "recording") {
      chatRecorderRef.current.stop();
      return;
    }

    if (!window.MediaRecorder) {
      window.alert("Voice input is not supported in this browser yet.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = getChatAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chatRecordChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chatRecordChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsChatRecording(false);
        stream.getTracks().forEach((track) => track.stop());

        const voiceBlob = new Blob(chatRecordChunksRef.current, {
          type: mimeType || recorder.mimeType || "audio/webm",
        });

        chatRecordChunksRef.current = [];

        if (!voiceBlob.size) return;

        try {
          const audioBase64 = await blobToBase64(voiceBlob);
          const response = await axios.post(
            `${API_URL}/api/speech/transcribe`,
            {
              audioBase64,
              mimeType: voiceBlob.type,
            },
            authHeaders
          );

          const transcript = response.data.text?.trim();

          if (transcript) {
            setInput((current) =>
              current.trim() ? `${current.trim()} ${transcript}` : transcript
            );
          }
        } catch (error) {
          console.error("Chat mic transcription error:", error);
          window.alert("Could not transcribe your voice. Please try again.");
        }
      };

      chatRecorderRef.current = recorder;
      recorder.start();
      setIsChatRecording(true);
    } catch (error) {
      console.error("Chat mic error:", error);
      setIsChatRecording(false);
      window.alert("Please allow microphone access to use voice input.");
    }
  };

  const generateMemorySnapshot = async () => {
    if (!sessionId || isGeneratingMemory) return;

    setIsGeneratingMemory(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/sessions/${sessionId}/memory`,
        {},
        authHeaders
      );

      setMemorySnapshot(response.data.memorySnapshot || []);
      setCurrentSession(response.data.session);

      await loadSessions();
    } catch (error) {
      console.error("Could not generate memory:", error);

      window.alert(
        error.response?.data?.error ||
          "Could not generate session memory yet."
      );
    } finally {
      setIsGeneratingMemory(false);
    }
  };

  const updateCallForm = (field, value) => {
    setCallForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const createVoiceRoom = async (event) => {
    event.preventDefault();

    const cleanName = voiceRoomName.trim();

    if (!cleanName) {
      window.alert("Give your Voice Room a name first.");
      return;
    }

    setIsCreatingVoiceRoom(true);
    setCreatedVoiceRoom(null);

    try {
      const response = await axios.post(
        `${API_URL}/api/voice-rooms`,
        {
          roomName: cleanName,
        },
        authHeaders
      );

      const room = response.data.room;

      const publicAppUrl =
  import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;

const roomLink = `${publicAppUrl}/voice-room/${room.id}`;

setCreatedVoiceRoom({
  ...room,
  link: roomLink,
});

setVoiceRoomName("");

await loadVoiceRooms();

/* Host enters the room immediately after creating it */
window.location.assign(roomLink);
    } catch (error) {
      console.error("Voice Room error:", error);

      window.alert(
        error.response?.data?.error ||
          "Could not create the Voice Room. Please try again."
      );
    } finally {
      setIsCreatingVoiceRoom(false);
    }
  };

  const handleCallDemo = async (event) => {
    event.preventDefault();

    if (!callForm.recipientName.trim() || !callForm.phoneNumber.trim()) {
      window.alert("Enter the recipient name and phone number first.");
      return;
    }

    setIsGeneratingCallPreview(true);
    setCallPreview(null);

    try {
      const response = await axios.post(
        `${API_URL}/api/call-preview`,
        {
          recipientName: callForm.recipientName,
          phoneNumber: callForm.phoneNumber,
          purpose: callForm.purpose,
          duration: callForm.duration,
          script: callForm.script,
        },
        authHeaders
      );

      setCallPreview(response.data.preview);
    } catch (error) {
      console.error("Call preview error:", error);

      window.alert(
        error.response?.data?.error ||
          "Could not generate the call preview. Please try again."
      );
    } finally {
      setIsGeneratingCallPreview(false);
    }
  };

  const handleRailClick = (itemKey) => {
    if (itemKey === "chat") {
      setActiveView("chat");
      setIsArchiveOpen(false);
      setIsVoiceArchiveOpen(false);
      setIsMemoryOpen(false);
      setIsSettingsOpen(false);
      return;
    }

    if (itemKey === "calls") {
      setActiveView("calls");
      setIsArchiveOpen(false);
      setIsVoiceArchiveOpen(false);
      setIsMemoryOpen(false);
      setIsSettingsOpen(false);
      return;
    }

    if (itemKey === "archive") {
      setActiveView("chat");
      setIsArchiveOpen((current) => !current);
      setIsVoiceArchiveOpen(false);
      setIsMemoryOpen(false);
      setIsSettingsOpen(false);
      loadSessions();
      return;
    }

    if (itemKey === "voice-archive") {
      setActiveView("chat");
      setIsVoiceArchiveOpen((current) => !current);
      setIsArchiveOpen(false);
      setIsMemoryOpen(false);
      setIsSettingsOpen(false);
      loadVoiceRooms();
      return;
    }

    if (itemKey === "memory") {
      setActiveView("chat");
      setIsMemoryOpen((current) => !current);
      setIsArchiveOpen(false);
      setIsVoiceArchiveOpen(false);
      setIsSettingsOpen(false);
      return;
    }

    if (itemKey === "settings") {
      setIsSettingsOpen((current) => !current);
      setIsArchiveOpen(false);
      setIsVoiceArchiveOpen(false);
      setIsMemoryOpen(false);
    }
  };

  const copyVoiceRoomLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      window.alert("Voice Room link copied.");
    } catch {
      window.prompt("Copy this Voice Room link:", link);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Waves size={15} strokeWidth={2.5} />
          </div>

          <span>CALLBUDDY</span>
          <b>/ AI</b>
        </div>

        <div className="system-strip">
          <span>
            <i /> SYSTEM ONLINE
          </span>
          <span>
            <i /> MEMORY LINKED
          </span>
          <span>
            <i /> GROQ CLOUD
          </span>
        </div>

        <div className="top-actions">
          <button
            className="new-session-button"
            type="button"
            onClick={createNewSession}
            disabled={isCreatingSession || isThinking}
          >
            <Plus size={14} />
            NEW TRANSMISSION
          </button>

          <button
            className="top-settings-button"
            type="button"
            onClick={() => handleRailClick("settings")}
            aria-label="Open settings"
          >
            <Settings size={15} />
          </button>

          <button
            className="avatar"
            type="button"
            onClick={() => handleRailClick("settings")}
            title={currentUser?.name || "Account"}
          >
            {(currentUser?.name || "CB")
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="mode-rail">
          {railItems.map(({ icon: Icon, label, key }) => (
            <button
              className={`rail-button ${
                activeView === key ||
                (key === "archive" && isArchiveOpen) ||
                (key === "voice-archive" && isVoiceArchiveOpen) ||
                (key === "memory" && isMemoryOpen) ||
                (key === "settings" && isSettingsOpen)
                  ? "active"
                  : ""
              }`}
              key={key}
              title={label}
              type="button"
              onClick={() => handleRailClick(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </aside>

        {activeView === "chat" ? (
          <section className="conversation-zone">
            <div className="session-label">
              <strong>{currentSession?.title || "NEW TRANSMISSION"}</strong>

              <span>
                SESSION /{" "}
                {sessionId ? sessionId.slice(-10).toUpperCase() : "CONNECTING"}
              </span>
            </div>

            <div className="signal-spine">
              {messages.map((message) => (
                <article
                  className={`transcript ${message.role} ${
                    message.active ? "is-active" : ""
                  }`}
                  key={message.id}
                >
                  <div className="spine-node" />

                  <div className="transcript-content">
                    <div className="message-meta">
                      <span>{message.label}</span>

                      {message.memory && (
                        <em>
                          <Waves size={12} />
                          MEMORY ACTIVE
                        </em>
                      )}

                      <time>{message.time}</time>
                    </div>

                    <p>{message.text}</p>

                    <div className="message-actions">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(message.text)}
                      >
                        COPY
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsMemoryOpen(true);
                          window.alert(
                            "Open the Memory panel and generate a memory snapshot to save important context."
                          );
                        }}
                      >
                        PIN TO MEMORY
                      </button>
                    </div>
                  </div>
                </article>
              ))}

              {isThinking && (
                <article className="transcript assistant is-processing">
                  <div className="spine-node" />

                  <div className="transcript-content processing-content">
                    <div className="message-meta">
                      <span>CALLBUDDY AI</span>

                      <em>
                        <Waves size={12} />
                        SIGNAL PROCESSING
                      </em>
                    </div>

                    <div className="thinking-line">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </article>
              )}

              <div ref={chatEndRef} />
            </div>

            <form className="transmit-bar" onSubmit={handleSend}>
              <span className="transmit-label">TRANSMIT MESSAGE</span>

              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  sessionId
                    ? `Speak to CallBuddy, ${currentUser?.name || "there"}...`
                    : "Connecting transmission..."
                }
                disabled={!sessionId || isThinking}
              />

              <button
                className={`mic-button ${isChatRecording ? "is-recording" : ""}`}
                type="button"
                aria-label="Use microphone"
                onClick={toggleChatMic}
                disabled={!sessionId || isThinking}
              >
                <Mic size={16} />
              </button>

              <button
                className="send-button"
                type="submit"
                aria-label="Send message"
                disabled={!sessionId || isThinking}
              >
                <Send size={21} fill="currentColor" />
              </button>
            </form>

            <p className="memory-footer">
              CONTEXT MEMORY ENABLED · THIS SESSION HAS ITS OWN MEMORY
            </p>
          </section>
        ) : (
          <section className="call-studio">
            <div className="call-studio-topline">
              <button
                className="back-to-chat"
                type="button"
                onClick={() => setActiveView("chat")}
              >
                <ArrowLeft size={15} />
                BACK TO CONVERSATION
              </button>

              <span>CALL STUDIO / DEMO MODE</span>
            </div>

            <div className="call-studio-grid">
              <div className="call-studio-intro">
                <span className="eyebrow">VOICE AGENT CONTROL</span>

                <h1>
                  Prepare a live
                  <br />
                  CallBuddy transmission.
                </h1>

                <p>
                  Create a browser Voice Room for a free demonstration, or
                  prepare a consent-based future phone-call flow.
                </p>

                <div className="call-status-card">
                  <div className="call-status-orb">
                    <Radio size={23} />
                  </div>

                  <div>
                    <span>VOICE UPLINK</span>
                    <strong>BROWSER MODE READY</strong>
                    <p>Phone-call provider integration pending</p>
                  </div>
                </div>

                <div className="call-studio-notes">
                  <div>
                    <Clock3 size={15} />
                    <span>SHORT DEMO CALLS ARE BEST FOR TESTING</span>
                  </div>

                  <div>
                    <FileText size={15} />
                    <span>ONLY CALL PEOPLE WHO HAVE GIVEN CONSENT</span>
                  </div>
                </div>
              </div>

              <form className="voice-room-create-card" onSubmit={createVoiceRoom}>
                <div className="voice-room-create-heading">
                  <div>
                    <span>FREE MODE</span>
                    <strong>CREATE VOICE ROOM</strong>
                  </div>

                  <Radio size={17} />
                </div>

                <p>
                  Create a browser-based voice room. Share its link on
                  WhatsApp, then open it on another phone after logging in.
                </p>

                <label>
                  <span>ROOM NAME</span>

                  <input
                    value={voiceRoomName}
                    onChange={(event) => setVoiceRoomName(event.target.value)}
                    placeholder="e.g. Rahul CallBuddy Demo"
                    maxLength={60}
                  />
                </label>

                <button
                  className="create-voice-room-button"
                  type="submit"
                  disabled={isCreatingVoiceRoom}
                >
                  <Waves size={17} />
                  {isCreatingVoiceRoom ? "CREATING ROOM..." : "CREATE VOICE ROOM"}
                  <ChevronRight size={16} />
                </button>

                {createdVoiceRoom && (
                  <div className="voice-room-created">
                    <div className="voice-room-created-status">
                      <span />
                      ROOM READY
                    </div>

                    <strong>{createdVoiceRoom.title}</strong>

                    <div className="voice-room-link-box">
                      <code>{createdVoiceRoom.link}</code>

                      <button
                        type="button"
                        onClick={() => copyVoiceRoomLink(createdVoiceRoom.link)}
                      >
                        COPY
                      </button>
                    </div>

                    <p>
                      Keep your backend and frontend tunnels running while
                      testing from another device.
                    </p>
                  </div>
                )}
              </form>

              <form className="call-form is-locked" onSubmit={(event) => event.preventDefault()}>
                <div className="call-form-heading">
                  <span>
                    <Lock size={13} />
                    FUTURE BUILD - AI CALLING
                  </span>
                  <b>LOCKED</b>
                </div>

                <div className="future-call-lock">
                  <Lock size={20} />
                  <strong>AI CALLING IS LOCKED FOR A FUTURE BUILD</strong>
                  <p>
                    Voice Rooms are live now. Direct phone calls will unlock after
                    provider, consent, and safety systems are connected.
                  </p>
                </div>

                <label>
                  <span>
                    <User size={14} />
                    RECIPIENT NAME
                  </span>

                  <input
                    value={callForm.recipientName}
                    onChange={(event) =>
                      updateCallForm("recipientName", event.target.value)
                    }
                    placeholder="e.g. Rahul"
                    disabled
                  />
                </label>

                <label>
                  <span>
                    <Phone size={14} />
                    PHONE NUMBER
                  </span>

                  <input
                    value={callForm.phoneNumber}
                    onChange={(event) =>
                      updateCallForm("phoneNumber", event.target.value)
                    }
                    placeholder="+91 98765 43210"
                    disabled
                  />
                </label>

                <label>
                  <span>
                    <Radio size={14} />
                    CALL PURPOSE
                  </span>

                  <select
                    value={callForm.purpose}
                    onChange={(event) =>
                      updateCallForm("purpose", event.target.value)
                    }
                    disabled
                  >
                    <option>Project demonstration</option>
                    <option>Friendly greeting</option>
                    <option>Reminder demonstration</option>
                    <option>Custom conversation</option>
                  </select>
                </label>

                <label>
                  <span>
                    <Clock3 size={14} />
                    TARGET DURATION
                  </span>

                  <select
                    value={callForm.duration}
                    onChange={(event) =>
                      updateCallForm("duration", event.target.value)
                    }
                    disabled
                  >
                    <option>20 seconds</option>
                    <option>30 seconds</option>
                    <option>1 minute</option>
                    <option>2 minutes</option>
                  </select>
                </label>

                <label className="script-field">
                  <span>
                    <FileText size={14} />
                    OPENING SCRIPT
                  </span>

                  <textarea
                    value={callForm.script}
                    onChange={(event) =>
                      updateCallForm("script", event.target.value)
                    }
                    disabled
                  />
                </label>

                <button
                  className="prepare-call-button"
                  type="submit"
                  disabled
                >
                  <PhoneCall size={17} />
                  FUTURE BUILD - AI CALLING
                  <ChevronRight size={16} />
                </button>

                {callPreview && (
                  <div className="call-preview">
                    <div className="call-preview-heading">
                      <div>
                        <span>AI CALL PREVIEW</span>
                        <strong>
                          {callPreview.title || "CALLBUDDY DEMO FLOW"}
                        </strong>
                      </div>

                      <b>{callPreview.estimatedDuration || callForm.duration}</b>
                    </div>

                    <div className="call-preview-steps">
                      {(callPreview.steps || []).map((step, index) => (
                        <div
                          className="call-preview-step"
                          key={`${step.label}_${index}`}
                        >
                          <span>{step.label}</span>
                          <p>{step.text}</p>
                        </div>
                      ))}
                    </div>

                    <div className="call-preview-note">
                      <Radio size={14} />
                      PREVIEW READY · VOICE UPLINK NOT CONNECTED
                    </div>
                  </div>
                )}

                <p className="call-form-footer">
                  NO CALL WILL BE PLACED UNTIL VOICE INTEGRATION IS CONNECTED
                </p>
              </form>
            </div>
          </section>
        )}

        <aside className="transmission-module">
          <div className="module-heading">
            <span>TRANSMISSION MODULE</span>
            <span>/ 01</span>
          </div>

          <div className={`audio-dial ${isThinking ? "is-speaking" : ""}`}>
            <div className="dial-ring ring-one" />
            <div className="dial-ring ring-two" />

            <div className={`dial-wave ${isThinking ? "is-speaking" : ""}`}>
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="signal-readings">
            <div>
              <span>UPLINK</span>
              <b>STABLE</b>
            </div>

            <div>
              <span>CONTEXT</span>
              <b>{messages.length} MESSAGES</b>
            </div>

            <div>
              <span>LATENCY</span>
              <b>0.18s</b>
            </div>

            <div>
              <span>MODE</span>
              <b>{activeView === "calls" ? "CALL STUDIO" : "CONVERSATION"}</b>
            </div>
          </div>

          <div className="voice-link">
            <div>
              <strong>VOICE LINK</strong>
              <span>● BROWSER READY</span>
            </div>

            <button type="button" onClick={() => handleRailClick("calls")}>
              ENTER CALL STUDIO <ChevronRight size={14} />
            </button>
          </div>
        </aside>
      </div>

      {isMemoryOpen && (
        <div className="memory-overlay" onClick={() => setIsMemoryOpen(false)}>
          <aside
            className="memory-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="memory-header">
              <div>
                <span>MEMORY LAYER</span>
                <strong>SESSION RECALL</strong>
              </div>

              <button
                type="button"
                aria-label="Close memory"
                onClick={() => setIsMemoryOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            <div className="memory-session-name">
              <Brain size={15} />
              <span>{currentSession?.title || "NEW TRANSMISSION"}</span>
            </div>

            <button
              className="generate-memory-button"
              type="button"
              onClick={generateMemorySnapshot}
              disabled={isGeneratingMemory || messages.length <= 1}
            >
              <Sparkles size={15} />
              {isGeneratingMemory
                ? "ANALYZING SESSION..."
                : "GENERATE MEMORY SNAPSHOT"}
            </button>

            <div className="memory-list">
              {memorySnapshot.length > 0 ? (
                memorySnapshot.map((memory, index) => (
                  <div className="memory-item" key={`${memory}_${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{memory}</p>
                  </div>
                ))
              ) : (
                <div className="memory-empty">
                  <Brain size={24} />
                  <p>NO SAVED SESSION MEMORY</p>
                  <span>
                    Send a few messages, then generate a compact recall snapshot.
                  </span>
                </div>
              )}
            </div>

            <p className="memory-drawer-footer">
              MEMORY IS ISOLATED TO THIS TRANSMISSION
            </p>
          </aside>
        </div>
      )}

      {isArchiveOpen && (
        <div className="archive-overlay" onClick={() => setIsArchiveOpen(false)}>
          <aside
            className="archive-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="archive-header">
              <div>
                <span>ARCHIVE</span>
                <strong>RECENT CHAT TRANSMISSIONS</strong>
              </div>

              <button
                type="button"
                aria-label="Close archive"
                onClick={() => setIsArchiveOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            <button
              className="archive-new-button"
              type="button"
              onClick={createNewSession}
            >
              <Plus size={15} />
              NEW TRANSMISSION
            </button>

            <div className="archive-list">
              {sessions.length === 0 ? (
                <p className="archive-empty">NO TRANSMISSIONS YET</p>
              ) : (
                sessions.map((session) => (
                  <div
                    className={`archive-session ${
                      session.id === sessionId ? "selected" : ""
                    }`}
                    key={session.id}
                  >
                    {editingSessionId === session.id ? (
                      <form
                        className="rename-form"
                        onSubmit={(event) => saveSessionTitle(event, session.id)}
                      >
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setEditingSessionId(null);
                            }
                          }}
                        />

                        <button type="submit">SAVE</button>
                      </form>
                    ) : (
                      <>
                        <button
                          className="archive-session-open"
                          type="button"
                          onClick={() => openSession(session.id)}
                        >
                          <strong>{session.title}</strong>
                          <span>
                            {formatSessionDate(session.updatedAt)} ·{" "}
                            {session.messageCount} MESSAGES
                          </span>
                        </button>

                        <div className="archive-session-actions">
                          <button
                            type="button"
                            aria-label="Rename session"
                            onClick={() => {
                              setEditingSessionId(session.id);
                              setEditingTitle(session.title);
                            }}
                          >
                            <Pencil size={13} />
                          </button>

                          <button
                            className="delete-session-button"
                            type="button"
                            aria-label="Delete session"
                            onClick={() => deleteSession(session.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {isVoiceArchiveOpen && (
        <div
          className="archive-overlay"
          onClick={() => setIsVoiceArchiveOpen(false)}
        >
          <aside
            className="archive-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="archive-header">
              <div>
                <span>VOICE ARCHIVE</span>
                <strong>VOICE ROOM RECORDS</strong>
              </div>

              <button
                type="button"
                aria-label="Close Voice Archive"
                onClick={() => setIsVoiceArchiveOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            <button
              className="archive-new-button"
              type="button"
              onClick={() => {
                setIsVoiceArchiveOpen(false);
                setActiveView("calls");
              }}
            >
              <Plus size={15} />
              CREATE VOICE ROOM
            </button>

            <div className="archive-list">
              {voiceRooms.length === 0 ? (
                <p className="archive-empty">NO VOICE ROOMS YET</p>
              ) : (
                voiceRooms.map((room) => {
                

                  return (
                    <div className="archive-session" key={room.id}>
                      <button
                        className="archive-session-open"
                        type="button"
                        onClick={() => openVoiceArchiveRoom(room.id)}
                      >
                        <strong>
  {room.title || "VOICE ROOM"}
  {isLoadingVoiceTranscript ? " · LOADING..." : ""}
</strong>
                        <span>
  {formatSessionDate(room.updatedAt || room.createdAt)} ·{" "}
  {room.participantCount || 0} PARTICIPANTS ·{" "}
  {room.messageCount || 0} LINES
</span>
                      </button>

                      <div className="archive-session-actions">
  <span className="archive-voice-count">
    {room.messageCount || 0}
  </span>
</div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      )}

      {selectedVoiceRoom && (
  <div
    className="voice-transcript-overlay"
    onClick={() => setSelectedVoiceRoom(null)}
  >
    <aside
      className="voice-transcript-drawer"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="voice-transcript-header">
        <div>
          <span>VOICE ROOM TRANSCRIPT</span>
          <strong>{selectedVoiceRoom.title || "VOICE ROOM"}</strong>
        </div>

        <button
          type="button"
          aria-label="Close Voice Room transcript"
          onClick={() => setSelectedVoiceRoom(null)}
        >
          <X size={17} />
        </button>
      </div>

      <div className="voice-transcript-summary">
        <div>
          <span>HOST</span>
          <b>{selectedVoiceRoom.hostName || currentUser?.name || "YOU"}</b>
        </div>

        <div>
          <span>STATUS</span>
          <b>{selectedVoiceRoom.status?.toUpperCase() || "UNKNOWN"}</b>
        </div>

        <div>
          <span>PARTICIPANTS</span>
          <b>{selectedVoiceRoom.participants?.length || 0}</b>
        </div>

        <div>
          <span>LINES</span>
          <b>{selectedVoiceRoom.transcript?.length || 0}</b>
        </div>
      </div>

      <div className="voice-transcript-list">
        {(selectedVoiceRoom.transcript || []).length === 0 ? (
          <div className="voice-transcript-empty">
            <Radio size={24} />
            <p>NO VOICE TRANSCRIPT WAS RECORDED</p>
            <span>Spoken lines will appear here after participants use the room.</span>
          </div>
        ) : (
          selectedVoiceRoom.transcript.map((line, index) => {
            const isAi = line.speakerType === "assistant";
            const isHost = line.participantId === selectedVoiceRoom.hostParticipantId;

            return (
              <article
                className={`voice-transcript-line ${
                  isAi ? "assistant" : isHost ? "host" : "guest"
                }`}
                key={`${line.createdAt || "line"}_${index}`}
              >
                <div className="voice-transcript-line-meta">
                  <span>
                    {isAi
                      ? "CALLBUDDY AI"
                      : line.participantName || (isHost ? "HOST" : "GUEST")}
                  </span>

                  <time>{formatTime(line.createdAt)}</time>
                </div>

                <p>{line.content}</p>
              </article>
            );
          })
        )}
      </div>

      <p className="voice-transcript-footer">
        PRIVATE RECORD · VISIBLE ONLY TO THE ROOM HOST
      </p>
    </aside>
  </div>
)}

      {isSettingsOpen && (
        <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
          <aside
            className="settings-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="memory-header">
              <div>
                <span>ACCOUNT SETTINGS</span>
                <strong>YOUR CALLBUDDY PROFILE</strong>
              </div>

              <button
                type="button"
                aria-label="Close settings"
                onClick={() => setIsSettingsOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            <div className="settings-profile-card">
              <div className="settings-avatar">
                {(currentUser?.name || "CB")
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>

              <div>
                <strong>{currentUser?.name || "CallBuddy User"}</strong>

                <span>
                  <Mail size={13} />
                  {currentUser?.email || "No email found"}
                </span>
              </div>
            </div>

            <div className="settings-info">
              <div>
                <span>CHAT MEMORY</span>
                <b>PRIVATE TO YOUR ACCOUNT</b>
              </div>

              <div>
                <span>VOICE ROOMS</span>
                <b>{voiceRooms.length} CREATED</b>
              </div>

              <div>
                <span>TRANSMISSIONS</span>
                <b>{sessions.length} SAVED</b>
              </div>
            </div>

            <button
              className="logout-button"
              type="button"
              onClick={() => {
                const confirmed = window.confirm(
                  "Log out from CallBuddy on this device?"
                );

                if (confirmed) {
                  onLogout();
                }
              }}
            >
              <LogOut size={16} />
              LOG OUT
            </button>

            <p className="memory-drawer-footer">
              YOUR CHATS AND VOICE ROOMS STAY PRIVATE TO YOUR ACCOUNT
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}

export default App;
