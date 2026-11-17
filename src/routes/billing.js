const express = require("express");
const mongoose = require("mongoose");
const { z } = require("zod");
const {
  BillingService, Invoice, Payment, Receipt,
  InsuranceProvider, InsuranceClaim, Refund, AuditLog, BillingSettings, ensureIndexes
} = require("../models");
const { ROLES, requireAuth, allowRoles } = require("../middleware/auth");
const { isValidCents, calculateInvoice, paymentStatus, agingBucket, manilaStartOfDay, manilaStartOfMonth } = require("../utils/financials");
const { nextNumber } = require("../utils/sequence");
const { auditEntry } = require("../utils/access");
const { listDepartments, findDepartment, listPatients, findPatient, listSourceRecords, toPatient } = require("../services/subsystems");

const router = express.Router();
const serviceInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().min(1).max(80),
  unitPriceCents: z.number().int().nonnegative().safe()
});
const invoiceInput = z.object({
  patientId: z.string().trim().min(1).max(80),
  items: z.array(z.object({ serviceId: z.string().min(1), quantity: z.number().int().min(1).max(10000) })).min(1).max(100),
  notes: z.string().trim().max(2000).optional()
});
const billInput = z.object({
  department: z.number().int().positive(),
  patientId: z.string().trim().min(1).max(80),
  amountCents: z.number().int().positive().safe(),
  description: z.string().trim().max(300).optional(),
  sourceReference: z.string().trim().max(80).optional()
});

function audit(req, action, recordType, recordId, details = {}) {
  return AuditLog.create(auditEntry(req.session.user, action, { recordType, recordId, details, ip: req.ip }));
}

