const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidCents, calculateInvoice, paymentStatus, agingBucket, manilaStartOfDay } = require("../src/utils/financials");

test("invoice totals are exact integer centavos", () => {
  assert.deepEqual(calculateInvoice([
    { unitPriceCents: 1099, quantity: 3 },
    { unitPriceCents: 200, quantity: 1 }
  ]), { subtotalCents: 3497, discountCents: 0, taxCents: 0, totalCents: 3497 });
});

test("configured tax uses integer basis-point arithmetic", () => {
  assert.deepEqual(calculateInvoice([{ unitPriceCents: 10001, quantity: 1 }], 1000), {
    subtotalCents: 10001,
    discountCents: 0,
    taxCents: 1000,
    totalCents: 11001
  });
  assert.throws(() => calculateInvoice([{ unitPriceCents: 100, quantity: 1 }], 10001));
});

test("invalid and unsafe monetary values are rejected", () => {
  assert.equal(isValidCents(0), false);
  assert.equal(isValidCents(-1), false);
  assert.equal(isValidCents(1.5), false);
  assert.equal(isValidCents(Number.MAX_SAFE_INTEGER + 1), false);
  assert.throws(() => calculateInvoice([{ unitPriceCents: 101, quantity: 0 }]));
  assert.throws(() => calculateInvoice([{ unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }]));
});

test("payment status follows actual paid balance and due date", () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);
  assert.equal(paymentStatus(1000, 0, future), "issued");
  assert.equal(paymentStatus(1000, 500, future), "partially_paid");
  assert.equal(paymentStatus(1000, 1000, past), "paid");
  assert.equal(paymentStatus(1000, 0, past), "overdue");
});

test("aging report assigns the requested buckets", () => {
  const now = new Date("2026-01-31T12:00:00Z");
  assert.equal(agingBucket("2026-01-31T00:00:00Z", now), "current");
  assert.equal(agingBucket("2026-01-15T12:00:00Z", now), "1-30");
  assert.equal(agingBucket("2025-12-15T12:00:00Z", now), "31-60");
  assert.equal(agingBucket("2025-11-15T12:00:00Z", now), "61-90");
  assert.equal(agingBucket("2025-10-01T12:00:00Z", now), "90+");
});

test("business-day revenue boundary uses Asia/Manila", () => {
  const instant = new Date("2026-01-31T18:00:00Z");
  assert.equal(manilaStartOfDay(instant).toISOString(), "2026-01-31T16:00:00.000Z");
});
