const { createVoiceRoomAiReply } = require("./voiceRoomAi");

const MAX_CHUNK_BYTES = Number(process.env.VOICE_CHUNK_MAX_BYTES || 2_000_000);
const MIN_CHUNK_INTERVAL_MS = Number(
  process.env.VOICE_CHUNK_MIN_INTERVAL_MS || 500
);
const BUFFER_WINDOW_MS = Number(process.env.VOICE_BUFFER_WINDOW_MS || 2000);
const BUFFER_MAX_WINDOW_MS = Number(
  process.env.VOICE_BUFFER_MAX_WINDOW_MS || 15000
);
const BUFFER_MAX_BYTES = Number(process.env.VOICE_BUFFER_MAX_BYTES || 4_000_000);
const STT_HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "bye",
  "you",
]);

function toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  return null;
}

function createVoiceRoomAudioPipeline({
  io,
  llmClient,
  speechProvider,
  VoiceRoom,
  getPublicVoiceRoom,
  getVoiceRoomParticipant,
}) {
  const lastChunkAt = new Map();
  const lastTranscriptByParticipant = new Map();
  const audioBuffers = new Map();
  const socketBufferKeys = new Map();

  function emitSpeechError(socket, message) {
    socket.emit("voice-room:speech-error", { error: message });
  }

  function normalizeTranscript(text = "") {
    return text.replace(/\s+/g, " ").trim();
  }

  function isLikelyHallucinatedTranscript(text, audioBytes) {
    const normalized = text.toLowerCase().replace(/[.!?,]/g, "").trim();

    return audioBytes < 12_000 && STT_HALLUCINATION_PHRASES.has(normalized);
  }

  async function handleAudioChunk(socket, payload = {}) {
    try {
      const { roomId, participantId, mimeType, isFinal } = payload;
      const aiSpeakerMode =
        payload.aiSpeakerMode === "shared" ? "shared" : "private";
      const audioBuffer = toBuffer(payload.chunk);

      if (!roomId || !participantId || !audioBuffer) {
        emitSpeechError(socket, "Invalid audio payload.");
        return;
      }

      if (!socket.rooms.has(`voice-room:${roomId}`)) {
        emitSpeechError(socket, "Socket is not joined to this Voice Room.");
        return;
      }

      if (audioBuffer.length > MAX_CHUNK_BYTES) {
        emitSpeechError(socket, "Audio chunk is too large.");
        return;
      }

      const rateKey = `${socket.id}:${participantId}`;
      const now = Date.now();
      const previousChunkAt = lastChunkAt.get(rateKey) || 0;

      if (!isFinal && now - previousChunkAt < MIN_CHUNK_INTERVAL_MS) {
        return;
      }

      lastChunkAt.set(rateKey, now);

      const bufferKey = `${roomId}:${participantId}`;
      const socketKeys = socketBufferKeys.get(socket.id) || new Set();
      socketKeys.add(bufferKey);
      socketBufferKeys.set(socket.id, socketKeys);

      const existingBuffer = audioBuffers.get(bufferKey) || {
        chunks: [],
        bytes: 0,
        startedAt: now,
      };

      existingBuffer.chunks.push(audioBuffer);
      existingBuffer.bytes += audioBuffer.length;

      if (existingBuffer.bytes > BUFFER_MAX_BYTES) {
        audioBuffers.delete(bufferKey);
        emitSpeechError(socket, "Audio buffer is too large.");
        return;
      }

      audioBuffers.set(bufferKey, existingBuffer);

      const shouldFlush =
        Boolean(isFinal) ||
        now - existingBuffer.startedAt >= BUFFER_MAX_WINDOW_MS;

      if (!shouldFlush) return;

      audioBuffers.delete(bufferKey);

      const mergedAudioBuffer =
        existingBuffer.chunks.length === 1
          ? existingBuffer.chunks[0]
          : Buffer.concat(existingBuffer.chunks, existingBuffer.bytes);

      const room = await VoiceRoom.findById(roomId);

      if (!room || room.status === "ended") {
        emitSpeechError(socket, "Voice Room is not active.");
        return;
      }

      const participant = getVoiceRoomParticipant(room, participantId);

      if (!participant) {
        emitSpeechError(socket, "Participant is not active in this room.");
        return;
      }

      const transcriptText = normalizeTranscript(
        await speechProvider.transcribe(mergedAudioBuffer, mimeType)
      );

      if (!transcriptText) return;

      if (isLikelyHallucinatedTranscript(transcriptText, mergedAudioBuffer.length)) {
        return;
      }

      const duplicateKey = `${roomId}:${participantId}`;
      const previousTranscript = lastTranscriptByParticipant.get(duplicateKey);
      const normalizedText = transcriptText.toLowerCase();

      if (
        previousTranscript?.text === normalizedText &&
        now - previousTranscript.createdAt < 5000
      ) {
        return;
      }

      lastTranscriptByParticipant.set(duplicateKey, {
        text: normalizedText,
        createdAt: now,
      });

      const userLine = {
        participantId: participant.participantId,
        speakerName: participant.name,
        speakerType: participant.isHost ? "host" : "guest",
        content: transcriptText,
        createdAt: new Date(),
      };

      if (aiSpeakerMode === "private") {
        socket.emit("voice-room:transcript", {
          line: {
            ...userLine,
            isPrivate: true,
          },
          visibility: "private",
        });

        socket.emit("voice-room:ai-thinking", {
          participantId: participant.participantId,
          visibility: "private",
        });

        const reply = await createVoiceRoomAiReply({
          client: llmClient,
          room: {
            ...room.toObject(),
            transcript: [...room.transcript, userLine],
          },
          currentLine: userLine,
        });

        socket.emit("voice-room:ai-response", {
          line: {
            participantId: null,
            speakerName: "CALLBUDDY AI",
            speakerType: "assistant",
            content: reply,
            createdAt: new Date(),
            isPrivate: true,
          },
          visibility: "private",
        });

        return;
      }

      room.transcript.push(userLine);
      await room.save();

      const publicRoom = getPublicVoiceRoom(room);

      io.to(`voice-room:${room._id}`).emit("voice-room:transcript", {
        line: userLine,
        room: publicRoom,
      });

      io.to(`voice-room:${room._id}`).emit("voice-room:updated", {
        room: publicRoom,
        event: "message-sent",
      });

      io.to(`voice-room:${room._id}`).emit("voice-room:ai-thinking", {
        participantId: participant.participantId,
      });

      const freshRoom = await VoiceRoom.findById(roomId);
      const reply = await createVoiceRoomAiReply({
        client: llmClient,
        room: freshRoom || room,
        currentLine: userLine,
      });

      const assistantLine = {
        participantId: null,
        speakerName: "CALLBUDDY AI",
        speakerType: "assistant",
        content: reply,
        createdAt: new Date(),
      };

      const aiRoom = freshRoom || room;
      aiRoom.transcript.push(assistantLine);
      await aiRoom.save();

      const publicAiRoom = getPublicVoiceRoom(aiRoom);

      io.to(`voice-room:${aiRoom._id}`).emit("voice-room:ai-response", {
        line: assistantLine,
        room: publicAiRoom,
      });

      io.to(`voice-room:${aiRoom._id}`).emit("voice-room:updated", {
        room: publicAiRoom,
        event: "ai-replied",
      });
    } catch (error) {
      console.error("Voice Room audio pipeline error:", error);
      emitSpeechError(socket, "Could not process voice audio.");
    }
  }

  function cleanupSocket(socketId) {
    for (const key of lastChunkAt.keys()) {
      if (key.startsWith(`${socketId}:`)) {
        lastChunkAt.delete(key);
      }
    }

    for (const bufferKey of socketBufferKeys.get(socketId) || []) {
      audioBuffers.delete(bufferKey);
    }

    socketBufferKeys.delete(socketId);
  }

  return {
    handleAudioChunk,
    cleanupSocket,
  };
}

module.exports = {
  createVoiceRoomAudioPipeline,
};