function paginated(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

router.use(requireAuth);

router.get("/dashboard", allowRoles(ROLES.readBilling), async (req, res) => {
  const todayStart = manilaStartOfDay();
  const monthStart = manilaStartOfMonth();
  const now = new Date();
  const [paidToday, paidMonth, outstanding, paid, unpaid, partial, overdue, recentPayments, recentInvoices] = await Promise.all([
    Payment.aggregate([{ $match: { createdAt: { $gte: todayStart, $lte: now } } }, { $group: { _id: null, cents: { $sum: "$amountCents" } } }]),
    Payment.aggregate([{ $match: { createdAt: { $gte: monthStart, $lte: now } } }, { $group: { _id: null, cents: { $sum: "$amountCents" } } }]),
    Invoice.aggregate([{ $match: { status: { $in: ["issued", "partially_paid", "overdue"] } } }, { $group: { _id: null, cents: { $sum: "$balanceCents" } } }]),
    Invoice.countDocuments({ status: "paid" }),
    Invoice.countDocuments({ status: { $in: ["issued", "overdue"] }, paidCents: 0 }),
    Invoice.countDocuments({ status: "partially_paid" }),
    Invoice.countDocuments({ status: { $in: ["issued", "partially_paid", "overdue"] }, balanceCents: { $gt: 0 }, dueDate: { $lt: now } }),
    Payment.find().sort({ createdAt: -1 }).limit(8).lean(),
    Invoice.find({ status: { $ne: "draft" } }).sort({ createdAt: -1 }).limit(8).lean()
  ]);
  res.json({
    totals: {
      revenueTodayCents: paidToday[0]?.cents || 0,
      revenueMonthCents: paidMonth[0]?.cents || 0,
      outstandingCents: outstanding[0]?.cents || 0,
      paidInvoices: paid, unpaidInvoices: unpaid, partiallyPaidInvoices: partial, overdueInvoices: overdue
    },
    recentPayments,
    recentInvoices
  });
});

// The signed-in cashier's own day: what they collected, and what is waiting to be paid.
router.get("/cashier/dashboard", allowRoles(ROLES.cashier), async (req, res) => {
  const me = new mongoose.Types.ObjectId(req.session.user.id);
  const mineToday = { recordedBy: me, createdAt: { $gte: manilaStartOfDay() } };
  const waitingFilter = { status: { $in: ["issued", "partially_paid", "overdue"] }, balanceCents: { $gt: 0 } };
  const [today, methods, waiting, waitingBills, payments] = await Promise.all([
    Payment.aggregate([{ $match: mineToday }, { $group: { _id: null, cents: { $sum: "$amountCents" }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: mineToday }, { $group: { _id: "$method", cents: { $sum: "$amountCents" }, count: { $sum: 1 } } }, { $sort: { cents: -1 } }]),
    Invoice.aggregate([{ $match: waitingFilter }, { $group: { _id: null, cents: { $sum: "$balanceCents" }, count: { $sum: 1 } } }]),
    Invoice.find(waitingFilter).sort({ createdAt: 1 }).limit(8).lean(),
    Payment.find({ recordedBy: me }).sort({ createdAt: -1 }).limit(10).lean()
  ]);
  const receipts = await Receipt.find({ paymentId: { $in: payments.map((payment) => payment._id) } }).select("paymentId receiptNumber").lean();
  const receiptByPayment = new Map(receipts.map((receipt) => [String(receipt.paymentId), receipt]));
  res.json({
    totals: {
      collectedTodayCents: today[0]?.cents || 0, receiptsToday: today[0]?.count || 0,
      waitingBills: waiting[0]?.count || 0, waitingCents: waiting[0]?.cents || 0
    },
    methodsToday: methods.map((row) => ({ method: row._id, cents: row.cents, count: row.count })),
    waitingBills,
    recentPayments: payments.map((payment) => ({
      ...payment, receiptId: receiptByPayment.get(String(payment._id))?._id || null,
      receiptNumber: receiptByPayment.get(String(payment._id))?.receiptNumber || ""
    }))
  });
});

// Every patient who has paid something, with what they paid and what they still owe.
router.get("/patient-history", allowRoles(ROLES.readBilling), async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = { status: { $nin: ["draft", "cancelled"] } };
  if (search) match.$or = [{ patientName: { $regex: search, $options: "i" } }, { patientId: { $regex: search, $options: "i" } }];
  const [bills, payments] = await Promise.all([
    Invoice.aggregate([
      { $match: match },
      { $sort: { createdAt: 1 } },
      { $group: {
        _id: "$patientId", patientName: { $last: "$patientName" }, bills: { $sum: 1 },
        billsPaid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
        billedCents: { $sum: "$totalCents" }, paidCents: { $sum: "$paidCents" }, balanceCents: { $sum: "$balanceCents" }
      } },
      { $match: { paidCents: { $gt: 0 } } }
    ]),
    Payment.aggregate([{ $group: { _id: "$patientId", payments: { $sum: 1 }, lastPaymentAt: { $max: "$createdAt" } } }])
  ]);
  const paymentsByPatient = new Map(payments.map((row) => [row._id, row]));
  const items = bills.map((row) => ({
    patientId: row._id, patientName: row.patientName, bills: row.bills, billsPaid: row.billsPaid,
    billedCents: row.billedCents, paidCents: row.paidCents, balanceCents: row.balanceCents,
    payments: paymentsByPatient.get(row._id)?.payments || 0, lastPaymentAt: paymentsByPatient.get(row._id)?.lastPaymentAt || null
  })).sort((a, b) => new Date(b.lastPaymentAt || 0) - new Date(a.lastPaymentAt || 0));
  res.json({ items });
});

// One patient's bills and payments, with the receipt for each payment.
router.get("/patient-history/:patientId", allowRoles(ROLES.readBilling), async (req, res) => {
  const patientId = String(req.params.patientId).slice(0, 80);
  const [bills, payments] = await Promise.all([
    Invoice.find({ patientId, status: { $nin: ["draft", "cancelled"] } }).sort({ createdAt: -1 }).limit(200).lean(),
    Payment.find({ patientId }).sort({ createdAt: -1 }).limit(500).lean()
  ]);
  if (!bills.length && !payments.length) return res.status(404).json({ error: "This patient has no billing history." });
  const receipts = await Receipt.find({ paymentId: { $in: payments.map((payment) => payment._id) } }).select("paymentId receiptNumber").lean();
  const receiptByPayment = new Map(receipts.map((receipt) => [String(receipt.paymentId), receipt]));
  res.json({
    patientId, patientName: bills[0]?.patientName || payments[0]?.patientName || "",
    totals: {
      billedCents: bills.reduce((sum, bill) => sum + bill.totalCents, 0), paidCents: bills.reduce((sum, bill) => sum + bill.paidCents, 0),
      balanceCents: bills.reduce((sum, bill) => sum + bill.balanceCents, 0)
    },
    bills,
    payments: payments.map((payment) => ({
      ...payment, receiptId: receiptByPayment.get(String(payment._id))?._id || null,
      receiptNumber: receiptByPayment.get(String(payment._id))?.receiptNumber || ""
    }))
  });
});

router.get("/services", allowRoles(ROLES.readBilling), async (req, res) => {
  const filter = req.query.all === "true" && req.session.user.role === "billing_admin" ? {} : { active: true };
  if (req.query.search) filter.name = { $regex: String(req.query.search).slice(0, 100), $options: "i" };
  res.json({ items: await BillingService.find(filter).sort({ category: 1, name: 1 }).limit(200).lean() });
});

router.post("/services", allowRoles(ROLES.admin), async (req, res) => {
  await ensureIndexes(BillingService);
  const service = await BillingService.create(serviceInput.parse(req.body));
  await audit(req, "service.created", "BillingService", service.id);
  res.status(201).json(service);
});

router.patch("/services/:id", allowRoles(ROLES.admin), async (req, res) => {
  const input = serviceInput.partial().extend({ active: z.boolean().optional() }).parse(req.body);
  const service = await BillingService.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
  if (!service) return res.status(404).json({ error: "Service not found." });
  await audit(req, "service.updated", "BillingService", service.id, input);
  res.json(service);
});

router.get("/invoices", allowRoles(ROLES.readBilling), async (req, res) => {
  const { page, limit, skip } = paginated(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const search = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ invoiceNumber: { $regex: search, $options: "i" } }, { patientName: { $regex: search, $options: "i" } }, { patientId: { $regex: search, $options: "i" } }];
  }
  const [items, total] = await Promise.all([Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Invoice.countDocuments(filter)]);
  res.json({ items, page, limit, total });
});

