const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test_jwt_secret_for_hardening_suite_32chars!";

const { createToken, createRoomToken, JWT_SECRET } = require("../server");

test("Authentication & JWT Security Suite", async (t) => {
  await t.test("createToken signs user JWT with verified userId", () => {
    const userId = "507f1f77bcf86cd799439011";
    const token = createToken(userId);
    assert.ok(token, "Token should be generated");

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.equal(decoded.userId, "507f1f77bcf86cd799439011");
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000), "Token should have expiration");
  });

  await t.test("createRoomToken creates signed room session token with participantId and roomId", () => {
    const token = createRoomToken({
      participantId: "part_abc123",
      roomId: "room_xyz789",
      userId: "user_123",
      isHost: false,
    });
    assert.ok(token, "Room token should be generated");

    const decoded = jwt.verify(token, JWT_SECRET);
    assert.equal(decoded.participantId, "part_abc123");
    assert.equal(decoded.roomId, "room_xyz789");
    assert.equal(decoded.isHost, false);
    assert.equal(decoded.isGuest, false);
    assert.equal(decoded.userId, "user_123");
    assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
  });

  await t.test("createRoomToken defaults to guest role when userId is omitted", () => {
    const token = createRoomToken({
      participantId: "part_guest456",
      roomId: "room_xyz789",
    });
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.equal(decoded.participantId, "part_guest456");
    assert.equal(decoded.isGuest, true);
    assert.equal(decoded.userId, null);
  });

  await t.test("JWT verification rejects token signed with wrong secret", () => {
    const forgedToken = jwt.sign(
      { userId: "attacker_id" },
      "wrong_attacker_secret_key"
    );

    assert.throws(
      () => {
        jwt.verify(forgedToken, JWT_SECRET);
      },
      (err) => err instanceof jwt.JsonWebTokenError
    );
  });

  await t.test("JWT verification rejects expired token", () => {
    const expiredToken = jwt.sign(
      { userId: "user_old" },
      JWT_SECRET,
      { expiresIn: "-1s" }
    );

    assert.throws(
      () => {
        jwt.verify(expiredToken, JWT_SECRET);
      },
      (err) => err instanceof jwt.TokenExpiredError
    );
  });
});
