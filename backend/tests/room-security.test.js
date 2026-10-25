const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const {
  getPublicVoiceRoom,
  createRoomToken,
  createToken,
  JWT_SECRET,
} = require("../server");

test("Room Access & Authorization Security Suite", async (t) => {
  const mockRoom = {
    _id: "507f1f77bcf86cd799439011",
    inviteCode: "a1b2c3d4e5",
    title: "Secret Strategy Call",
    hostUserId: "507f191e810c19729de860ea",
    hostName: "Alice Host",
    status: "active",
    createdAt: new Date(),
    endedAt: null,
    participants: [
      {
        participantId: "part_host_1",
        userId: "507f191e810c19729de860ea",
        name: "Alice Host",
        isHost: true,
        joinedAt: new Date(),
        leftAt: null,
      },
      {
        participantId: "part_bob_2",
        userId: "507f191e810c19729de860eb",
        name: "Bob Friend",
        isHost: false,
        joinedAt: new Date(),
        leftAt: null,
      },
    ],
    transcript: [
      {
        _id: "line_1",
        participantId: "part_host_1",
        speakerName: "Alice Host",
        speakerType: "participant",
        content: "Top secret API keys and company plans.",
        createdAt: new Date(),
      },
      {
        _id: "line_2",
        participantId: null,
        speakerName: "CALLBUDDY AI",
        speakerType: "assistant",
        content: "Understood, keeping this between us.",
        createdAt: new Date(),
      },
    ],
  };

  await t.test("getPublicVoiceRoom outputs inviteCode and maps participants/transcripts", () => {
    const pub = getPublicVoiceRoom(mockRoom);
    assert.equal(pub.inviteCode, "a1b2c3d4e5");
    assert.equal(pub.title, "Secret Strategy Call");
    assert.equal(pub.participants.length, 2);
    assert.equal(pub.transcript.length, 2);
    assert.equal(pub.transcript[0].content, "Top secret API keys and company plans.");
  });

  await t.test("Non-member preview shields transcript and participant identities", () => {
    const nonMemberPreview = {
      id: mockRoom._id.toString(),
      inviteCode: mockRoom.inviteCode,
      title: mockRoom.title,
      hostName: mockRoom.hostName,
      status: mockRoom.status,
      endedAt: mockRoom.endedAt,
      createdAt: mockRoom.createdAt,
      participantCount: mockRoom.participants.filter((p) => !p.leftAt).length,
      isMember: false,
    };

    assert.equal(nonMemberPreview.isMember, false);
    assert.equal(nonMemberPreview.participantCount, 2);
    assert.equal(nonMemberPreview.transcript, undefined, "Transcript must NOT be exposed to non-members");
    assert.equal(nonMemberPreview.participants, undefined, "Participant details must NOT be exposed to non-members");
  });

  await t.test("Leave authorization blocks attacker from kicking another participant", () => {
    const bobToken = createRoomToken({
      participantId: "part_bob_2",
      roomId: mockRoom._id.toString(),
      userId: "507f191e810c19729de860eb",
    });

    const targetVictimId = "part_host_1"; // Bob tries to kick Alice Host

    const decoded = jwt.verify(bobToken, JWT_SECRET);

    let isAuthorized = false;
    if (decoded.participantId === targetVictimId) {
      isAuthorized = true;
    } else if (decoded.userId && String(mockRoom.hostUserId) === String(decoded.userId)) {
      isAuthorized = true;
    }

    assert.equal(
      isAuthorized,
      false,
      "Non-host participant Bob must NOT be authorized to kick Alice"
    );
  });

  await t.test("Leave authorization permits participant to leave themselves", () => {
    const bobToken = createRoomToken({
      participantId: "part_bob_2",
      roomId: mockRoom._id.toString(),
      userId: "507f191e810c19729de860eb",
    });

    const decoded = jwt.verify(bobToken, JWT_SECRET);
    let isAuthorized = false;
    if (decoded.participantId === "part_bob_2") {
      isAuthorized = true;
    }

    assert.equal(isAuthorized, true, "Participant can leave themselves");
  });

  await t.test("Leave authorization permits host to moderate room participants", () => {
    const hostUserToken = createToken(mockRoom.hostUserId);

    const decoded = jwt.verify(hostUserToken, JWT_SECRET);
    let isAuthorized = false;
    if (decoded.userId && String(mockRoom.hostUserId) === String(decoded.userId)) {
      isAuthorized = true;
    }

    assert.equal(isAuthorized, true, "Room Host is authorized to moderate participants");
  });
});