router.post("/invoices", allowRoles(ROLES.billing), async (req, res) => {
  const input = invoiceInput.parse(req.body);
  // Patients are never created here; they come from the Patient Registration subsystem.
  const patient = await findPatient(input.patientId);
  if (!patient) return res.status(400).json({ error: "Patient was not found in the MediLink patient registry." });
  const services = await BillingService.find({ _id: { $in: input.items.map((item) => item.serviceId) }, active: true });
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const items = input.items.map(({ serviceId, quantity }) => {
    const service = serviceMap.get(serviceId);
    if (!service) throw Object.assign(new Error("An invoice service is unavailable."), { status: 400 });
    const lineTotalCents = service.unitPriceCents * quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw Object.assign(new Error("Invoice total is too large."), { status: 400 });
    return { serviceId: service._id, serviceCode: service.code, description: service.name, category: service.category, quantity, unitPriceCents: service.unitPriceCents, lineTotalCents };
  });
  const settings = await BillingSettings.findById("billing").lean();
  const totals = calculateInvoice(items, settings?.taxBasisPoints || 0);
  const dueDate = new Date(Date.now() + (settings?.defaultDueDays ?? 30) * 86400000);
  const invoice = await Invoice.create({
    patientId: patient.patientId, patientName: toPatient(patient).patientName,
    dueDate, items, ...totals, balanceCents: totals.totalCents, notes: input.notes || "",
    createdBy: req.session.user.id
  });
  await audit(req, "invoice.draft_created", "Invoice", invoice.id, { totalCents: invoice.totalCents });
  res.status(201).json(invoice);
});

// Department choices are the other subsystems registered in the MediLink portal.
router.get("/departments", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await listDepartments() });
});

// Patients come from the shared registry owned by Patient Registration.
router.get("/patients", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await listPatients(req.query.search) });
});

