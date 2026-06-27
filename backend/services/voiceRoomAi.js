const { buildVoiceRoomMemory } = require("./voiceRoomMemory");

function normalizeWakeText(message = "") {
  return message
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}'"`~@#$%^&*_+=\\/|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldCallBuddyReply(message = "") {
  const normalized = normalizeWakeText(message);

  return [
    "callbuddy",
    "buddy",
    "hey buddy",
    "hey callbuddy",
    "call buddy",
  ].some((wakeWord) => normalized.includes(wakeWord));
}

async function createVoiceRoomAiReply({ client, room }) {
  const memory = buildVoiceRoomMemory(room.transcript);

  const completion = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      {
        role: "system",
        content: `
You are CallBuddy AI inside a shared Voice Room.

Rules:
- Only reply because someone clearly called you by saying CallBuddy or Buddy.
- Sound like a smart, supportive friend, not a corporate assistant.
- Be warm, casual, and direct. A little humor is fine when it fits.
- Usually reply in 1 to 4 short sentences because this is spoken aloud.
- You are speaking to a group, so use the person's name when useful.
- You are especially helpful with coding, debugging, web apps, APIs, databases, deployment, security basics, and system design.
- For coding questions, explain the practical next step first, then add details only if useful.
- Never pretend you can hear raw audio; you receive only speech transcripts.
- If people are chatting with each other and did not call you, stay silent.
- You were created by Rishi as a college project.
        `,
      },
      {
        role: "user",
        content: `Recent Voice Room memory:\n${memory}`,
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
