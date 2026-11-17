const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createApp } = require("./app");
const { connectDatabase } = require("./config/database");
const { ensureCoreIndexes } = require("./models");

async function start() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short. Run `npm run setup` to create .env, then keep its generated secret.");
  }
  const dbName = await connectDatabase(process.env.MONGODB_URI);
  await ensureCoreIndexes();
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  const server = app.listen(port, '0.0.0.0', () => console.log(`MediLink Billing listening on port ${port} (database: ${dbName})`));
  const shutdown = () => server.close(async () => {
    const mongoose = require("mongoose");
    await mongoose.disconnect();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Unable to start MediLink Billing:", error.message);
  process.exitCode = 1;
});
