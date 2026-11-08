const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const argon2 = require("argon2");
const { connectDatabase } = require("../src/config/database");
const { BillingUser } = require("../src/models");

async function main() {
  const { ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 12 characters).");
  }
  await connectDatabase(process.env.MONGODB_URI);
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });
  await BillingUser.create({ username: ADMIN_USERNAME, email: ADMIN_EMAIL, passwordHash, role: "billing_admin" });
  console.log(`Billing administrator '${ADMIN_USERNAME}' created.`);
}

main().catch((error) => {
  console.error("Unable to create billing administrator:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
