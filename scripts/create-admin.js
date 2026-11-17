const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const argon2 = require("argon2");
const { connectDatabase } = require("../src/config/database");
const { BillingUser } = require("../src/models");

// Adds a billing administrator to the shared MediLink `users` collection.
async function main() {
  const { ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 12 characters).");
  }
  await connectDatabase(process.env.MONGODB_URI);
  const username = ADMIN_USERNAME.trim().toLowerCase();
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const taken = await BillingUser.findOne({ $or: [{ username }, { email }] }).lean();
  if (taken) throw new Error("That username or email is already used by another MediLink account. Choose a different one.");
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
  const billingUsers = await BillingUser.countDocuments({ employeeId: /^BILL-/ });
  await BillingUser.create({
    employeeId: `BILL-${String(billingUsers + 1).padStart(5, "0")}`,
    firstName: process.env.ADMIN_FIRST_NAME || "Billing",
    lastName: process.env.ADMIN_LAST_NAME || "Administrator",
    username, email, passwordHash, role: "billing_admin", status: "Active"
  });
  console.log(`Billing administrator '${username}' added to the shared users collection.`);
}

main().catch((error) => {
  console.error("Unable to create billing administrator:", error.code === 11000 ? "that username, email, or employee ID already exists." : error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
