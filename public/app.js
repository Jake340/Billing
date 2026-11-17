const API = "/api/v1";
const $ = (selector, root = document) => root.querySelector(selector);
const content = $("#content");
let currentUser = null;
let currentPage = "billing";
let landed = false;
let payTargetId = null;
let pendingBills = new Map();
let sourceRecords = [];
const METHOD_LABELS = { cash: "Cash", bank_transfer: "Bank transfer", card_terminal: "Card terminal", e_wallet: "E-wallet", insurance: "Insurance", other: "Other" };
const PAGE_TITLES = { cashier: "Cashier dashboard", billing: "Billing", payments: "Payment", history: "Patient history", dashboard: "Overview" };
const canBill = () => ["billing_admin", "billing_officer"].includes(currentUser.role);
const canPay = () => ["billing_admin", "cashier"].includes(currentUser.role);
const dateTime = (value) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
const centsToInput = (cents) => (cents / 100).toFixed(2);

function money(cents) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format((cents || 0) / 100);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
async function api(path, options = {}) {
  const { headers = {}, ...fetchOptions } = options;
  const response = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    ...fetchOptions,
    headers: { "Content-Type": "application/json", ...headers }
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2800);
}
function setPage(page) {
  currentPage = page;
  $("#navigation").querySelectorAll("[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  $("#breadcrumb").textContent = PAGE_TITLES[page] || page[0].toUpperCase() + page.slice(1).replace("-", " ");
  $("#navigation").classList.remove("open");
  renderPage().catch(showError);
}
function pageHead(title, description, button = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
}
function table(headers, rows, empty = "No records found.") {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td class="empty" colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
}
function status(value) {
  return `<span class="status ${esc(value)}">${esc(String(value || "").replaceAll("_", " "))}</span>`;
}
function formPanel(title, fields, submitText, action) {
  return `<section class="panel"><h2>${title}</h2><form class="form-grid" data-action="${action}">${fields}<div class="wide form-actions"><button class="button primary" type="submit">${submitText}</button></div></form></section>`;
}
function input(name, label, type = "text", required = true, extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" ${required ? "required" : ""} ${extra}></label>`;
}
function showError(error) {
  content.innerHTML = `${pageHead("Unable to load data", "The server request failed.")}<section class="panel error">${esc(error.message)}</section>`;
}

async function renderPage() {
  content.innerHTML = `<section class="panel">Loading…</section>`;
  if (currentPage === "cashier") return renderCashier();
  if (currentPage === "billing") return renderBilling();
  if (currentPage === "history") return renderHistory();
  if (currentPage === "dashboard") return renderDashboard();
  if (currentPage === "services") return renderServices();
  if (currentPage === "invoices") return renderInvoices();
  if (currentPage === "payments") return renderPayments();
  if (currentPage === "outstanding") return renderOutstanding();
  if (currentPage === "insurance") return renderInsurance();
  if (currentPage === "refunds") return renderRefunds();
  if (currentPage === "reports") return renderReports();
  if (currentPage === "audit") return renderAudit();
  if (currentPage === "settings") return renderSettings();
}

async function renderCashier() {
  const data = await api("/cashier/dashboard");
  const cards = [
    ["My collections today", money(data.totals.collectedTodayCents)],
    ["Receipts I released today", data.totals.receiptsToday],
    ["Bills waiting for payment", data.totals.waitingBills],
    ["Amount waiting", money(data.totals.waitingCents)]
  ];
  const waitingRows = data.waitingBills.map((item) => `<tr><td>${esc(item.invoiceNumber)}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td>${esc(item.patientName)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${esc(dateTime(item.createdAt))}</td><td><button class="button primary" data-goto-pay="${esc(item._id)}">Pay</button></td></tr>`).join("");
  const methodRows = data.methodsToday.map((item) => `<tr><td>${esc(METHOD_LABELS[item.method] || item.method)}</td><td>${item.count}</td><td>${money(item.cents)}</td></tr>`).join("");
  const paymentRows = data.recentPayments.map((item) => `<tr><td>${esc(item.receiptNumber || "—")}</td><td>${esc(item.invoiceNumber)}</td><td>${esc(item.patientName)}</td><td>${money(item.amountCents)}</td><td>${esc(METHOD_LABELS[item.method] || item.method)}</td><td>${esc(dateTime(item.createdAt))}</td><td>${item.receiptId ? `<button class="button" data-receipt="${esc(item.receiptId)}">Receipt</button>` : ""}</td></tr>`).join("");
  content.innerHTML = `${pageHead(`Hello, ${esc(currentUser.name || currentUser.username)}`, "Your collections today and the bills waiting at the counter.", `<button class="button primary" data-open-page="payments">Go to Payment</button>`)}<div class="cards">${cards.map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("")}</div><div id="receipt-slot"></div><section class="panel"><h2>Next bills to collect</h2>${table(["Bill no.", "Department", "Patient", "Balance", "Status", "Billed", "Action"], waitingRows, "No bills are waiting for payment.")}${data.totals.waitingBills > data.waitingBills.length ? `<p class="muted">Showing the ${data.waitingBills.length} oldest of ${data.totals.waitingBills} waiting bills. Open the Payment tab for the full list.</p>` : ""}</section><section class="panel"><h2>My collections today, by payment method</h2>${table(["Method", "Payments", "Collected"], methodRows, "You have not processed a payment today.")}</section><section class="panel"><h2>My recent payments</h2>${table(["Receipt", "Bill no.", "Patient", "Amount", "Method", "Date", ""], paymentRows, "You have not processed a payment yet.")}</section>`;
}

async function renderHistory(search = "") {
  const data = await api(`/patient-history?search=${encodeURIComponent(search)}`);
  const rows = data.items.map((item) => `<tr><td>${esc(item.patientName)}</td><td>${esc(item.patientId)}</td><td>${item.billsPaid} of ${item.bills}</td><td>${money(item.paidCents)}</td><td>${money(item.balanceCents)}</td><td>${item.balanceCents > 0 ? status("partially_paid") : status("paid")}</td><td>${item.lastPaymentAt ? esc(dateTime(item.lastPaymentAt)) : "—"}</td><td><button class="button" data-history="${esc(item.patientId)}">View history</button></td></tr>`).join("");
  content.innerHTML = `${pageHead("Patient history", "Every patient who has paid, with what they paid and what they still owe.")}<form class="toolbar" data-search="history"><input name="search" placeholder="Search patient name or ID…" value="${esc(search)}"><button class="button" type="submit">Search</button>${search ? `<button class="button subtle" type="button" data-open-page="history">Clear</button>` : ""}</form>${table(["Patient", "Patient ID", "Bills fully paid", "Total paid", "Still owed", "Status", "Last payment", ""], rows, search ? "No paying patient matches that search." : "No patient has paid yet. Patients appear here after their first payment.")}`;
}

async function renderPatientHistory(patientId) {
  content.innerHTML = `<section class="panel">Loading…</section>`;
  const data = await api(`/patient-history/${encodeURIComponent(patientId)}`);
  const cards = [["Total billed", money(data.totals.billedCents)], ["Total paid", money(data.totals.paidCents)], ["Still owed", money(data.totals.balanceCents)], ["Payments made", data.payments.length]];
  const billRows = data.bills.map((item) => `<tr><td>${esc(item.invoiceNumber)}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td class="clip" title="${esc(item.items?.[0]?.description)}">${esc(item.items?.[0]?.description || "—")}</td><td>${money(item.totalCents)}</td><td>${money(item.paidCents)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${esc(dateTime(item.createdAt))}</td></tr>`).join("");
  const paymentRows = data.payments.map((item) => `<tr><td>${esc(item.receiptNumber || "—")}</td><td>${esc(item.invoiceNumber)}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td>${money(item.amountCents)}</td><td>${esc(METHOD_LABELS[item.method] || item.method)}</td><td>${esc(dateTime(item.createdAt))}</td><td>${item.receiptId ? `<button class="button" data-receipt="${esc(item.receiptId)}">Receipt</button>` : ""}</td></tr>`).join("");
  content.innerHTML = `${pageHead(esc(data.patientName), `Patient ID ${esc(data.patientId)} · billing and payment history`, `<button class="button" data-open-page="history">← All patients</button>`)}<div class="cards">${cards.map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("")}</div><div id="receipt-slot"></div><section class="panel"><h2>Payments</h2>${table(["Receipt", "Bill no.", "Department", "Amount", "Method", "Date", ""], paymentRows, "No payments recorded.")}</section><section class="panel"><h2>Bills</h2>${table(["Bill no.", "Department", "For", "Amount", "Paid", "Balance", "Status", "Billed"], billRows, "No bills.")}</section>`;
}

async function renderDashboard() {
  const data = await api("/dashboard");
  const values = [
    ["Revenue today", money(data.totals.revenueTodayCents)],
    ["Revenue this month", money(data.totals.revenueMonthCents)],
    ["Outstanding balance", money(data.totals.outstandingCents)],
    ["Paid invoices", data.totals.paidInvoices],
    ["Unpaid invoices", data.totals.unpaidInvoices],
    ["Partially paid", data.totals.partiallyPaidInvoices],
    ["Overdue invoices", data.totals.overdueInvoices]
  ];
  const paymentRows = data.recentPayments.map((item) => `<tr><td>${esc(item.paymentReference)}</td><td>${esc(item.invoiceNumber)}</td><td>${esc(item.patientName)}</td><td>${esc(new Date(item.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" }))}</td><td>${esc(item.method)}</td><td>${money(item.amountCents)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Financial overview", "Live billing activity and current totals.")}<div class="cards">${values.map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("")}</div><section class="panel"><h2>Recent payments</h2>${table(["Payment ref", "Invoice", "Patient", "Date", "Method", "Amount"], paymentRows)}</section>`;
}

async function renderServices() {
  const data = await api(`/services?all=${currentUser.role === "billing_admin"}`);
  const rows = data.items.map((item) => `<tr><td>${esc(item.code)}</td><td>${esc(item.name)}</td><td>${esc(item.category)}</td><td>${money(item.unitPriceCents)}</td><td>${item.active ? "Active" : "Inactive"}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Service catalog", "Manageable billable services; invoice items keep their original price snapshots.")}${table(["Code", "Service", "Category", "Unit price", "Status"], rows)}${currentUser.role === "billing_admin" ? formPanel("Add a service", `${input("code", "Service code")}${input("name", "Service name")}${input("category", "Category")}${input("unitPrice", "Unit price (PHP)", "number", true, 'min="0" step="0.01"')}<label class="wide">Description<textarea name="description"></textarea></label>`, "Create service", "service") : ""}`;
}

async function renderInvoices() {
  const [data, patients, services] = await Promise.all([api("/invoices"), api("/patients"), api("/services")]);
  const rows = data.items.map((item) => `<tr><td>${esc(item.invoiceNumber || "Draft")}</td><td>${esc(item.patientName)}</td><td>${new Date(item.createdAt).toLocaleDateString("en-PH")}</td><td>${money(item.totalCents)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${item.status === "draft" && ["billing_admin", "billing_officer"].includes(currentUser.role) ? `<button class="button" data-issue="${esc(item._id)}">Issue</button>` : item.status === "issued" && currentUser.role === "billing_admin" ? `<button class="button danger" data-cancel="${esc(item._id)}">Cancel</button>` : ""}</td></tr>`).join("");
  const patientOptions = patients.items.map((item) => `<option value="${esc(item.patientId)}">${esc(item.patientName)} · ${esc(item.patientId)}</option>`).join("");
  const serviceOptions = services.items.map((item) => `<option value="${esc(item._id)}">${esc(item.code)} · ${esc(item.name)} (${money(item.unitPriceCents)})</option>`).join("");
  const creator = ["billing_admin", "billing_officer"].includes(currentUser.role) ? formPanel("Create draft invoice", `<label class="wide">Patient<select name="patientId" required>${patientOptions}</select></label><label class="wide">Service<select name="serviceId" required>${serviceOptions}</select></label>${input("quantity", "Quantity", "number", true, 'min="1" value="1"')}<label class="wide">Notes<textarea name="notes"></textarea></label>`, "Save draft", "invoice") : "";
  content.innerHTML = `${pageHead("Invoices", "Draft, issue, and track patient invoices.")}${table(["Invoice", "Patient", "Created", "Total", "Balance", "Status", "Actions"], rows)}${creator}`;
}

async function renderBilling() {
  const [departments, patients, data] = await Promise.all([api("/departments"), api("/patients"), api("/invoices?limit=50")]);
  sourceRecords = [];
  const departmentOptions = departments.items.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("");
  const patientOptions = patients.items.map((item) => `<option value="${esc(item.patientId)}">${esc(item.patientName)} · ${esc(item.patientId)}</option>`).join("");
  const rows = data.items.map((item) => {
    const open = ["issued", "partially_paid", "overdue"].includes(item.status) && item.balanceCents > 0;
    const actions = `${open && canPay() ? `<button class="button primary" data-goto-pay="${esc(item._id)}">Pay</button>` : ""}${["issued", "overdue"].includes(item.status) && item.paidCents === 0 && currentUser.role === "billing_admin" ? ` <button class="button danger" data-cancel="${esc(item._id)}">Cancel</button>` : ""}`;
    return `<tr><td>${esc(item.invoiceNumber || "Draft")}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td>${esc(item.patientName)}</td><td>${esc(item.sourceReference || "—")}</td><td>${money(item.totalCents)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${esc(dateTime(item.createdAt))}</td><td>${actions}</td></tr>`;
  }).join("");
  const form = canBill() ? formPanel("New bill", `<label>Department<select name="department" required><option value="" disabled selected>Choose a department…</option>${departmentOptions}</select></label><label>Patient<select name="patientId" required><option value="" disabled selected>Choose a patient…</option>${patientOptions}</select></label><label class="wide">Record from the department (optional)<select name="sourceIndex" disabled><option value="">Choose a department and a patient first</option></select></label>${input("amount", "Bill amount (PHP)", "number", true, 'min="0.01" step="0.01" placeholder="0.00"')}<label>Description (optional)<input name="description" maxlength="300" placeholder="e.g. CBC and urinalysis"></label>`, "Create bill & send to Payment", "bill") : `<section class="panel muted">Your role can view bills but cannot create them.</section>`;
  content.innerHTML = `${pageHead("Billing", "Choose the department and patient, then enter the bill amount. Every bill goes straight to the Payment tab.")}${form}<section class="panel"><h2>Recent bills</h2>${table(["Bill no.", "Department", "Patient", "Source record", "Amount", "Balance", "Status", "Created", "Action"], rows, "No bills yet.")}</section>`;
}

// Loads what the chosen department has on file for the chosen patient.
async function loadSourceRecords(form) {
  const select = form.elements.sourceIndex;
  const department = form.elements.department.value;
  const patientId = form.elements.patientId.value;
  sourceRecords = [];
  if (!department || !patientId) return;
  select.disabled = true;
  select.innerHTML = `<option value="">Loading records…</option>`;
  try {
    const data = await api(`/source-records?department=${encodeURIComponent(department)}&patientId=${encodeURIComponent(patientId)}`);
    // Ignore the answer if the choice changed while it was loading.
    if (form.elements.department.value !== department || form.elements.patientId.value !== patientId) return;
    sourceRecords = data.items;
    select.innerHTML = sourceRecords.length
      ? `<option value="">No record — enter the bill manually</option>${sourceRecords.map((item, index) => `<option value="${index}">${esc(item.label)}${item.status ? ` (${esc(item.status)})` : ""}${item.amountCents ? ` · ${money(item.amountCents)}` : ""}${item.billed ? " · already billed" : ""}</option>`).join("")}`
      : `<option value="">This department has no records for this patient</option>`;
    select.disabled = !sourceRecords.length;
  } catch (error) {
    select.innerHTML = `<option value="">Records could not be loaded</option>`;
    toast(error.message);
  }
}

function receiptHtml(receipt) {
  const patient = receipt.patientId && receipt.patientId !== "N/A" ? `${receipt.patientName} (${receipt.patientId})` : receipt.patientName;
  const fields = [
    ["Receipt no.", receipt.receiptNumber], ["Date", dateTime(receipt.createdAt)], ["Patient", patient],
    ["Department", receipt.department || "—"], ["Bill no.", receipt.invoiceNumber],
    ["Payment method", METHOD_LABELS[receipt.method] || receipt.method], ["Reference", receipt.transactionReference || "—"],
    ["Balance remaining", money(receipt.balanceAfterCents)]
  ];
  return `<section class="receipt" id="receipt"><header><h2>${esc(receipt.hospitalName)}</h2>${receipt.hospitalAddress ? `<p>${esc(receipt.hospitalAddress)}</p>` : ""}${receipt.hospitalContact ? `<p>${esc(receipt.hospitalContact)}</p>` : ""}<h3>Official payment receipt</h3></header>${fields.map(([label, value]) => `<div class="receipt-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}<div class="receipt-row receipt-total"><span>Amount paid</span><strong>${money(receipt.amountCents)}</strong></div><div class="receipt-actions no-print"><button class="button primary" type="button" data-print-receipt>Print receipt</button><button class="button" type="button" data-close-receipt>Close</button></div></section>`;
}

async function renderPayments({ receipt = null } = {}) {
  const [pending, data, receipts] = await Promise.all([api("/outstanding"), api("/payments"), api("/receipts")]);
  pendingBills = new Map(pending.items.map((item) => [String(item._id), item]));
  const selected = pendingBills.has(payTargetId) ? payTargetId : "";
  payTargetId = null;
  const pendingRows = pending.items.map((item) => `<tr><td>${esc(item.invoiceNumber)}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td>${esc(item.patientName)}</td><td>${money(item.totalCents)}</td><td>${money(item.paidCents)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${canPay() ? `<button class="button primary" data-pay="${esc(item._id)}">Pay</button>` : ""}</td></tr>`).join("");
  const options = pending.items.map((item) => `<option value="${esc(item._id)}" ${String(item._id) === selected ? "selected" : ""}>${esc(item.invoiceNumber)} · ${esc(item.patientName)} · ${esc(item.department || "No department")} · ${money(item.balanceCents)} due</option>`).join("");
  const form = canPay() ? formPanel("Process payment", `<label class="wide">Bill<select name="invoiceId" required><option value="" disabled ${selected ? "" : "selected"}>Choose a bill to pay…</option>${options}</select></label>${input("amount", "Amount to pay (PHP)", "number", true, `min="0.01" step="0.01" placeholder="0.00" ${selected ? `value="${centsToInput(pendingBills.get(selected).balanceCents)}"` : ""}`)}<label>Payment method<select name="method">${Object.entries(METHOD_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>${input("transactionReference", "Transaction reference (optional)", "text", false, 'maxlength="120"')}<p class="wide muted">Do not enter card numbers, CVV, PIN, or passwords. Card payments must be completed through an external terminal/provider.</p>`, "Process payment & release receipt", "payment") : `<section class="panel muted">Your role can view payments but cannot process them.</section>`;
  const rows = data.items.map((item) => {
    const match = receipts.items.find((row) => String(row.paymentId) === String(item._id));
    return `<tr><td>${esc(match?.receiptNumber || "—")}</td><td>${esc(item.invoiceNumber)}</td><td class="clip" title="${esc(item.department)}">${esc(item.department || "—")}</td><td>${esc(item.patientName)}</td><td>${money(item.amountCents)}</td><td>${esc(METHOD_LABELS[item.method] || item.method)}</td><td>${esc(dateTime(item.createdAt))}</td><td>${match ? `<button class="button" data-receipt="${esc(match._id)}">Receipt</button>` : ""}</td></tr>`;
  }).join("");
  content.innerHTML = `${pageHead("Payment", "Bills from every department arrive here. Process the payment and a receipt is released.")}<div id="receipt-slot">${receipt ? receiptHtml(receipt) : ""}</div><section class="panel"><h2>Bills waiting for payment</h2>${table(["Bill no.", "Department", "Patient", "Total", "Paid", "Balance", "Status", "Action"], pendingRows, "No bills are waiting for payment.")}</section><div id="payment-form">${form}</div><section class="panel"><h2>Payment history</h2>${table(["Receipt", "Bill no.", "Department", "Patient", "Amount", "Method", "Date", ""], rows, "No payments yet.")}</section>`;
  if (receipt) $("#receipt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (selected) $("#payment-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function renderOutstanding() {
  const data = await api("/outstanding");
  const rows = data.items.map((item) => `<tr><td>${esc(item.patientName)}</td><td>${esc(item.invoiceNumber)}</td><td>${new Date(item.createdAt).toLocaleDateString("en-PH")}</td><td>${new Date(item.dueDate).toLocaleDateString("en-PH")}</td><td>${money(item.totalCents)}</td><td>${money(item.paidCents)}</td><td>${money(item.balanceCents)}</td><td>${item.daysOverdue}</td><td>${status(item.aging)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Outstanding balances", "Open invoice balances with simple aging buckets.")}${table(["Patient", "Invoice", "Invoice date", "Due date", "Original", "Paid", "Balance", "Days late", "Aging"], rows)}`;
}

async function renderInsurance() {
  const [providers, claims, invoices] = await Promise.all([api("/insurance/providers"), api("/insurance/claims"), api("/invoices")]);
  const rows = claims.items.map((item) => `<tr><td>${esc(item.claimReference || "—")}</td><td>${esc(item.providerId?.name || "Provider")}</td><td>${esc(item.invoiceId)}</td><td>${money(item.claimCents)}</td><td>${money(item.approvedCents)}</td><td>${status(item.status)}</td></tr>`).join("");
  const providerOptions = providers.items.filter((item) => item.active).map((item) => `<option value="${esc(item._id)}">${esc(item.name)}</option>`).join("");
  const invoiceOptions = invoices.items.filter((item) => item.balanceCents > 0).map((item) => `<option value="${esc(item._id)}">${esc(item.invoiceNumber || "Draft")} · ${esc(item.patientName)} · ${money(item.balanceCents)}</option>`).join("");
  const form = ["billing_admin", "billing_officer"].includes(currentUser.role) ? formPanel("Create claim", `<label>Provider<select name="providerId" required>${providerOptions}</select></label><label>Invoice<select name="invoiceId" required>${invoiceOptions}</select></label>${input("claimAmount", "Claim amount (PHP)", "number", true, 'min="0.01" step="0.01"')}${input("claimReference", "Claim reference", "text", false)}`, "Create claim", "claim") : "";
  const providerForm = currentUser.role === "billing_admin" ? formPanel("Add provider", `${input("code", "Provider code")}${input("name", "Provider name")}${input("contact", "Contact", "text", false)}`, "Add provider", "provider") : "";
  content.innerHTML = `${pageHead("Insurance & HMO claims", "Track claims separately; submission never marks an invoice paid.")}${table(["Claim ref", "Provider", "Invoice ID", "Claim", "Approved", "Status"], rows)}${form}${providerForm}`;
}

async function renderRefunds() {
  const [data, payments] = await Promise.all([api("/refunds"), api("/payments")]);
  const rows = data.items.map((item) => `<tr><td>${esc(item.refundNumber)}</td><td>${esc(item.invoiceId)}</td><td>${money(item.amountCents)}</td><td>${esc(item.reason)}</td><td>${status(item.status)}</td><td>${item.status === "pending" && currentUser.role === "billing_admin" ? `<button class="button" data-refund="${esc(item._id)}">Approve</button>` : ""}</td></tr>`).join("");
  const options = payments.items.map((item) => `<option value="${esc(item._id)}">${esc(item.paymentReference)} · ${esc(item.invoiceNumber)} · ${money(item.amountCents)}</option>`).join("");
  const form = currentUser.role === "billing_admin" ? formPanel("Request refund", `<label class="wide">Original payment<select name="paymentId" required>${options}</select></label>${input("amount", "Refund amount (PHP)", "number", true, 'min="0.01" step="0.01"')}<label class="wide">Reason<textarea name="reason" required minlength="5"></textarea></label>`, "Request refund", "refund") : "";
  content.innerHTML = `${pageHead("Refunds", "Refunds are separate records and require administrator approval.")}${table(["Refund", "Invoice", "Amount", "Reason", "Status", "Action"], rows)}${form}`;
}

async function renderReports() {
  const data = await api("/reports/summary");
  const invoiceRows = data.invoices.map((item) => `<tr><td>${status(item._id)}</td><td>${item.count}</td><td>${money(item.totalCents)}</td></tr>`).join("");
  const methodRows = data.paymentMethods.map((item) => `<tr><td>${esc(item._id)}</td><td>${item.count}</td><td>${money(item.totalCents)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Financial reports", "Summary uses recorded payments and non-cancelled invoices.", `<a class="button" href="${API}/reports/payments.csv">Export payments CSV</a>`)}<div class="cards"><div class="card"><div class="label">Collected</div><div class="value">${money(data.collectedCents)}</div></div><div class="card"><div class="label">Payments</div><div class="value">${data.paymentCount}</div></div><div class="card"><div class="label">Approved refunds</div><div class="value">${money(data.refundedCents)}</div></div></div><section class="panel"><h2>Invoice summary</h2>${table(["Status", "Count", "Total"], invoiceRows)}</section><section class="panel"><h2>Payment method summary</h2>${table(["Method", "Count", "Collected"], methodRows)}</section>`;
}

async function renderAudit(billingOnly = false) {
  const data = await api(`/audit-logs${billingOnly ? "?module=billing" : ""}`);
  const rows = data.items.map((item) => `<tr><td>${item.createdAt ? esc(dateTime(item.createdAt)) : "—"}</td><td>${esc(item.userName)}</td><td>${esc(item.role)}</td><td>${esc(item.module)}</td><td>${esc(item.action)}</td><td class="clip wide-clip" title="${esc(item.details)}">${esc(item.details)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Audit activity", "Activity from the shared MediLink audit log, across every subsystem.")}<div class="toolbar"><button class="button ${billingOnly ? "" : "primary"}" data-audit="all">All subsystems</button><button class="button ${billingOnly ? "primary" : ""}" data-audit="billing">Billing only</button></div>${table(["Timestamp", "User", "Role", "Module", "Action", "Details"], rows)}`;
}

async function renderSettings() {
  const data = await api("/settings");
  content.innerHTML = `${pageHead("Billing settings", "Hospital details and default invoice configuration.")}${formPanel("System settings", `${input("hospitalName", "Hospital name", "text", true, `value="${esc(data.hospitalName)}"`)}${input("hospitalContact", "Contact", "text", false, `value="${esc(data.hospitalContact)}"`)}<label class="wide">Address<textarea name="hospitalAddress">${esc(data.hospitalAddress)}</textarea></label>${input("currency", "Currency code", "text", true, `value="${esc(data.currency)}" maxlength="3"`)}${input("defaultDueDays", "Default due days", "number", true, `value="${data.defaultDueDays}" min="0" max="365"`)}${input("taxBasisPoints", "Tax (basis points; 100 = 1%)", "number", true, `value="${data.taxBasisPoints}" min="0" max="10000"`)}`, "Save settings", "settings")}`;
}

function moneyToCents(value) {
  const text = String(value).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) throw new Error("Enter a non-negative amount with no more than two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Amount is too large.");
  return cents;
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $("#login-error").textContent = "";
  try {
    await api("/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    await checkSession();
  } catch (error) { $("#login-error").textContent = error.message; }
});
$("#login-form [name=showPassword]").addEventListener("change", (event) => {
  $("#login-form [name=password]").type = event.target.checked ? "text" : "password";
});
$("#logout").addEventListener("click", async () => { await api("/auth/logout", { method: "POST" }); currentUser = null; landed = false; showLogin(); });
$("#menu-button").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#navigation").addEventListener("click", (event) => {
  const link = event.target.closest("[data-page]");
  if (!link) return;
  event.preventDefault();
  setPage(link.dataset.page);
});
content.addEventListener("click", async (event) => {
  const issue = event.target.closest("[data-issue]");
  const cancel = event.target.closest("[data-cancel]");
  const approve = event.target.closest("[data-refund]");
  const print = event.target.closest("[data-receipt]");
  if (issue) {
    try { await api(`/invoices/${issue.dataset.issue}/issue`, { method: "POST", body: "{}" }); toast("Invoice issued."); await renderPage(); } catch (error) { toast(error.message); }
  }
  if (cancel) {
    const reason = prompt("Reason for cancellation (minimum 5 characters):");
    if (!reason) return;
    try { await api(`/invoices/${cancel.dataset.cancel}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Bill cancelled."); await renderPage(); } catch (error) { toast(error.message); }
  }
  if (approve) {
    try { await api(`/refunds/${approve.dataset.refund}/approve`, { method: "POST", body: "{}" }); toast("Refund approved."); await renderRefunds(); } catch (error) { toast(error.message); }
  }
  if (print) {
    try {
      $("#receipt-slot").innerHTML = receiptHtml(await api(`/receipts/${print.dataset.receipt}`));
      $("#receipt").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) { toast(error.message); }
  }
  if (event.target.closest("[data-print-receipt]")) window.print();
  if (event.target.closest("[data-close-receipt]")) $("#receipt-slot").innerHTML = "";
  const pay = event.target.closest("[data-pay]");
  if (pay) {
    const form = $("#payment-form form");
    form.elements.invoiceId.value = pay.dataset.pay;
    form.elements.amount.value = centsToInput(pendingBills.get(pay.dataset.pay).balanceCents);
    $("#payment-form").scrollIntoView({ behavior: "smooth", block: "start" });
    form.elements.amount.focus({ preventScroll: true });
  }
  const history = event.target.closest("[data-history]");
  if (history) renderPatientHistory(history.dataset.history).catch(showError);
  const openPage = event.target.closest("[data-open-page]");
  if (openPage) setPage(openPage.dataset.openPage);
  const gotoPay = event.target.closest("[data-goto-pay]");
  if (gotoPay) { payTargetId = gotoPay.dataset.gotoPay; setPage("payments"); }
  const auditFilter = event.target.closest("[data-audit]");
  if (auditFilter) renderAudit(auditFilter.dataset.audit === "billing").catch(showError);
});
content.addEventListener("change", (event) => {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  const name = event.target.name;
  if (form.dataset.action === "payment" && name === "invoiceId") {
    const bill = pendingBills.get(event.target.value);
    if (bill) form.elements.amount.value = centsToInput(bill.balanceCents);
  }
  if (form.dataset.action === "bill" && (name === "department" || name === "patientId")) loadSourceRecords(form);
  if (form.dataset.action === "bill" && name === "sourceIndex") {
    const record = event.target.value === "" ? null : sourceRecords[Number(event.target.value)];
    if (!record) return;
    form.elements.description.value = record.label.slice(0, 300);
    if (record.amountCents) form.elements.amount.value = centsToInput(record.amountCents);
  }
});
content.addEventListener("submit", async (event) => {
  const searchForm = event.target.closest("form[data-search]");
  if (searchForm) {
    event.preventDefault();
    return renderHistory(new FormData(searchForm).get("search").trim()).catch(showError);
  }
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    const action = form.dataset.action;
    let path; let method = "POST"; let body;
    if (action === "service") { path = "/services"; body = { code: data.get("code"), name: data.get("name"), category: data.get("category"), description: data.get("description"), unitPriceCents: moneyToCents(data.get("unitPrice")) }; }
    if (action === "invoice") { path = "/invoices"; body = { patientId: data.get("patientId"), items: [{ serviceId: data.get("serviceId"), quantity: Number(data.get("quantity")) }], notes: data.get("notes") }; }
    if (action === "bill") {
      const source = sourceRecords[Number(data.get("sourceIndex"))] && data.get("sourceIndex") !== "" ? sourceRecords[Number(data.get("sourceIndex"))] : null;
      const bill = await api("/bills", { method, body: JSON.stringify({ department: Number(data.get("department")), patientId: data.get("patientId"), amountCents: moneyToCents(data.get("amount")), description: data.get("description") || undefined, sourceReference: source?.reference || undefined }) });
      toast(`Bill ${bill.invoiceNumber} sent to Payment.`);
      return renderBilling();
    }
    if (action === "payment") {
      body = { invoiceId: data.get("invoiceId"), amountCents: moneyToCents(data.get("amount")), method: data.get("method"), transactionReference: data.get("transactionReference") };
      // One key per rendered form, so a double submit cannot record the payment twice.
      form.dataset.key ||= crypto.randomUUID();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const result = await api("/payments", { method, headers: { "Idempotency-Key": form.dataset.key }, body: JSON.stringify(body) });
        toast(result.duplicate ? "This payment was already recorded." : "Payment processed and receipt released.");
        return await renderPayments({ receipt: result.receipt });
      } finally { button.disabled = false; }
    }
    if (action === "claim") { path = "/insurance/claims"; body = { providerId: data.get("providerId"), invoiceId: data.get("invoiceId"), claimCents: moneyToCents(data.get("claimAmount")), claimReference: data.get("claimReference") }; }
    if (action === "provider") { path = "/insurance/providers"; body = Object.fromEntries(data); }
    if (action === "refund") { path = "/refunds"; body = { paymentId: data.get("paymentId"), amountCents: moneyToCents(data.get("amount")), reason: data.get("reason") }; }
    if (action === "settings") {
      path = "/settings"; method = "PUT"; body = { hospitalName: data.get("hospitalName"), hospitalAddress: data.get("hospitalAddress"), hospitalContact: data.get("hospitalContact"), currency: data.get("currency"), defaultDueDays: Number(data.get("defaultDueDays")), taxBasisPoints: Number(data.get("taxBasisPoints")) };
    }
    await api(path, { method, body: JSON.stringify(body) });
    toast("Saved successfully.");
    await renderPage();
  } catch (error) { toast(error.message); }
});

function showLogin() {
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}
async function checkSession() {
  const data = await api("/auth/session");
  if (!data.user) return showLogin();
  currentUser = data.user;
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#user-name").textContent = currentUser.name || currentUser.username;
  $("#user-role").textContent = currentUser.role.replaceAll("_", " ");
  $("#navigation").querySelectorAll("[data-role]").forEach((link) => {
    link.classList.toggle("hidden", !link.dataset.role.split(",").includes(currentUser.role));
  });
  // Cashiers start on their own dashboard; everyone else starts on Billing.
  if (!landed) currentPage = currentUser.role === "cashier" ? "cashier" : "billing";
  landed = true;
  setPage(currentPage);
}
checkSession().catch(showLogin);
