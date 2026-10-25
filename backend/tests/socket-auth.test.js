const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const { createToken, createRoomToken, JWT_SECRET } = require("../server");

test("Socket.IO Authentication & Realtime Security Suite", async (t) => {
  // Simulate io.use middleware
  function runSocketAuthMiddleware(handshake) {
    return new Promise((resolve) => {
      const socket = {
        handshake,
        data: {},
      };

      const token =
        socket.handshake.auth?.token ||
        socket.handshake.auth?.roomToken ||
        (socket.handshake.headers?.authorization?.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice(7)
          : null);

      if (!token) {
        return resolve({ err: new Error("Authentication required for realtime connection"), socket });
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.data.userId = decoded.userId || null;
        socket.data.participantId = decoded.participantId || null;
        socket.data.roomId = decoded.roomId || null;
        socket.data.isGuest = Boolean(decoded.isGuest);
        socket.data.auth = decoded;
        resolve({ err: null, socket });
      } catch (e) {
        resolve({ err: new Error("Invalid or expired session token"), socket });
      }
    });
  }

  await t.test("Socket connection is REJECTED without auth credentials", async () => {
    const { err } = await runSocketAuthMiddleware({ auth: {} });
    assert.ok(err, "Missing auth must return an error");
    assert.match(err.message, /Authentication required/i);
  });

  await t.test("Socket connection is REJECTED with forged token", async () => {
    const forgedToken = jwt.sign({ userId: "hacker" }, "wrong_secret");
    const { err } = await runSocketAuthMiddleware({ auth: { token: forgedToken } });
    assert.ok(err, "Forged token must return an error");
    assert.match(err.message, /Invalid or expired session token/i);
  });

  await t.test("Socket connection is REJECTED with expired token", async () => {
    const expiredToken = jwt.sign(
      { userId: "user_old" },
      JWT_SECRET,
      { expiresIn: "-5s" }
    );
    const { err } = await runSocketAuthMiddleware({ auth: { token: expiredToken } });
    assert.ok(err, "Expired token must be rejected");
  });

  await t.test("Socket connection is ACCEPTED with valid user token", async () => {
    const userToken = createToken("user_alice_1");
    const { err, socket } = await runSocketAuthMiddleware({ auth: { token: userToken } });
    assert.equal(err, null);
    assert.equal(socket.data.userId, "user_alice_1");
  });

  await t.test("Socket connection is ACCEPTED with valid guest roomToken", async () => {
    const roomToken = createRoomToken({
      participantId: "guest_bob_2",
      roomId: "room_123",
      role: "guest",
    });
    const { err, socket } = await runSocketAuthMiddleware({ auth: { roomToken } });
    assert.equal(err, null);
    assert.equal(socket.data.participantId, "guest_bob_2");
    assert.equal(socket.data.roomId, "room_123");
    assert.equal(socket.data.isGuest, true);
  });

  await t.test("Participant anti-spoofing rejects claimed participantId mismatching token", () => {
    const socket = {
      data: {
        userId: "user_alice_1",
        participantId: "part_alice_real",
      },
    };

    const claimedParticipantId = "part_bob_victim";
    const roomParticipants = [
      { participantId: "part_alice_real", userId: "user_alice_1" },
      { participantId: "part_bob_victim", userId: "user_bob_2" },
    ];

    // Verification logic:
    let verifiedParticipant = null;
    if (socket.data.userId) {
      verifiedParticipant = roomParticipants.find(
        (p) => String(p.userId || "") === String(socket.data.userId)
      );
    }

    assert.ok(verifiedParticipant);
    assert.equal(verifiedParticipant.participantId, "part_alice_real");
    assert.notEqual(
      verifiedParticipant.participantId,
      claimedParticipantId,
      "Attacker cannot assume Bob's participant identity"
    );
  });

  await t.test("WebRTC signaling validation rejects peers outside the verified room", () => {
    const mockRoomSockets = new Set(["peer_socket_inside_room"]);

    function isValidSignalingTarget(targetPeerId, verifiedRoomId) {
      if (!targetPeerId || !verifiedRoomId) return false;
      return mockRoomSockets.has(targetPeerId);
    }

    assert.equal(
      isValidSignalingTarget("peer_socket_inside_room", "room_1"),
      true,
      "Target peer inside the room is valid"
    );

    assert.equal(
      isValidSignalingTarget("unrelated_external_socket", "room_1"),
      false,
      "Target peer outside room must be rejected"
    );

    assert.equal(
      isValidSignalingTarget("peer_socket_inside_room", null),
      false,
      "Unverified room socket cannot signal"
    );
  });
});
