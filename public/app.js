const API = "/api/v1";
const $ = (selector, root = document) => root.querySelector(selector);
const content = $("#content");
let currentUser = null;
let currentPage = "dashboard";

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
  $("#breadcrumb").textContent = page[0].toUpperCase() + page.slice(1).replace("-", " ");
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
  if (currentPage === "dashboard") return renderDashboard();
  if (currentPage === "accounts") return renderAccounts();
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
  content.innerHTML = `${pageHead("Financial overview", "Live billing activity and current account totals.")}<div class="cards">${values.map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join("")}</div><section class="panel"><h2>Recent payments</h2>${table(["Payment ref", "Invoice", "Patient", "Date", "Method", "Amount"], paymentRows)}</section>`;
}

async function renderAccounts(search = "") {
  const [data, invoices] = await Promise.all([api(`/accounts?search=${encodeURIComponent(search)}`), api("/outstanding")]);
  const balanceMap = new Map();
  for (const invoice of invoices.items) balanceMap.set(invoice.patientId, (balanceMap.get(invoice.patientId) || 0) + invoice.balanceCents);
  const rows = data.items.map((item) => `<tr><td>${esc(item.patientId)}</td><td>${esc(item.patientName)}</td><td>${esc(item.billingAccountNumber)}</td><td>${esc(item.contact)}</td><td>${money(balanceMap.get(item.patientId) || 0)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Patient billing accounts", "Billing references for patients; patient identity remains owned by the MediLink patient system.", currentUser.role === "billing_admin" || currentUser.role === "billing_officer" ? `<button class="button primary" data-scroll="account-form">Register account</button>` : "")}<div class="toolbar"><input id="account-search" placeholder="Search patient, ID, account…" value="${esc(search)}"><button class="button" id="account-search-btn">Search</button></div>${table(["Patient ID", "Patient", "Account number", "Contact", "Open balance"], rows)}${currentUser.role === "billing_admin" || currentUser.role === "billing_officer" ? formPanel("Register billing account", `${input("patientId", "Patient ID")}${input("patientName", "Patient name")}${input("billingAccountNumber", "Billing account number")}${input("contact", "Contact", "text", false)}<label class="wide">Billing address<textarea name="billingAddress"></textarea></label>`, "Create account", "account") : ""}`;
}

async function renderServices() {
  const data = await api(`/services?all=${currentUser.role === "billing_admin"}`);
  const rows = data.items.map((item) => `<tr><td>${esc(item.code)}</td><td>${esc(item.name)}</td><td>${esc(item.category)}</td><td>${money(item.unitPriceCents)}</td><td>${item.active ? "Active" : "Inactive"}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Service catalog", "Manageable billable services; invoice items keep their original price snapshots.")}${table(["Code", "Service", "Category", "Unit price", "Status"], rows)}${currentUser.role === "billing_admin" ? formPanel("Add a service", `${input("code", "Service code")}${input("name", "Service name")}${input("category", "Category")}${input("unitPrice", "Unit price (PHP)", "number", true, 'min="0" step="0.01"')}<label class="wide">Description<textarea name="description"></textarea></label>`, "Create service", "service") : ""}`;
}

async function renderInvoices() {
  const [data, accounts, services] = await Promise.all([api("/invoices"), api("/accounts"), api("/services")]);
  const rows = data.items.map((item) => `<tr><td>${esc(item.invoiceNumber || "Draft")}</td><td>${esc(item.patientName)}</td><td>${new Date(item.createdAt).toLocaleDateString("en-PH")}</td><td>${money(item.totalCents)}</td><td>${money(item.balanceCents)}</td><td>${status(item.status)}</td><td>${item.status === "draft" && ["billing_admin", "billing_officer"].includes(currentUser.role) ? `<button class="button" data-issue="${esc(item._id)}">Issue</button>` : item.status === "issued" && currentUser.role === "billing_admin" ? `<button class="button danger" data-cancel="${esc(item._id)}">Cancel</button>` : ""}</td></tr>`).join("");
  const accountOptions = accounts.items.map((item) => `<option value="${esc(item._id)}">${esc(item.patientId)} · ${esc(item.patientName)}</option>`).join("");
  const serviceOptions = services.items.map((item) => `<option value="${esc(item._id)}">${esc(item.code)} · ${esc(item.name)} (${money(item.unitPriceCents)})</option>`).join("");
  const creator = ["billing_admin", "billing_officer"].includes(currentUser.role) ? formPanel("Create draft invoice", `<label class="wide">Patient account<select name="patientAccountId" required>${accountOptions}</select></label><label class="wide">Service<select name="serviceId" required>${serviceOptions}</select></label>${input("quantity", "Quantity", "number", true, 'min="1" value="1"')}<label class="wide">Notes<textarea name="notes"></textarea></label>`, "Save draft", "invoice") : "";
  content.innerHTML = `${pageHead("Invoices", "Draft, issue, and track patient invoices.")}${table(["Invoice", "Patient", "Created", "Total", "Balance", "Status", "Actions"], rows)}${creator}`;
}

async function renderPayments() {
  const [data, invoices, receipts] = await Promise.all([api("/payments"), api("/invoices"), api("/receipts")]);
  const rows = data.items.map((item) => {
    const receipt = receipts.items.find((row) => String(row.paymentId) === String(item._id));
    return `<tr><td>${esc(item.paymentReference)}</td><td>${esc(receipt?.receiptNumber || "—")} ${receipt ? `<button class="button" data-print="${esc(receipt._id)}">Print</button>` : ""}</td><td>${esc(item.invoiceNumber)}</td><td>${esc(item.patientName)}</td><td>${money(item.amountCents)}</td><td>${esc(item.method)}</td><td>${new Date(item.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td></tr>`;
  }).join("");
  const options = invoices.items.filter((item) => ["issued", "partially_paid", "overdue"].includes(item.status)).map((item) => `<option value="${esc(item._id)}">${esc(item.invoiceNumber)} · ${esc(item.patientName)} · ${money(item.balanceCents)} due</option>`).join("");
  const form = ["billing_admin", "cashier"].includes(currentUser.role) ? formPanel("Record payment", `<label class="wide">Invoice<select name="invoiceId" required>${options}</select></label>${input("amount", "Amount (PHP)", "number", true, 'min="0.01" step="0.01"')}<label>Payment method<select name="method"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card_terminal">External card terminal</option><option value="e_wallet">E-wallet</option><option value="insurance">Insurance</option><option value="other">Other</option></select></label>${input("transactionReference", "Transaction reference", "text", false)}<p class="wide muted">Do not enter card numbers, CVV, PIN, or passwords. Card payments must be completed through an external terminal/provider.</p>`, "Record & issue receipt", "payment") : "";
  content.innerHTML = `${pageHead("Payments & receipts", "Successful payments automatically receive one immutable receipt.")}${table(["Payment", "Receipt", "Invoice", "Patient", "Amount", "Method", "Date"], rows)}${form}`;
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

async function renderAudit() {
  const data = await api("/audit-logs");
  const rows = data.items.map((item) => `<tr><td>${new Date(item.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>${esc(item.username)}</td><td>${esc(item.action)}</td><td>${esc(item.recordType)}</td><td>${esc(item.recordId)}</td></tr>`).join("");
  content.innerHTML = `${pageHead("Audit activity", "Immutable application audit records.")}${table(["Timestamp", "User", "Action", "Record type", "Record ID"], rows)}`;
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
$("#logout").addEventListener("click", async () => { await api("/auth/logout", { method: "POST" }); currentUser = null; showLogin(); });
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
  const print = event.target.closest("[data-print]");
  if (issue) {
    try { await api(`/invoices/${issue.dataset.issue}/issue`, { method: "POST", body: "{}" }); toast("Invoice issued."); await renderInvoices(); } catch (error) { toast(error.message); }
  }
  if (cancel) {
    const reason = prompt("Reason for cancellation (minimum 5 characters):");
    if (!reason) return;
    try { await api(`/invoices/${cancel.dataset.cancel}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); toast("Invoice cancelled."); await renderInvoices(); } catch (error) { toast(error.message); }
  }
  if (approve) {
    try { await api(`/refunds/${approve.dataset.refund}/approve`, { method: "POST", body: "{}" }); toast("Refund approved."); await renderRefunds(); } catch (error) { toast(error.message); }
  }
  if (print) {
    try {
      const receipt = await api(`/receipts/${print.dataset.print}`);
      const receiptWindow = window.open("", "_blank", "width=640,height=720");
      if (!receiptWindow) throw new Error("Allow pop-ups to print the receipt.");
      receiptWindow.opener = null;
      const fields = [
        ["Receipt", receipt.receiptNumber], ["Payment date", new Date(receipt.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })],
        ["Patient", `${receipt.patientName} (${receipt.patientId})`], ["Invoice", receipt.invoiceNumber],
        ["Amount", money(receipt.amountCents)], ["Method", receipt.method], ["Reference", receipt.transactionReference || "—"],
        ["Balance remaining", money(receipt.balanceAfterCents)]
      ];
      receiptWindow.document.write(`<!doctype html><html><head><title>Receipt ${esc(receipt.receiptNumber)}</title><style>body{font:15px Arial,sans-serif;max-width:560px;margin:40px auto;color:#222}header{text-align:center;border-bottom:1px solid #bbb;padding-bottom:16px}h1{font-size:21px}p{margin:5px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:9px 0}.amount{font-size:20px;font-weight:bold}@media print{button{display:none}}</style></head><body><header><h1>${esc(receipt.hospitalName)}</h1><p>${esc(receipt.hospitalAddress)}</p><p>${esc(receipt.hospitalContact)}</p><h2>Official payment receipt</h2></header>${fields.map(([label, value]) => `<div class="row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}<p class="muted">Reprint of the original receipt. No new payment was created.</p><button onclick="window.print()">Print</button></body></html>`);
      receiptWindow.document.close();
    } catch (error) { toast(error.message); }
  }
  if (event.target.closest("[data-scroll]")) $(`#${event.target.closest("[data-scroll]").dataset.scroll}`)?.scrollIntoView({ behavior: "smooth" });
  if (event.target.id === "account-search-btn") renderAccounts($("#account-search").value).catch(showError);
});
content.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    const action = form.dataset.action;
    let path; let method = "POST"; let body;
    if (action === "account") { path = "/accounts"; body = Object.fromEntries(data); }
    if (action === "service") { path = "/services"; body = { code: data.get("code"), name: data.get("name"), category: data.get("category"), description: data.get("description"), unitPriceCents: moneyToCents(data.get("unitPrice")) }; }
    if (action === "invoice") { path = "/invoices"; body = { patientAccountId: data.get("patientAccountId"), items: [{ serviceId: data.get("serviceId"), quantity: Number(data.get("quantity")) }], notes: data.get("notes") }; }
    if (action === "payment") {
      path = "/payments";
      body = { invoiceId: data.get("invoiceId"), amountCents: moneyToCents(data.get("amount")), method: data.get("method"), transactionReference: data.get("transactionReference") };
      const key = crypto.randomUUID();
      await api(path, { method, headers: { "Idempotency-Key": key }, body: JSON.stringify(body) });
      toast("Payment recorded and receipt issued.");
      return renderPayments();
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
  $("#user-name").textContent = currentUser.username;
  $("#user-role").textContent = currentUser.role.replaceAll("_", " ");
  $("#navigation").querySelectorAll("[data-role]").forEach((link) => {
    link.classList.toggle("hidden", !link.dataset.role.split(",").includes(currentUser.role));
  });
  setPage(currentPage);
}
checkSession().catch(showLogin);
