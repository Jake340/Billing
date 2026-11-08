const test = require("node:test");
const assert = require("node:assert/strict");
const { getDatabaseName } = require("../src/config/database");

test("billing database defaults to an isolated database", () => {
  const previous = process.env.DB_NAME;
  delete process.env.DB_NAME;
  try {
    assert.equal(getDatabaseName(), "medilink_billing_dev");
  } finally {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
  }
});

test("billing database cannot target the Laboratory database", () => {
  const previous = process.env.DB_NAME;
  process.env.DB_NAME = "medilink_lab_dev";
  try {
    assert.throws(() => getDatabaseName(), /cannot use the Laboratory database/);
  } finally {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
  }
});
