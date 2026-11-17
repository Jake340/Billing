const test = require("node:test");
const assert = require("node:assert/strict");
const argon2 = require("argon2");
const bcrypt = require("bcryptjs");
const { billingRoleFor, verifyPassword, displayName, auditEntry } = require("../src/utils/access");

test("only billing accounts and portal-wide administrators may use Billing", () => {
  assert.equal(billingRoleFor({ role: "cashier", status: "Active" }), "cashier");
  assert.equal(billingRoleFor({ role: "billing_admin" }), "billing_admin");
  assert.equal(billingRoleFor({ role: "Administrator", subsystems: ["ALL"], status: "Active" }), "billing_admin");
  assert.equal(billingRoleFor({ role: "Administrator", subsystems: ["admissions"], status: "Active" }), null);
  assert.equal(billingRoleFor({ role: "lab_admin", status: "Active" }), null);
  assert.equal(billingRoleFor({ role: "nurse", status: "Active" }), null);
  assert.equal(billingRoleFor({ role: "billing_admin", status: "Inactive" }), null);
  assert.equal(billingRoleFor({ role: "billing_admin", active: false }), null);
  assert.equal(billingRoleFor(null), null);
});

test("passwords hashed by any subsystem (Argon2 or bcrypt) are verified", async () => {
  const argonHash = await argon2.hash("correct horse", { type: argon2.argon2id });
  const bcryptHash = await bcrypt.hash("correct horse", 4);
  assert.equal(await verifyPassword(argonHash, "correct horse"), true);
  assert.equal(await verifyPassword(argonHash, "wrong"), false);
  assert.equal(await verifyPassword(bcryptHash, "correct horse"), true);
  assert.equal(await verifyPassword(bcryptHash, "wrong"), false);
  assert.equal(await verifyPassword("plaintext", "plaintext"), false);
  assert.equal(await verifyPassword(undefined, "x"), false);
  assert.equal(await verifyPassword("$argon2id$broken", "x"), false);
});

test("audit entries use the shared auditlogs shape", () => {
  const actor = { id: "6afb27a4eb8b113fecb809ea", username: "billingadmin", name: "Billing Admin", role: "billing_admin" };
  assert.deepEqual(auditEntry(actor, "payment.recorded", { recordType: "Payment", recordId: "PAY-00000001", details: { amountCents: 150050, invoiceNumber: "INV-00000001" }, ip: "127.0.0.1" }), {
    user: actor.id,
    userName: "Billing Admin",
    role: "billing_admin",
    action: "PAYMENT_RECORDED",
    module: "Billing",
    details: "Payment PAY-00000001 — amount: PHP 1500.50, invoiceNumber: INV-00000001",
    ip: "127.0.0.1"
  });
  const anonymous = auditEntry(null, "auth.login_failed", { details: { attempted: "someone" } });
  assert.equal(anonymous.user, null);
  assert.equal(anonymous.userName, "Unknown user");
  assert.equal(anonymous.action, "LOGIN_FAILED");
  assert.equal(anonymous.details, "attempted: someone");
  assert.equal(auditEntry(actor, "auth.login").action, "LOGIN");
});

test("display name falls back sensibly", () => {
  assert.equal(displayName({ firstName: "Super", lastName: "Admin" }), "Super Admin");
  assert.equal(displayName({ username: "cashier1" }), "cashier1");
  assert.equal(displayName({ email: "a@b.c" }), "a@b.c");
  assert.equal(displayName(null), "Unknown user");
});
