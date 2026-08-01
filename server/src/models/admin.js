import mongoose from 'mongoose';

/**
 * Exactly one document ever exists in this collection — the author. `singleton` is
 * a unique constant field, so a second admin is rejected by the database itself
 * rather than by application logic that could be bypassed.
 *
 * All three credentials are stored only as scrypt hashes. The username is hashed
 * too (per spec), which is why login verifies against the single document instead
 * of querying by username.
 */
const adminSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'admin', unique: true, immutable: true },
    displayName: { type: String, default: 'The Author' },
    usernameHash: { type: String, required: true },
    passwordHash: { type: String, required: true },
    authKeyHash: { type: String, required: true },

    // Refresh-token rotation: only hashes are persisted, so a database leak cannot
    // be replayed as a session.
    refreshTokens: [
      {
        tokenHash: { type: String, required: true },
        issuedAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
        userAgent: String,
      },
    ],

    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

adminSchema.methods.isLocked = function isLocked() {
  return this.lockedUntil instanceof Date && this.lockedUntil > new Date();
};

export const Admin = mongoose.model('Admin', adminSchema);
