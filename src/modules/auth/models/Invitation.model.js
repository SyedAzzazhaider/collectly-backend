'use strict';

const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'agent', 'accountant'],
    default: 'agent',
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  invitedByName: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired'],
    default: 'pending',
  },
  acceptedAt: {
    type: Date,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // Auto-delete expired invitations
  },
}, {
  timestamps: true,
});

invitationSchema.index({ token: 1 });
invitationSchema.index({ email: 1, status: 1 });

module.exports = mongoose.model('Invitation', invitationSchema);