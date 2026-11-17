const mongoose = require("mongoose");

const { Schema } = mongoose;
const options = { timestamps: true, versionKey: false };

// Staff accounts live in the shared MediLink `users` collection, which every subsystem uses.
// Billing declares only the fields it reads or writes and never builds indexes on it.
const userSchema = new Schema({
  employeeId: { type: String, trim: true },
  firstName: { type: String, trim: true, default: "" },
  lastName: { type: String, trim: true, default: "" },
  username: { type: String, trim: true, lowercase: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, required: true },
  subsystems: { type: [String], default: undefined },
  status: { type: String, default: "Active" }
}, { timestamps: true, autoIndex: false });

const serviceSchema = new Schema({
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: "" },
  category: { type: String, required: true, trim: true },
  unitPriceCents: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  active: { type: Boolean, default: true }
}, options);

const invoiceSchema = new Schema({
  invoiceNumber: { type: String, unique: true, sparse: true, index: true },
  patientId: { type: String, required: true, index: true },
  patientName: { type: String, required: true },
  department: { type: String, trim: true, default: "", index: true },
  sourceReference: { type: String, trim: true, default: "" },
  dueDate: { type: Date, required: true, index: true },
  issuedAt: { type: Date, default: null },
  status: { type: String, enum: ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"], default: "draft", index: true },
  items: [{
    serviceId: { type: Schema.Types.ObjectId, ref: "BillingService", default: null },
    serviceCode: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceCents: { type: Number, required: true, min: 0 },
    lineTotalCents: { type: Number, required: true, min: 0 }
  }],
  subtotalCents: { type: Number, required: true, min: 0 },
  discountCents: { type: Number, default: 0, min: 0 },
  taxCents: { type: Number, default: 0, min: 0 },
  totalCents: { type: Number, required: true, min: 0 },
  paidCents: { type: Number, default: 0, min: 0 },
  balanceCents: { type: Number, required: true, min: 0 },
  notes: { type: String, trim: true, default: "" },
  createdBy: { type: Schema.Types.ObjectId, ref: "BillingUser", required: true },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, default: "" }
}, options);

const paymentSchema = new Schema({
  paymentReference: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
  invoiceNumber: { type: String, required: true, index: true },
  patientId: { type: String, required: true, index: true },
  patientName: { type: String, required: true },
  department: { type: String, default: "" },
  amountCents: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ["cash", "bank_transfer", "card_terminal", "e_wallet", "insurance", "other"], required: true },
  transactionReference: { type: String, trim: true, default: "" },
  notes: { type: String, trim: true, default: "" },
  recordedBy: { type: Schema.Types.ObjectId, ref: "BillingUser", required: true },
  status: { type: String, enum: ["succeeded"], default: "succeeded" }
}, options);

const receiptSchema = new Schema({
  receiptNumber: { type: String, required: true, unique: true },
  paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, unique: true },
  hospitalName: { type: String, required: true },
  hospitalAddress: { type: String, default: "" },
  hospitalContact: { type: String, default: "" },
  invoiceNumber: { type: String, required: true },
  patientId: { type: String, required: true },
  patientName: { type: String, required: true },
  department: { type: String, default: "" },
  amountCents: { type: Number, required: true },
  method: { type: String, required: true },
  transactionReference: { type: String, default: "" },
  balanceAfterCents: { type: Number, required: true },
  issuedBy: { type: Schema.Types.ObjectId, ref: "BillingUser", required: true }
}, options);

const providerSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  contact: { type: String, default: "" },
  active: { type: Boolean, default: true }
}, options);

const claimSchema = new Schema({
  providerId: { type: Schema.Types.ObjectId, ref: "InsuranceProvider", required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
  claimReference: { type: String, trim: true, default: "" },
  claimCents: { type: Number, required: true, min: 1 },
  approvedCents: { type: Number, default: 0, min: 0 },
  rejectedCents: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["draft", "submitted", "under_review", "approved", "partially_approved", "rejected", "settled"], default: "draft" },
  notes: { type: String, default: "" },
  createdBy: { type: Schema.Types.ObjectId, ref: "BillingUser", required: true }
}, options);

const refundSchema = new Schema({
  refundNumber: { type: String, required: true, unique: true },
  paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
  amountCents: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  requestedBy: { type: Schema.Types.ObjectId, ref: "BillingUser", required: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: "BillingUser", default: null },
  approvedAt: { type: Date, default: null }
}, options);

// Activity goes to the shared MediLink `auditlogs` collection, in the shape the other
// subsystems already use. Build entries with auditEntry() from utils/access.
const auditSchema = new Schema({
  user: { type: Schema.Types.ObjectId, default: null },
  userName: { type: String, default: "Unknown user" },
  role: { type: String, default: "—" },
  action: { type: String, required: true },
  module: { type: String, default: "Billing" },
  details: { type: String, default: "" },
  ip: { type: String, default: "" }
}, { timestamps: true, autoIndex: false });

const settingsSchema = new Schema({
  _id: { type: String, default: "billing" },
  hospitalName: { type: String, default: "MediLink Hospital" },
  hospitalAddress: { type: String, default: "" },
  hospitalContact: { type: String, default: "" },
  currency: { type: String, default: "PHP" },
  defaultDueDays: { type: Number, default: 30, min: 0, max: 365 },
  taxBasisPoints: { type: Number, default: 0, min: 0, max: 10000 }
}, { ...options, _id: false });

const counterSchema = new Schema({ _id: { type: String }, value: { type: Number, default: 0 } }, { versionKey: false });

function model(name, schema) {
  const collections = {
    BillingUser: 'users', // Keep shared
    BillingService: 'billing_v2_services',
    Invoice: 'billing_v2_invoices',
    Payment: 'billing_v2_payments',
    Receipt: 'billing_v2_receipts',
    InsuranceProvider: 'billing_v2_providers',
    InsuranceClaim: 'billing_v2_claims',
    Refund: 'billing_v2_refunds',
    AuditLog: 'auditlogs', // Keep shared
    BillingSettings: 'billing_v2_settings',
    Counter: 'billing_v2_counters'
  };
  const collName = collections[name] || `billing_v2_${name.toLowerCase()}`;
  return mongoose.models[name] || mongoose.model(name, schema, collName);
}

// Collections are only created in the shared database when they are first needed.
// Indexes (which also create the collection) are built on demand through these helpers.
const indexed = new Map();
function ensureIndexes(Model) {
  if (!indexed.has(Model.modelName)) {
    indexed.set(Model.modelName, Model.createIndexes().catch((error) => {
      indexed.delete(Model.modelName);
      throw error;
    }));
  }
  return indexed.get(Model.modelName);
}

// The billing-owned collections every billing and payment flow depends on.
// The shared `users` and `auditlogs` collections are left exactly as they are.
function ensureCoreIndexes() {
  return Promise.all(["Invoice", "Payment", "Receipt"].map((name) => ensureIndexes(mongoose.model(name))));
}

module.exports = {
  ensureIndexes,
  ensureCoreIndexes,
  BillingUser: model("BillingUser", userSchema),
  BillingService: model("BillingService", serviceSchema),
  Invoice: model("Invoice", invoiceSchema),
  Payment: model("Payment", paymentSchema),
  Receipt: model("Receipt", receiptSchema),
  InsuranceProvider: model("InsuranceProvider", providerSchema),
  InsuranceClaim: model("InsuranceClaim", claimSchema),
  Refund: model("Refund", refundSchema),
  AuditLog: model("AuditLog", auditSchema),
  BillingSettings: model("BillingSettings", settingsSchema),
  Counter: model("Counter", counterSchema)
};
