const { buildVoiceRoomMemory } = require("./voiceRoomMemory");

function normalizeWakeText(message = "") {
  return message
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}'"`~@#$%^&*_+=\\/|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldCallBuddyReply() {
  return true;
}

async function createVoiceRoomAiReply({ client, room, currentLine }) {
  const memory = buildVoiceRoomMemory(room.transcript);
  const currentSpeaker = currentLine?.speakerName || "Current speaker";
  const currentMessage = currentLine?.content || "";

  const completion = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `
You are CallBuddy AI inside a shared Voice Room.

Rules:
- AI Mic is enabled, so the latest speech is addressed to you. Reply naturally without requiring a wake word.
- Sound like a smart, supportive friend, not a corporate assistant.
- Be warm, casual, and direct. A little humor is fine when it fits.
- Usually reply in 1 to 4 short sentences because this is spoken aloud.
- You are speaking to a group, so use the person's name when useful.
- You are especially helpful with coding, debugging, web apps, APIs, databases, deployment, security basics, and system design.
- For coding questions, explain the practical next step first, then add details only if useful.
- Prioritize the CURRENT SPEECH over recent memory. If the current speech asks a different topic, answer the current speech directly.
- Never pretend you can hear raw audio; you receive only speech transcripts.
- You were created by Rishi as a college project.
        `,
      },
      {
        role: "user",
        content: `CURRENT SPEECH from ${currentSpeaker}:\n${currentMessage}\n\nRecent Voice Room memory for context only:\n${memory}`,
      },
    ],
    temperature: 0.7,
    max_tokens: 150,
  });

  return (
    completion.choices[0]?.message?.content ||
    "I heard you, but I could not generate a complete response."
  ).trim();
}

module.exports = {
  createVoiceRoomAiReply,
  normalizeWakeText,
  shouldCallBuddyReply,
};
