function buildVoiceRoomMemory(transcript = [], limit = 28) {
  return transcript
    .filter((line) => line?.content && line.speakerType !== "system")
    .slice(-limit)
    .map((line) => {
      const timestamp = line.createdAt
        ? new Date(line.createdAt).toISOString()
        : new Date().toISOString();
      const speaker =
        line.speakerType === "assistant" ? "CALLBUDDY AI" : line.speakerName;

      return `${timestamp} | ${speaker}: ${line.content}`;
    })
    .join("\n");
}

module.exports = {
  buildVoiceRoomMemory,
};
