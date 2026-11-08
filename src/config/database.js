const mongoose = require("mongoose");

function getDatabaseName() {
  return process.env.DB_NAME || "medilink_lab_dev";
}

async function connectDatabase(uri) {
  if (!uri) {
    throw new Error("MONGODB_URI is missing. Set it in the project's .env file or Render environment variables.");
  }
  const dbName = getDatabaseName();
  await mongoose.connect(uri, { dbName, autoIndex: process.env.NODE_ENV !== "production" });
  return dbName;
}

module.exports = { connectDatabase, getDatabaseName };