// Records the chosen department holds for the chosen patient (lab requests, admissions, ...).
router.get("/source-records", allowRoles(ROLES.readBilling), async (req, res) => {
  const departmentId = Number(req.query.department);
  const patient = await findPatient(typeof req.query.patientId === "string" ? req.query.patientId : "");
  if (!Number.isInteger(departmentId) || !patient) return res.status(400).json({ error: "Choose a department and a registered patient." });
  const records = await listSourceRecords(departmentId, patient);
  const references = records.map((record) => record.reference).filter(Boolean);
  const billed = references.length
    ? new Set(await Invoice.distinct("sourceReference", { sourceReference: { $in: references }, status: { $ne: "cancelled" } }))
    : new Set();
  res.json({ items: records.map((record) => ({ ...record, billed: billed.has(record.reference) })) });
});

// A department bill is issued immediately so it appears in Payments right away.
router.post("/bills", allowRoles(ROLES.billing), async (req, res) => {
  const input = billInput.parse(req.body);
  if (!isValidCents(input.amountCents)) return res.status(400).json({ error: "Bill amount must be greater than zero." });
  const [department, patient] = await Promise.all([findDepartment(input.department), findPatient(input.patientId)]);
  if (!department) return res.status(400).json({ error: "Choose a department from the list." });
  if (!patient) return res.status(400).json({ error: "Patient was not found in the MediLink patient registry." });
  const items = [{
    serviceId: null, serviceCode: `SUB-${department.id}`, description: input.description || `${department.name} charges`,
    category: department.name, quantity: 1, unitPriceCents: input.amountCents, lineTotalCents: input.amountCents
  }];
  const settings = await BillingSettings.findById("billing").lean();
  const totals = calculateInvoice(items, settings?.taxBasisPoints || 0);
  const now = new Date();
  const invoice = await Invoice.create({
    invoiceNumber: await nextNumber("invoice", "INV"),
    patientId: patient.patientId, patientName: toPatient(patient).patientName, department: department.name,
    sourceReference: input.sourceReference || "",
    dueDate: new Date(now.getTime() + (settings?.defaultDueDays ?? 30) * 86400000), issuedAt: now, status: "issued",
    items, ...totals, balanceCents: totals.totalCents, notes: input.description || "",
    createdBy: req.session.user.id
  });
  await audit(req, "bill.created", "Bill", invoice.invoiceNumber, { department: department.name, patient: invoice.patientId, totalCents: invoice.totalCents });
  res.status(201).json(invoice);
});

router.post("/invoices/:id/issue",allowRoles(ROLES.billing), async (req, res) => {
  const session = await mongoose.startSession();
  let invoice;
  try {
    await session.withTransaction(async () => {
      invoice = await Invoice.findOne({ _id: req.params.id, status: "draft" }).session(session);
      if (!invoice) throw Object.assign(new Error("Draft invoice not found."), { status: 404 });
      invoice.invoiceNumber = await nextNumber("invoice", "INV", session);
      invoice.status = "issued";
      invoice.issuedAt = new Date();
      await invoice.save({ session });
      await AuditLog.create([auditEntry(req.session.user, "invoice.issued", { recordType: "Invoice", recordId: invoice.invoiceNumber, ip: req.ip })], { session });
    });
  } finally {
    await session.endSession();
  }
  res.json(invoice);
});

router.post("/invoices/:id/cancel", allowRoles(ROLES.admin), async (req, res) => {
  const reason = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body).reason;
  const invoice = await Invoice.findOne({ _id: req.params.id, paidCents: 0, status: { $in: ["draft", "issued", "overdue"] } });
  if (!invoice) return res.status(409).json({ error: "Invoice cannot be cancelled because it is missing, paid, or has recorded payments." });
  invoice.status = "cancelled";
  invoice.cancelledAt = new Date();
  invoice.cancellationReason = reason;
  await invoice.save();
  await audit(req, "invoice.cancelled", "Invoice", invoice.id, { reason });
  res.json(invoice);
});

router.get("/payments", allowRoles(ROLES.readBilling), async (req, res) => {
  const { page, limit, skip } = paginated(req.query);
  const items = await Payment.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
  const total = await Payment.countDocuments();
  res.json({ items, page, limit, total });
});

