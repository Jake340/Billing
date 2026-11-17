// Billing signs staff in from the shared MediLink `users` collection and writes its
// activity to the shared `auditlogs` collection, in the same shape the other subsystems use.
const argon2 = require("argon2");
const bcrypt = require("bcryptjs");

const BILLING_ROLES = ["billing_admin", "billing_officer", "cashier", "billing_auditor"];

// Which billing role a shared user account gets, or null when it has no access to Billing.
function billingRoleFor(user) {
  if (!user) return null;
  if (user.status && String(user.status).toLowerCase() !== "active") return null;
  if (user.active === false) return null;
  if (BILLING_ROLES.includes(user.role)) return user.role;
  // Portal-wide administrators (subsystems: ["ALL"]) administer Billing too.
  if (user.role === "Administrator" && Array.isArray(user.subsystems) && user.subsystems.includes("ALL")) return "billing_admin";
  return null;
}

// The other subsystems hash passwords with either Argon2 or bcrypt; accept both.
async function verifyPassword(hash, password) {
  if (typeof hash !== "string" || typeof password !== "string" || !hash) return false;
  try {
    if (hash.startsWith("$argon2")) return await argon2.verify(hash, password);
    if (/^\$2[aby]\$/.test(hash)) return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
  return false;
}

function displayName(user) {
  const name = [user?.firstName, user?.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return name || user?.username || user?.email || "Unknown user";
}

function describe(details) {
  return Object.entries(details || {}).map(([key, value]) => {
    if (key.endsWith("Cents") && Number.isFinite(value)) return `${key.slice(0, -5)}: PHP ${(value / 100).toFixed(2)}`;
    return `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : value}`;
  }).join(", ");
}

// Builds one document for the shared `auditlogs` collection.
// `actor` is the session user ({ id, username, name, role }) or null for anonymous events.
function auditEntry(actor, action, { recordType = "", recordId = "", details = {}, ip = "" } = {}) {
  const record = [recordType, recordId].map((part) => String(part || "")).filter(Boolean).join(" ");
  return {
    user: actor?.id || null,
    userName: actor?.name || actor?.username || "Unknown user",
    role: actor?.role || "—",
    action: String(action).replace(/^auth\./, "").replace(/[.\s]+/g, "_").toUpperCase(),
    module: "Billing",
    details: [record, describe(details)].filter(Boolean).join(" — ").slice(0, 1000),
    ip: String(ip || "")
  };
}

module.exports = { BILLING_ROLES, billingRoleFor, verifyPassword, displayName, auditEntry };
