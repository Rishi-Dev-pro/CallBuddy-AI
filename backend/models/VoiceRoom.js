const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    participantId: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isHost: {
      type: Boolean,
      default: false,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },

    leftAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const transcriptSchema = new mongoose.Schema(
  {
    participantId: {
      type: String,
      default: null,
    },

    speakerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    speakerType: {
      type: String,
      enum: ["host", "guest", "assistant", "system"],
      required: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 3000,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const voiceRoomSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    hostUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    hostName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    status: {
      type: String,
      enum: ["active", "ended"],
      default: "active",
      index: true,
    },

    endedAt: {
      type: Date,
      default: null,
    },

    participants: {
      type: [participantSchema],
      default: [],
    },

    transcript: {
      type: [transcriptSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("VoiceRoom", voiceRoomSchema);