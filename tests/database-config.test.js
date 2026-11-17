const test = require("node:test");
const assert = require("node:assert/strict");
const { getDatabaseName } = require("../src/config/database");

function withDbName(value, run) {
  const previous = process.env.DB_NAME;
  if (value === undefined) delete process.env.DB_NAME;
  else process.env.DB_NAME = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous;
  }
}

test("billing defaults to the shared MediLink database", () => {
  withDbName(undefined, () => assert.equal(getDatabaseName(), "medilink_lab_dev"));
});

test("DB_NAME overrides the database name", () => {
  withDbName("some_other_db", () => assert.equal(getDatabaseName(), "some_other_db"));
});
