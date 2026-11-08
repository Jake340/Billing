const express = require("express");
const argon2 = require("argon2");
const { z } = require("zod");
const { rateLimit } = require("express-rate-limit");
const { BillingUser, AuditLog } = require("../models");

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const loginSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256)
});

router.post("/login", loginLimit, async (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  const user = await BillingUser.findOne({ $or: [{ username: username.toLowerCase() }, { email: username.toLowerCase() }] }).select("+passwordHash");
  const valid = user && user.active && await argon2.verify(user.passwordHash, password);
  if (!valid) {
    await AuditLog.create({ username: user?.username || "unknown", action: "auth.login_failed", ip: req.ip });
    return res.status(401).json({ error: "Invalid username/email or password." });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.user = { id: user.id, username: user.username, role: user.role };
  await AuditLog.create({ userId: user._id, username: user.username, action: "auth.login", ip: req.ip });
  res.json({ user: req.session.user });
});

router.get("/session", (req, res) => res.json({ user: req.session.user || null }));

router.post("/logout", async (req, res) => {
  const user = req.session.user;
  if (user) await AuditLog.create({ userId: user.id, username: user.username, action: "auth.logout", ip: req.ip });
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie("medilink.sid");
  res.status(204).end();
});

module.exports = router;
