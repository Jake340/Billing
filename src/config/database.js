const dns = require("node:dns");
const mongoose = require("mongoose");

// Billing shares one database with the other MediLink subsystems so it can read their records.
// Its own collections all start with "billing_".
function getDatabaseName() {
  return process.env.DB_NAME || "medilink_lab_dev";
}

async function connectDatabase(uri) {
  if (!uri) {
    throw new Error("MONGODB_URI is missing. Set it in the project's .env file or Render environment variables.");
  }
  const dbName = getDatabaseName();
  // autoCreate/autoIndex are off so that no billing collection is added to the shared
  // database until it is actually needed; see ensureCoreIndexes/ensureIndexes in models.
  const options = { dbName, autoIndex: false, autoCreate: false };
  try {
    await mongoose.connect(uri, options);
  } catch (error) {
    // Some PCs/routers refuse the SRV lookup that mongodb+srv:// addresses need.
    // Retry once through public DNS servers before giving up.
    if (!/querySrv|queryTxt/.test(String(error.message))) throw error;
    dns.setServers(["8.8.8.8", "1.1.1.1"]);
    await mongoose.connect(uri, options);
  }
  return dbName;
}

module.exports = { connectDatabase, getDatabaseName };
