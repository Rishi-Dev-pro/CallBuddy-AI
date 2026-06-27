const { toFile } = require("openai");

const MIME_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/mp4": "mp4",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/ogg;codecs=opus": "ogg",
};

function getAudioExtension(mimeType = "") {
  return MIME_EXTENSIONS[mimeType] || "webm";
}

class WhisperProvider {
  constructor({ client, model = process.env.STT_MODEL || "whisper-large-v3-turbo" }) {
    this.client = client;
    this.model = model;
  }

  async transcribe(audioBuffer, mimeType) {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      return "";
    }

    const extension = getAudioExtension(mimeType);
    const file = await toFile(audioBuffer, `voice-room-chunk.${extension}`, {
      type: mimeType || "audio/webm",
    });

    const transcription = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      response_format: "json",
      temperature: 0,
    });

    return (transcription.text || "").trim();
  }
}

function createSpeechProvider({ client }) {
  return new WhisperProvider({ client });
}

module.exports = {
  createSpeechProvider,
  WhisperProvider,
};