router.post("/payments", allowRoles(ROLES.cashier), async (req, res) => {
  const input = z.object({
    invoiceId: z.string().min(1),
    amountCents: z.number().int().positive().safe(),
    method: z.enum(["cash", "bank_transfer", "card_terminal", "e_wallet", "insurance", "other"]),
    transactionReference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional()
  }).parse(req.body);
  if (!isValidCents(input.amountCents)) return res.status(400).json({ error: "Payment amount must be a positive whole number of centavos." });

  const idempotencyKey = String(req.get("Idempotency-Key") || "");
  if (!/^[\w-]{16,128}$/.test(idempotencyKey)) return res.status(400).json({ error: "A valid Idempotency-Key header is required." });
  const existing = await Payment.findOne({ idempotencyKey });
  if (existing) return res.status(200).json({ payment: existing, duplicate: true });

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const invoice = await Invoice.findOne({ _id: input.invoiceId, status: { $in: ["issued", "partially_paid", "overdue"] }, balanceCents: { $gte: input.amountCents } }).session(session);
      if (!invoice) throw Object.assign(new Error("Invoice is unavailable or the payment exceeds its remaining balance."), { status: 409 });
      const paymentReference = await nextNumber("payment", "PAY", session);
      const receiptNumber = await nextNumber("receipt", "RCP", session);
      const [payment] = await Payment.create([{
        paymentReference, idempotencyKey, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber,
        patientId: invoice.patientId, patientName: invoice.patientName, department: invoice.department || "",
        amountCents: input.amountCents,
        method: input.method, transactionReference: input.transactionReference || "", notes: input.notes || "",
        recordedBy: req.session.user.id
      }], { session });
      invoice.paidCents += input.amountCents;
      invoice.balanceCents -= input.amountCents;
      invoice.status = paymentStatus(invoice.totalCents, invoice.paidCents, invoice.dueDate);
      await invoice.save({ session });
      const settings = await BillingSettings.findById("billing").session(session).lean();
      const [receipt] = await Receipt.create([{
        receiptNumber, paymentId: payment._id, hospitalName: settings?.hospitalName || process.env.HOSPITAL_NAME || "MediLink Hospital",
        hospitalAddress: settings?.hospitalAddress || process.env.HOSPITAL_ADDRESS || "",
        hospitalContact: settings?.hospitalContact || process.env.HOSPITAL_CONTACT || "",
        invoiceNumber: invoice.invoiceNumber, patientId: invoice.patientId, patientName: invoice.patientName,
        department: invoice.department || "", amountCents: payment.amountCents, method: payment.method, transactionReference: payment.transactionReference,
        balanceAfterCents: invoice.balanceCents, issuedBy: req.session.user.id
      }], { session });
      await AuditLog.create([auditEntry(req.session.user, "payment.recorded", {
        recordType: "Payment", recordId: paymentReference,
        details: { amountCents: input.amountCents, bill: invoice.invoiceNumber, receipt: receiptNumber, patient: invoice.patientId }, ip: req.ip
      })], { session });
      result = { payment, receipt };
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json(result);
});

router.get("/receipts", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await Receipt.find().sort({ createdAt: -1 }).limit(100).lean() });
});

router.get("/receipts/:id", allowRoles(ROLES.readBilling), async (req, res) => {
  const receipt = await Receipt.findById(req.params.id).lean();
  if (!receipt) return res.status(404).json({ error: "Receipt not found." });
  res.json(receipt);
});

router.get("/outstanding", allowRoles(ROLES.readBilling), async (req, res) => {
  const invoices = await Invoice.find({ status: { $in: ["issued", "partially_paid", "overdue"] }, balanceCents: { $gt: 0 } }).sort({ dueDate: 1 }).limit(500).lean();
  const now = new Date();
  res.json({ items: invoices.map((invoice) => ({ ...invoice, aging: agingBucket(invoice.dueDate, now), daysOverdue: Math.max(0, Math.floor((now - new Date(invoice.dueDate)) / 86400000)) })) });
});

router.get("/insurance/providers", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await InsuranceProvider.find().sort({ name: 1 }).lean() });
});

router.post("/insurance/providers", allowRoles(ROLES.admin), async (req, res) => {
  const input = z.object({ code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160), contact: z.string().trim().max(160).optional() }).parse(req.body);
  await ensureIndexes(InsuranceProvider);
  const provider = await InsuranceProvider.create(input);
  await audit(req, "insurance.provider_created", "InsuranceProvider", provider.id);
  res.status(201).json(provider);
});

