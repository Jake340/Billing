const express = require("express");
const { z } = require("zod");
const { rateLimit } = require("express-rate-limit");
const { BillingUser, AuditLog } = require("../models");
const { billingRoleFor, verifyPassword, displayName, auditEntry } = require("../utils/access");

const router = express.Router();
// Only failed attempts count toward the limit, and the block is explained in plain words.
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, skipSuccessfulRequests: true,
  message: { error: "Too many failed sign-in attempts. Please wait 15 minutes and try again." }
});
const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256)
});

// Staff sign in with their account from the shared MediLink `users` collection.
router.post("/login", loginLimit, async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const login = username.toLowerCase();
  const user = await BillingUser.findOne({ $or: [{ username: login }, { email: login }] }).select("+passwordHash");
  const valid = Boolean(user) && await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await AuditLog.create(auditEntry(null, "auth.login_failed", { details: { attempted: login.slice(0, 120) }, ip: req.ip }));
    return res.status(401).json({ error: "Invalid username/email or password." });
  }
  const role = billingRoleFor(user);
  const identity = { id: user.id, username: user.username || user.email, name: displayName(user), role: role || user.role };
  if (!role) {
    await AuditLog.create(auditEntry(identity, "auth.login_denied", { details: { reason: "no Billing access" }, ip: req.ip }));
    return res.status(403).json({ error: "This account does not have access to Billing. Ask an administrator for a billing role." });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = identity;
  await AuditLog.create(auditEntry(identity, "auth.login", { ip: req.ip }));
  res.json({ user: req.session.user });
});

router.get("/session", (req, res) => res.json({ user: req.session.user || null }));

router.post("/logout", async (req, res) => {
  const user = req.session.user;
  if (user) await AuditLog.create(auditEntry(user, "auth.logout", { ip: req.ip }));
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie("medilink.sid");
  res.status(204).end();
});

module.exports = router;
