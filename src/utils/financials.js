const MAX_CENTS = Number.MAX_SAFE_INTEGER;

function isValidCents(value, { allowZero = false } = {}) {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0) && value <= MAX_CENTS;
}

function calculateInvoice(items, taxBasisPoints = 0) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("An invoice must contain at least one line item.");
  }
  if (!Number.isSafeInteger(taxBasisPoints) || taxBasisPoints < 0 || taxBasisPoints > 10000) {
    throw new Error("Tax configuration must be an integer from 0 to 10000 basis points.");
  }

  const totalCents = items.reduce((total, item) => {
    if (!isValidCents(item.unitPriceCents) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) {
      throw new Error("Invoice line item amount or quantity is invalid.");
    }
    const lineTotal = item.unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(total + lineTotal)) {
      throw new Error("Invoice total exceeds the supported amount.");
    }
    return total + lineTotal;
  }, 0);

  const taxCents = Number((BigInt(totalCents) * BigInt(taxBasisPoints) + 5000n) / 10000n);
  const grandTotalCents = totalCents + taxCents;
  if (!Number.isSafeInteger(grandTotalCents)) {
    throw new Error("Invoice total exceeds the supported amount.");
  }
  return { subtotalCents: totalCents, discountCents: 0, taxCents, totalCents: grandTotalCents };
}

function paymentStatus(totalCents, paidCents, dueDate, now = new Date()) {
  if (paidCents >= totalCents) return "paid";
  if (paidCents > 0) return "partially_paid";
  if (dueDate && new Date(dueDate) < now) return "overdue";
  return "issued";
}

function agingBucket(dueDate, now = new Date()) {
  const days = Math.floor((now - new Date(dueDate)) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function manilaStartOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 8 * 60 * 60 * 1000);
}

function manilaStartOfMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, 1) - 8 * 60 * 60 * 1000);
}

module.exports = { isValidCents, calculateInvoice, paymentStatus, agingBucket, manilaStartOfDay, manilaStartOfMonth };
