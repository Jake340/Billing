const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const projectRoot = path.join(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
const examplePath = path.join(projectRoot, ".env.example");

if (fs.existsSync(envPath)) {
  console.log(".env already exists; it was not changed.");
  process.exit(0);
}

const template = fs.readFileSync(examplePath, "utf8");
const localEnv = template.replace(
  /^SESSION_SECRET=.*$/m,
  `SESSION_SECRET=${randomBytes(32).toString("hex")}`
);
fs.writeFileSync(envPath, localEnv, { flag: "wx", mode: 0o600 });
console.log("Created .env with a new local session secret.");
console.log("Now edit .env and set MONGODB_URI to your rotated MongoDB credential.");
console.log("DB_NAME must be the shared MediLink database (medilink_lab_dev) so Billing can read the other subsystems.");
