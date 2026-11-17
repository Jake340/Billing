// This subsystem's own number in the MediLink portal (portal_subsystems.id).
const BILLING_SUBSYSTEM_ID = 6;

// Subsystems that never send charges to Billing, so they are not offered as a department:
// 1 = Patient Registration and Admission Management, 7 = Hospital Administration, HR, and Reporting.
const NON_BILLABLE_SUBSYSTEM_IDS = [1, 7];

// Used only when the shared portal_subsystems collection is empty or unreachable.
// Normally the department choices are read live from that collection.
const FALLBACK_DEPARTMENTS = [
  { id: 2, name: "Medical Records and Clinical Services" },
  { id: 3, name: "Hospital Patient Medication Administration and Tracking System" },
  { id: 4, name: "Laboratory Request and Results Management" },
  { id: 5, name: "Pharmacy and Medical Inventory" },
  { id: 8, name: "Bed Allocation and Inpatient Ward Management" },
  { id: 9, name: "Operating Room and Surgical Scheduling" }
];

// Turns portal_subsystems documents into department choices, leaving out Billing itself
// and the subsystems that do not bill patients.
function toDepartments(subsystems) {
  const seen = new Set();
  const departments = [];
  for (const subsystem of subsystems || []) {
    const id = Number(subsystem?.id);
    const name = String(subsystem?.name || "").trim();
    if (!Number.isInteger(id) || id < 1 || !name || id === BILLING_SUBSYSTEM_ID || NON_BILLABLE_SUBSYSTEM_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    departments.push({ id, name });
  }
  departments.sort((a, b) => a.id - b.id);
  return departments.length ? departments : FALLBACK_DEPARTMENTS;
}

module.exports = { BILLING_SUBSYSTEM_ID, NON_BILLABLE_SUBSYSTEM_IDS, FALLBACK_DEPARTMENTS, toDepartments };
