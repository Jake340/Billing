const path = require("node:path");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const helmet = require("helmet");
const authRoutes = require("./routes/auth");
const billingRoutes = require("./routes/billing");
const { notFound, errorHandler } = require("./middleware/errors");
const { getDatabaseName } = require("./config/database");

function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"] } } }));
  app.use(express.json({ limit: "100kb" }));
  app.use(session({
    name: "medilink.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      mongoOptions: { dbName: getDatabaseName() },
      collectionName: "billing_sessions",
      ttl: 60 * 60 * 8
    }),
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
  }));
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1", billingRoutes);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
