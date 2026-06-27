import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import {
  CircleAlert,
  Copy,
  Mic,
  MicOff,
  PhoneOff,
  ShieldCheck,
  Users,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import "./VoiceRoom.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

function getRoomIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const voiceRoomIndex = parts.indexOf("voice-room");

  return voiceRoomIndex >= 0 ? parts[voiceRoomIndex + 1] : null;
}

function formatTime(dateString) {
  if (!dateString) return "NOW";

  return new Date(dateString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStoredParticipant(roomId) {
  try {
    const saved = sessionStorage.getItem(`callbuddy_voice_${roomId}`);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveParticipant(roomId, participant) {
  const minimalData = {
    participantId: participant.participantId,
    participantName: participant.participantName,
    isHost: participant.isHost,
    isLoggedIn: participant.isLoggedIn || Boolean(participant.userId),
  };

  sessionStorage.setItem(
    `callbuddy_voice_${roomId}`,
    JSON.stringify(minimalData)
  );
}

function getSupportedAudioMimeType() {
  if (!window.MediaRecorder) return "";

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
  ];

  return (
    candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ""
  );
}

function VoiceRoom({ token, currentUser, isAuthLoading = false, onLogout }) {
  const roomId = useMemo(getRoomIdFromPath, []);

  const [room, setRoom] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [status, setStatus] = useState("CONNECTING");
  const [error, setError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [endScreen, setEndScreen] = useState(null);
  
  const [isInitializing, setIsInitializing] = useState(true);

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [liveSpeech, setLiveSpeech] = useState("");

  const transcriptEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingMimeTypeRef = useRef("");
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceMonitorRef = useRef(null);
  const pendingFinalChunkRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const lastVoiceActivityRef = useRef(0);
  const lastFinalChunkAtRef = useRef(0);
  const socketRef = useRef(null);
  const lastSpokenAiMessageRef = useRef("");
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const remoteAudioContainerRef = useRef(null);

  const participantRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const isThinkingRef = useRef(false);

  const lastProcessedSpeechRef = useRef("");
  const lastProcessedAtRef = useRef(0);

  const authHeaders = useMemo(() => {
    return token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : {};
  }, [token]);

  useEffect(() => {
    participantRef.current = participant;
  }, [participant]);

  const closePeerConnection = (peerId) => {
    const peerConnection = peerConnectionsRef.current.get(peerId);

    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.close();
      peerConnectionsRef.current.delete(peerId);
    }

    const audioElement = document.getElementById(`callbuddy-peer-${peerId}`);

    if (audioElement) {
      audioElement.srcObject = null;
      audioElement.remove();
    }
  };

  const createPeerConnection = (peerId) => {
    const existingConnection = peerConnectionsRef.current.get(peerId);

    if (existingConnection) {
      return existingConnection;
    }
    console.log(
  "Local tracks:",
  localStreamRef.current?.getAudioTracks().length
);

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    localStreamRef.current?.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStreamRef.current);
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.connected) {
        socketRef.current.emit("webrtc:ice-candidate", {
          targetPeerId: peerId,
          candidate: event.candidate,
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];

      if (!remoteStream || !remoteAudioContainerRef.current) return;

      let audioElement = document.getElementById(`callbuddy-peer-${peerId}`);

      if (!audioElement) {
        audioElement = document.createElement("audio");
        audioElement.id = `callbuddy-peer-${peerId}`;
        audioElement.autoplay = true;
        audioElement.playsInline = true;
        remoteAudioContainerRef.current.appendChild(audioElement);
      }

      audioElement.srcObject = remoteStream;

      audioElement.play().catch(() => {});
    };

    peerConnection.onconnectionstatechange = () => {
      if (
        ["failed", "closed", "disconnected"].includes(
          peerConnection.connectionState
        )
      ) {
        closePeerConnection(peerId);
      }
    };

    peerConnectionsRef.current.set(peerId, peerConnection);

    return peerConnection;
  };

  const startLiveAudio = async () => {
    if (localStreamRef.current) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      localStreamRef.current = stream;
      return true;
    } catch (microphoneError) {
      console.error("Live room microphone error:", microphoneError);
      window.alert(
        "Microphone access is needed for people in the room to hear you. Please allow it and join again."
      );
      return false;
    }
  };

  const stopLiveAudio = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    [...peerConnectionsRef.current.keys()].forEach(closePeerConnection);
  };

  useEffect(() => {
    if (!roomId || !participant?.participantId) return;

    const socket = io(API_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", async () => {
      const audioReady = await startLiveAudio();

      if (!audioReady) {
        setStatus("MICROPHONE BLOCKED");
        socket.disconnect();
        return;
      }

      socket.emit("voice-room:join", {
        roomId,
        participant,
      });
    });

    socket.on("webrtc:existing-peers", async ({ peerIds }) => {
      for (const peerId of peerIds || []) {
        try {
          const peerConnection = createPeerConnection(peerId);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);

          socket.emit("webrtc:offer", {
            targetPeerId: peerId,
            offer,
          });
        } catch (webrtcError) {
          console.error("Could not create WebRTC offer:", webrtcError);
        }
      }
    });

    socket.on("webrtc:offer", async ({ fromPeerId, offer }) => {
      try {
        const peerConnection = createPeerConnection(fromPeerId);
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          targetPeerId: fromPeerId,
          answer,
        });
      } catch (webrtcError) {
        console.error("Could not answer WebRTC offer:", webrtcError);
      }
    });

    socket.on("webrtc:answer", async ({ fromPeerId, answer }) => {
      try {
        const peerConnection = peerConnectionsRef.current.get(fromPeerId);
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
      } catch (webrtcError) {
        console.error("Could not accept WebRTC answer:", webrtcError);
      }
    });

    socket.on("webrtc:ice-candidate", async ({ fromPeerId, candidate }) => {
      try {
        const peerConnection = peerConnectionsRef.current.get(fromPeerId);
        if (!peerConnection || !candidate) return;
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (webrtcError) {
        console.error("Could not add ICE candidate:", webrtcError);
      }
    });

    socket.on("webrtc:peer-left", ({ peerId }) => {
      if (peerId) {
        closePeerConnection(peerId);
      }
    });

    socket.on("voice-room:updated", ({ room: updatedRoom, event }) => {
      setRoom(updatedRoom);

      const latestLine =
        updatedRoom?.transcript?.[updatedRoom.transcript.length - 1];

      if (
        event === "ai-replied" &&
        latestLine?.speakerType === "assistant" &&
        latestLine?.content
      ) {
        const aiMessageKey = `${latestLine.createdAt}_${latestLine.content}`;

        if (lastSpokenAiMessageRef.current !== aiMessageKey) {
          lastSpokenAiMessageRef.current = aiMessageKey;
          speakReply(latestLine.content);
        }
      }
    });

    socket.on("voice-room:transcript", ({ room: updatedRoom }) => {
      if (updatedRoom) {
        setRoom(updatedRoom);
      }

      setLiveSpeech("");
      setIsThinking(false);
      isThinkingRef.current = false;
      setStatus(participantRef.current?.isHost ? "HOST CONNECTED" : "CONNECTED");
    });

    socket.on("voice-room:ai-thinking", () => {
      setIsThinking(true);
      isThinkingRef.current = true;
      setStatus("CALLBUDDY THINKING");
    });

    socket.on("voice-room:ai-response", ({ line, room: updatedRoom }) => {
      if (updatedRoom) {
        setRoom(updatedRoom);
      }

      setIsThinking(false);
      isThinkingRef.current = false;

      if (line?.content) {
        const aiMessageKey = `${line.createdAt}_${line.content}`;

        if (lastSpokenAiMessageRef.current !== aiMessageKey) {
          lastSpokenAiMessageRef.current = aiMessageKey;
          speakReply(line.content);
        }
      }
    });

    socket.on("voice-room:speech-error", ({ error: speechError }) => {
      console.error("Voice transcription error:", speechError);
      setIsThinking(false);
      isThinkingRef.current = false;
      setStatus("VOICE ERROR");
    });

    socket.on("voice-room:ended", ({ room: endedRoom }) => {
      setRoom(endedRoom);

      mediaRecorderRef.current?.stop();
      stopSilenceMonitor();
      stopLiveAudio();

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      setIsListening(false);
      setIsThinking(false);
      setIsSpeaking(false);
      setStatus("ROOM ENDED");

      if (!participantRef.current?.isHost) {
        sessionStorage.removeItem(`callbuddy_voice_${roomId}`);
        setEndScreen("guest");
      }
    });

    return () => {
      socket.emit("voice-room:leave", {
        roomId,
        participant,
      });

      stopLiveAudio();
      socket.disconnect();

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      mediaRecorderRef.current?.stop();
      stopSilenceMonitor();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [roomId, participant?.participantId]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [room?.transcript, liveSpeech, isListening, isSpeaking, isThinking]);

  const loadRoom = useCallback(async () => {
    if (!roomId) {
      setError("This Voice Room link is incomplete.");
      setStatus("LINK ERROR");
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/api/voice-rooms/${roomId}`);
      const loadedRoom = response.data.room;

      setRoom(loadedRoom);

      if (loadedRoom.status === "ended") {
        setStatus("ROOM ENDED");
        // FIX: Hard stop initialization if the room is already dead
        setIsInitializing(false);
      }
    } catch (requestError) {
      console.error("Could not load Voice Room:", requestError);
      setError(
        requestError.response?.data?.error ||
          "This Voice Room could not be found."
      );
      setStatus("OFFLINE");
    }
  }, [roomId]);

  /* UNIVERSAL INITIALIZATION ENGINE */
  useEffect(() => {
    if (!room || !roomId) return;
    
    if (room.status === "ended") {
      setIsInitializing(false);
      return;
    }

    if (isAuthLoading) return;
    if (!isInitializing) return;

    const storedParticipant = getStoredParticipant(roomId);

    // 1. Restore from session storage if it exists
    if (storedParticipant?.participantId) {
      setParticipant(storedParticipant);
      setStatus(storedParticipant.isHost ? "HOST CONNECTED" : "CONNECTED");
      setIsInitializing(false);
      return;
    }

    // 2. Handle logged-in users (Host OR Friend)
    if (currentUser) {
      const isRoomHost = String(room.hostUserId) === String(currentUser.id);

      if (isRoomHost) {
        // HOST SETUP
        const hostParticipant = room.participants?.find((item) => item.isHost);

        if (hostParticipant) {
          const restoredHost = {
            ...hostParticipant,
            participantName: currentUser.name,
            isLoggedIn: true,
            isHost: true,
          };

          setParticipant(restoredHost);
          saveParticipant(roomId, restoredHost);
          setStatus("HOST CONNECTED");
        }
        setIsInitializing(false);
      } else {
        // FRIEND SETUP
        const existingFriend = room.participants?.find(
          (item) => String(item.userId) === String(currentUser.id) && !item.isHost
        );

        if (existingFriend) {
          // FIX: Explicitly shape the restored friend object to match a new joiner
          const restoredFriend = {
            ...existingFriend,
            participantName: existingFriend.name,
            isLoggedIn: true,
          };
          
          setParticipant(restoredFriend);
          saveParticipant(roomId, restoredFriend);
          setStatus("CONNECTED");
          setIsInitializing(false);
        } else {
          // New friend joining for the first time
          const autoJoinFriend = async () => {
            try {
              setStatus("AUTO JOINING...");
              const response = await axios.post(
                `${API_URL}/api/voice-rooms/${roomId}/join`,
                { name: currentUser.name },
                authHeaders
              );

              const joinedParticipant = response.data.participant;
              setParticipant(joinedParticipant);
              setRoom((prev) => response.data.room || prev);
              saveParticipant(roomId, joinedParticipant);

              setStatus("CONNECTED");
            } catch (requestError) {
              console.error("Auto-join failed:", requestError);
              setStatus("ROOM READY");
            } finally {
              setIsInitializing(false);
            }
          };

          autoJoinFriend();
        }
      }
    } else {
      // 3. Unauthenticated guest -> Drop lock, show the join form
      setStatus("ROOM READY");
      setIsInitializing(false);
    }
  }, [room, currentUser, roomId, isInitializing, authHeaders, isAuthLoading]);

  useEffect(() => {
    loadRoom();

    const refreshTimer = window.setInterval(() => {
      loadRoom();
    }, 30000); 

    return () => {
      window.clearInterval(refreshTimer);
      mediaRecorderRef.current?.stop();
      stopSilenceMonitor();

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [loadRoom]);

  const speakReply = (text) => {
    if (!("speechSynthesis" in window)) {
      setIsThinking(false);
      isThinkingRef.current = false;
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setIsThinking(false);
      isThinkingRef.current = false;
      setIsSpeaking(true);
      setStatus("CALLBUDDY SPEAKING");
    };

    const finishSpeaking = () => {
      setIsSpeaking(false);
      if (participantRef.current) {
        setStatus(
          participantRef.current.isHost ? "HOST CONNECTED" : "CONNECTED"
        );
      }
    };

    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;

    window.speechSynthesis.speak(utterance);
  };

  const joinRoom = async (event = null) => {
    event?.preventDefault();

    if (isJoining || !roomId || room?.status === "ended") return;

    const typedName = currentUser ? currentUser.name : guestName.trim();

    if (!typedName) {
      window.alert("Please enter your name first.");
      return;
    }

    setIsJoining(true);

    try {
      const response = await axios.post(
        `${API_URL}/api/voice-rooms/${roomId}/join`,
        { name: typedName },
        authHeaders
      );

      const joinedParticipant = response.data.participant;

      setParticipant(joinedParticipant);
      setRoom(response.data.room);
      saveParticipant(roomId, joinedParticipant);

      setStatus("CONNECTED");
    } catch (requestError) {
      console.error("Could not join Voice Room:", requestError);
      window.alert(
        requestError.response?.data?.error ||
          requestError.message ||
          "Could not join this Voice Room."
      );
    } finally {
      setIsJoining(false);
    }
  };

  
  const emitAudioChunk = async (blob, isFinal = false) => {
    if (
      !blob?.size ||
      !roomId ||
      !participantRef.current?.participantId ||
      !socketRef.current?.connected ||
      isSpeakingRef.current
    ) {
      return;
    }

    try {
      const chunk = await blob.arrayBuffer();

      socketRef.current.emit("voice-room:audio-chunk", {
        roomId,
        participantId: participantRef.current.participantId,
        mimeType: recordingMimeTypeRef.current || blob.type || "audio/webm",
        isFinal,
        chunk,
      });
    } catch (chunkError) {
      console.error("Could not upload audio chunk:", chunkError);
      setStatus("VOICE ERROR");
    }
  };

  const stopSilenceMonitor = () => {
    if (silenceMonitorRef.current) {
      window.clearInterval(silenceMonitorRef.current);
      silenceMonitorRef.current = null;
    }

    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    speechDetectedRef.current = false;
    lastVoiceActivityRef.current = 0;
  };

  const startSilenceMonitor = (stream, recorder) => {
    stopSilenceMonitor();

    const AudioContext = window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const samples = new Uint8Array(analyser.fftSize);

    analyser.fftSize = 1024;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    silenceMonitorRef.current = window.setInterval(() => {
      if (recorder.state !== "recording") return;

      analyser.getByteTimeDomainData(samples);

      let sum = 0;

      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }

      const volume = Math.sqrt(sum / samples.length);
      const now = Date.now();

      if (volume > 0.028) {
        speechDetectedRef.current = true;
        lastVoiceActivityRef.current = now;
        return;
      }

      const pausedLongEnough =
        speechDetectedRef.current &&
        lastVoiceActivityRef.current &&
        now - lastVoiceActivityRef.current > 1400 &&
        now - lastFinalChunkAtRef.current > 1600;

      if (pausedLongEnough) {
        pendingFinalChunkRef.current = true;
        lastFinalChunkAtRef.current = now;
        speechDetectedRef.current = false;
        recorder.requestData();
      }
    }, 180);
  };

  const startRecording = async () => {
    if (
      !participantRef.current ||
      !socketRef.current?.connected ||
      mediaRecorderRef.current?.state === "recording"
    ) {
      return;
    }

    if (!window.MediaRecorder) {
      window.alert(
        "Audio recording is not supported in this browser. Please update your browser and try again."
      );
      return;
    }

    const audioReady = await startLiveAudio();

    if (!audioReady || !localStreamRef.current) {
      setStatus("MICROPHONE BLOCKED");
      return;
    }

    try {
      const mimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(
        localStreamRef.current,
        mimeType ? { mimeType } : undefined
      );

      recordingMimeTypeRef.current = mimeType || recorder.mimeType || "audio/webm";

      recorder.onstart = () => {
        setIsListening(true);
        setLiveSpeech("");
        setStatus("LISTENING");
      };

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0 && participantRef.current) {
          const isFinal =
            pendingFinalChunkRef.current || recorder.state === "inactive";

          pendingFinalChunkRef.current = false;
          emitAudioChunk(event.data, isFinal);
        }
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event.error || event);
        setStatus("VOICE ERROR");
        setIsListening(false);
        setLiveSpeech("");
      };

      recorder.onstop = () => {
        stopSilenceMonitor();
        setIsListening(false);
        setLiveSpeech("");

        if (
          participantRef.current &&
          !isSpeakingRef.current &&
          !isThinkingRef.current
        ) {
          setStatus(
            participantRef.current.isHost ? "HOST CONNECTED" : "CONNECTED"
          );
        }
      };

      mediaRecorderRef.current = recorder;
      startSilenceMonitor(localStreamRef.current, recorder);
      recorder.start(1000);
    } catch (recordingError) {
      console.error("Could not start server-side recording:", recordingError);
      setIsListening(false);
      setLiveSpeech("");
      setStatus("VOICE ERROR");
      window.alert(
        "Could not start voice transcription. Please check microphone permission and try again."
      );
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      pendingFinalChunkRef.current = true;
      recorder.requestData();
      recorder.stop();
    }

    mediaRecorderRef.current = null;
    stopSilenceMonitor();
    setIsListening(false);
    setLiveSpeech("");

    if (
      participantRef.current &&
      !isSpeakingRef.current &&
      !isThinkingRef.current
    ) {
      setStatus(
        participantRef.current.isHost ? "HOST CONNECTED" : "CONNECTED"
      );
    }
  };

 const toggleMicrophone = () => {
  if (
    !participant ||
    room?.status === "ended" ||
    (isListening ? false : isSpeaking || isThinking)
  ) {
    return;
  }

  if (isListening) {
    stopRecording();
  } else {
    startRecording();
  }
};

  const leaveRoom = async () => {
    stopRecording();
    stopLiveAudio();

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    if (!participant || !roomId) {
      window.location.assign("/");
      return;
    }

    try {
      if (participant.isHost) {
        const confirmed = window.confirm(
          "End this Voice Room for everyone? All guests will be disconnected."
        );

        if (!confirmed) return;

        await axios.post(
          `${API_URL}/api/voice-rooms/${roomId}/end`,
          {},
          authHeaders
        );

        sessionStorage.removeItem(`callbuddy_voice_${roomId}`);

        setRoom((currentRoom) =>
          currentRoom
            ? {
                ...currentRoom,
                status: "ended",
              }
            : currentRoom
        );

        setEndScreen("host");
        setStatus("ROOM ENDED");
        return;
      }

      await axios.post(`${API_URL}/api/voice-rooms/${roomId}/leave`, {
        participantId: participant.participantId,
      });

      sessionStorage.removeItem(`callbuddy_voice_${roomId}`);
      setParticipant(null);
      setStatus("LEFT ROOM");
      await loadRoom();
    } catch (requestError) {
      console.error("Leave Voice Room error:", requestError);
      window.alert(
        requestError.response?.data?.error ||
          "Could not leave the Voice Room properly."
      );
    }
  };

  const copyRoomLink = async () => {
    const link = `${window.location.origin}/voice-room/${roomId}`;

    try {
      await navigator.clipboard.writeText(link);
      window.alert("Voice Room link copied.");
    } catch {
      window.prompt("Copy this Voice Room link:", link);
    }
  };

  const returnToCallBuddy = () => {
    window.location.assign("/");
  };

  const viewVoiceArchive = () => {
    window.location.assign("/?section=voice-archive");
  };

  if (error) {
    return (
      <main className="voice-room-shell">
        <section className="voice-room-error-card">
          <CircleAlert size={28} />
          <span>VOICE ROOM ERROR</span>
          <h1>{error}</h1>

          <button type="button" onClick={() => window.location.assign("/")}>
            RETURN TO CALLBUDDY
          </button>
        </section>
      </main>
    );
  }

  const transcript = room?.transcript || [];

  if (endScreen) {
    const isHostEndScreen = endScreen === "host";

    return (
      <main className="voice-room-shell voice-room-ended-shell">
        <section className="voice-room-ended-card">
          <div className="voice-room-ended-icon">
            <PhoneOff size={30} />
          </div>

          <span className="voice-room-ended-kicker">
            {isHostEndScreen ? "VOICE ROOM CLOSED" : "CALL ENDED"}
          </span>

          <h1>
            {isHostEndScreen
              ? "You ended this Voice Room."
              : "The host ended this Voice Room."}
          </h1>

          <p>
            {isHostEndScreen
              ? "The transcript is safely stored in your private Voice Archive."
              : currentUser
              ? "You can return to your CallBuddy home page."
              : "Thanks for joining the conversation."}
          </p>

          <div className="voice-room-ended-actions">
            {isHostEndScreen && (
              <button
                type="button"
                className="voice-ended-primary"
                onClick={viewVoiceArchive}
              >
                <Volume2 size={17} />
                VIEW VOICE ARCHIVE
              </button>
            )}

            <button
              type="button"
              className={
                isHostEndScreen
                  ? "voice-ended-secondary"
                  : "voice-ended-primary"
              }
              onClick={returnToCallBuddy}
            >
              <Waves size={17} />
              {currentUser ? "RETURN TO CALLBUDDY" : "GO TO LOGIN"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="voice-room-shell">
      <div
        ref={remoteAudioContainerRef}
        className="voice-remote-audio"
        aria-hidden="true"
      />
      <header className="voice-room-topbar">
        <div className="voice-room-brand">
          <div className="voice-room-brand-mark">
            <Waves size={16} />
          </div>

          <span>CALLBUDDY</span>
          <b>/ VOICE ROOM</b>
        </div>

        <div
          className={`voice-room-status ${isListening ? "listening" : ""} ${
            isSpeaking ? "speaking" : ""
          } ${isThinking ? "thinking" : ""}`}
        >
          <i />
          {status}
        </div>
      </header>

      <section className="voice-room-main">
        <div className="voice-room-session">
          <span>LIVE TRANSMISSION</span>
          <strong>{room?.title || "LOADING VOICE ROOM..."}</strong>
          <p>
            HOSTED BY {room?.hostName || "CALLBUDDY"} · CONSENT-BASED VOICE
            EXPERIENCE
          </p>
        </div>

        <div
          className={`voice-orb ${isListening ? "is-listening" : ""} ${
            isSpeaking ? "is-speaking" : ""
          } ${isThinking ? "is-thinking" : ""} ${
            participant && !isListening && !isSpeaking && !isThinking
              ? "is-connected"
              : ""
          }`}
        >
          <div className="voice-orb-ring ring-a" />
          <div className="voice-orb-ring ring-b" />
          <div className="voice-orb-ring ring-c" />

          <div className="voice-orb-core">
            <Waves size={34} />
          </div>

          <div className="voice-bars">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="voice-room-prompt">
          {isInitializing
            ? "Securing connection..."
            : !participant
            ? "Join the room to begin."
            : isSpeaking
            ? "CallBuddy is speaking…"
            : isThinking
            ? "Processing your voice…"
            : isListening
            ? "I’m listening…"
            : "Talk normally with friends. Say “CallBuddy” when you want AI help."}
        </div>

        {isInitializing ? null : !participant ? (
          <form className="voice-join-form" onSubmit={joinRoom}>
            {!currentUser ? (
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="What should we call you?"
                maxLength={40}
              />
            ) : (
              <div className="voice-logged-in-name">
                <Users size={15} />
                JOINING AS <strong>{currentUser.name}</strong>
              </div>
            )}

            <button
              className="join-room-button"
              type="submit"
              disabled={isJoining || room?.status === "ended"}
            >
              <Mic size={18} />
              {isJoining ? "JOINING..." : "JOIN VOICE ROOM"}
            </button>
          </form>
        ) : (
          <div className="voice-room-controls">
            <button
              className={`voice-control mic-control ${
                isListening ? "active" : ""
              }`}
              type="button"
              onClick={toggleMicrophone}
              disabled={
                room?.status === "ended" ||
                (isListening ? false : isSpeaking || isThinking)
              }
            >
              {isListening ? <Mic size={19} /> : <MicOff size={19} />}

              <span>
                {isSpeaking
                  ? "CALLBUDDY SPEAKING"
                  : isThinking
                  ? "PROCESSING"
                  : isListening
                  ? "LISTENING"
                  : "MICROPHONE"}
              </span>
            </button>

            <button
              className="voice-control end-control"
              type="button"
              onClick={leaveRoom}
            >
              <PhoneOff size={19} />
              <span>
                {participant.isHost ? "END FOR EVERYONE" : "LEAVE ROOM"}
              </span>
            </button>

            {participant.isHost && (
              <button
                className="voice-control share-control"
                type="button"
                onClick={copyRoomLink}
              >
                <Copy size={17} />
                <span>SHARE LINK</span>
              </button>
            )}
          </div>
        )}

        <div className="voice-room-safety">
          <ShieldCheck size={14} />
          <span>
            {participant?.isHost
              ? "YOU ARE THE HOST · YOU CAN END THIS ROOM FOR EVERYONE"
              : "YOUR MICROPHONE IS ONLY USED AFTER YOU JOIN"}
          </span>
        </div>
      </section>

      <section className="voice-transcript-panel">
        <div className="voice-transcript-heading">
          <div>
            <span>LIVE TRANSCRIPT</span>
            <strong>CONVERSATION LOG</strong>
          </div>

          <Volume2 size={17} />
        </div>

        <div className="voice-transcript-list">
          {transcript.length === 0 && !liveSpeech ? (
            <div className="voice-transcript-empty">
              <Waves size={23} />
              <p>NO VOICE ACTIVITY YET</p>
              <span>
                Join the room, then speak normally or call “CallBuddy” for AI
                help.
              </span>
            </div>
          ) : (
            <>
              {transcript.map((line, index) => (
                <article
                  className={`voice-transcript-line ${
                    line.speakerType === "assistant" ? "assistant" : "user"
                  }`}
                  key={`${line.createdAt}_${index}`}
                >
                  <div>
                    <span>{line.speakerName}</span>
                    <time>{formatTime(line.createdAt)}</time>
                  </div>

                  <p>{line.content}</p>
                </article>
              ))}

              {liveSpeech && (
                <article className="voice-transcript-line user is-live">
                  <div>
                    <span>{participant?.participantName || "GUEST"} / LIVE</span>
                    <time>NOW</time>
                  </div>

                  <p>{liveSpeech}</p>
                </article>
              )}
            </>
          )}

          <div ref={transcriptEndRef} />
        </div>
      </section>
    </main>
  );
}

export default VoiceRoom;