router.get("/insurance/claims", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await InsuranceClaim.find().populate("providerId", "name code").sort({ createdAt: -1 }).limit(200).lean() });
});

router.post("/insurance/claims", allowRoles(ROLES.billing), async (req, res) => {
  const input = z.object({ providerId: z.string().min(1), invoiceId: z.string().min(1), claimCents: z.number().int().positive().safe(), claimReference: z.string().trim().max(120).optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
  const [provider, invoice] = await Promise.all([InsuranceProvider.findById(input.providerId), Invoice.findById(input.invoiceId)]);
  if (!provider || !invoice || input.claimCents > invoice.balanceCents) return res.status(400).json({ error: "Provider, invoice, or claim amount is invalid." });
  const claim = await InsuranceClaim.create({ ...input, createdBy: req.session.user.id });
  await audit(req, "insurance.claim_created", "InsuranceClaim", claim.id);
  res.status(201).json(claim);
});

router.patch("/insurance/claims/:id", allowRoles(ROLES.billing), async (req, res) => {
  const input = z.object({ status: z.enum(["submitted", "under_review", "approved", "partially_approved", "rejected", "settled"]), approvedCents: z.number().int().nonnegative().safe().optional(), rejectedCents: z.number().int().nonnegative().safe().optional(), notes: z.string().trim().max(1000).optional() }).parse(req.body);
  const claim = await InsuranceClaim.findById(req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  if ((input.approvedCents ?? claim.approvedCents) + (input.rejectedCents ?? claim.rejectedCents) > claim.claimCents) return res.status(400).json({ error: "Decision amounts cannot exceed the claim amount." });
  Object.assign(claim, input);
  await claim.save();
  await audit(req, "insurance.claim_updated", "InsuranceClaim", claim.id, input);
  res.json(claim);
});

router.post("/refunds", allowRoles(ROLES.admin), async (req, res) => {
  const input = z.object({ paymentId: z.string().min(1), amountCents: z.number().int().positive().safe(), reason: z.string().trim().min(5).max(500) }).parse(req.body);
  const payment = await Payment.findById(input.paymentId);
  if (!payment || input.amountCents > payment.amountCents) return res.status(400).json({ error: "Refund amount exceeds the original payment." });
  const already = await Refund.aggregate([{ $match: { paymentId: payment._id, status: { $in: ["pending", "approved"] } } }, { $group: { _id: null, cents: { $sum: "$amountCents" } } }]);
  if ((already[0]?.cents || 0) + input.amountCents > payment.amountCents) return res.status(409).json({ error: "Refund amount exceeds the unrefunded payment amount." });
  await ensureIndexes(Refund);
  const refund = await Refund.create({ refundNumber: await nextNumber("refund", "REF"), paymentId: payment._id, invoiceId: payment.invoiceId, amountCents: input.amountCents, reason: input.reason, requestedBy: req.session.user.id });
  await audit(req, "refund.requested", "Refund", refund.id, { amountCents: refund.amountCents });
  res.status(201).json(refund);
});

router.get("/refunds", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json({ items: await Refund.find().sort({ createdAt: -1 }).limit(200).lean() });
});

router.post("/refunds/:id/approve", allowRoles(ROLES.admin), async (req, res) => {
  const session = await mongoose.startSession();
  let refund;
  try {
    await session.withTransaction(async () => {
      refund = await Refund.findOne({ _id: req.params.id, status: "pending" }).session(session);
      if (!refund) throw Object.assign(new Error("Pending refund not found."), { status: 404 });
      const invoice = await Invoice.findById(refund.invoiceId).session(session);
      if (!invoice || invoice.paidCents < refund.amountCents) throw Object.assign(new Error("Invoice balance cannot accommodate this refund."), { status: 409 });
      invoice.paidCents -= refund.amountCents;
      invoice.balanceCents += refund.amountCents;
      invoice.status = paymentStatus(invoice.totalCents, invoice.paidCents, invoice.dueDate);
      await invoice.save({ session });
      refund.status = "approved";
      refund.approvedBy = req.session.user.id;
      refund.approvedAt = new Date();
      await refund.save({ session });
      await AuditLog.create([auditEntry(req.session.user, "refund.approved", { recordType: "Refund", recordId: refund.refundNumber, details: { amountCents: refund.amountCents }, ip: req.ip })], { session });
    });
  } finally {
    await session.endSession();
  }
  res.json(refund);
});

router.get("/reports/summary", allowRoles(ROLES.readBilling), async (req, res) => {
  const since = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const until = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since > until) return res.status(400).json({ error: "Valid report date range required." });
  const [payments, invoices, refunds, methods] = await Promise.all([
    Payment.aggregate([{ $match: { createdAt: { $gte: since, $lte: until } } }, { $group: { _id: null, totalCents: { $sum: "$amountCents" }, count: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { createdAt: { $gte: since, $lte: until }, status: { $ne: "cancelled" } } }, { $group: { _id: "$status", count: { $sum: 1 }, totalCents: { $sum: "$totalCents" } } }]),
    Refund.aggregate([{ $match: { approvedAt: { $gte: since, $lte: until }, status: "approved" } }, { $group: { _id: null, totalCents: { $sum: "$amountCents" } } }]),
    Payment.aggregate([{ $match: { createdAt: { $gte: since, $lte: until } } }, { $group: { _id: "$method", totalCents: { $sum: "$amountCents" }, count: { $sum: 1 } } }])
  ]);
  res.json({ from: since, to: until, collectedCents: payments[0]?.totalCents || 0, paymentCount: payments[0]?.count || 0, refundedCents: refunds[0]?.totalCents || 0, invoices, paymentMethods: methods });
});

router.get("/reports/payments.csv", allowRoles(ROLES.readBilling), async (req, res) => {
  const payments = await Payment.find().sort({ createdAt: -1 }).limit(5000).lean();
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["paymentReference", "receipt", "invoiceNumber", "patientId", "patientName", "amountCents", "method", "createdAt"].join(",")];
  const receipts = await Receipt.find({ paymentId: { $in: payments.map((payment) => payment._id) } }).select("paymentId receiptNumber").lean();
  const receiptMap = new Map(receipts.map((receipt) => [String(receipt.paymentId), receipt.receiptNumber]));
  for (const payment of payments) rows.push([payment.paymentReference, receiptMap.get(String(payment._id)), payment.invoiceNumber, payment.patientId, payment.patientName, payment.amountCents, payment.method, payment.createdAt].map(quote).join(","));
  res.type("text/csv").attachment("billing-payments.csv").send(rows.join("\r\n"));
});

router.get("/audit-logs", allowRoles(ROLES.adminOrAuditor), async (req, res) => {
  // The shared collection holds every subsystem's activity; older rows use slightly different field names.
  const filter = req.query.module === "billing" ? { module: "Billing" } : {};
  const rows = await AuditLog.collection.find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  res.json({ items: rows.map((row) => ({
    _id: row._id, createdAt: row.createdAt, userName: row.userName || row.username || "Unknown user", role: row.role || "—",
    action: row.action || "", module: row.module || "", details: String(row.details ?? row.Details ?? ""), ip: String(row.ip ?? row.IP ?? "")
  })) });
});

router.get("/settings", allowRoles(ROLES.readBilling), async (req, res) => {
  res.json(await BillingSettings.findById("billing").lean() || { _id: "billing", hospitalName: process.env.HOSPITAL_NAME || "MediLink Hospital", hospitalAddress: process.env.HOSPITAL_ADDRESS || "", hospitalContact: process.env.HOSPITAL_CONTACT || "", currency: "PHP", defaultDueDays: 30, taxBasisPoints: 0 });
});

router.put("/settings", allowRoles(ROLES.admin), async (req, res) => {
  const input = z.object({ hospitalName: z.string().trim().min(1).max(160), hospitalAddress: z.string().trim().max(500), hospitalContact: z.string().trim().max(160), currency: z.string().trim().length(3), defaultDueDays: z.number().int().min(0).max(365), taxBasisPoints: z.number().int().min(0).max(10000) }).parse(req.body);
  const settings = await BillingSettings.findByIdAndUpdate("billing", { _id: "billing", ...input }, { new: true, upsert: true, runValidators: true });
  await audit(req, "settings.updated", "BillingSettings", "billing");
  res.json(settings);
});

module.exports = router;
