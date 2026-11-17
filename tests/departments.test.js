const test = require("node:test");
const assert = require("node:assert/strict");
const { BILLING_SUBSYSTEM_ID, NON_BILLABLE_SUBSYSTEM_IDS, FALLBACK_DEPARTMENTS, toDepartments } = require("../src/config/departments");

test("department choices come from the portal subsystems, without Billing or non-billing subsystems", () => {
  const departments = toDepartments([
    { id: 6, name: "Billing and Payment" },
    { id: 4, name: " Laboratory Request and Results Management " },
    { id: 1, name: "Patient Registration and Admission Management" },
    { id: 7, name: "Hospital Administration, HR, and Reporting" },
    { id: 5, name: "Pharmacy and Medical Inventory" },
    { id: 4, name: "Duplicate laboratory row" },
    { id: "x", name: "Bad id" },
    { id: 8, name: "" }
  ]);
  assert.deepEqual(departments, [
    { id: 4, name: "Laboratory Request and Results Management" },
    { id: 5, name: "Pharmacy and Medical Inventory" }
  ]);
});

test("fallback departments are used when the portal list is empty", () => {
  assert.equal(toDepartments([]), FALLBACK_DEPARTMENTS);
  assert.equal(toDepartments(undefined), FALLBACK_DEPARTMENTS);
  assert.ok(FALLBACK_DEPARTMENTS.every((department) => department.id !== BILLING_SUBSYSTEM_ID && !NON_BILLABLE_SUBSYSTEM_IDS.includes(department.id)));
  assert.equal(new Set(FALLBACK_DEPARTMENTS.map((department) => department.id)).size, FALLBACK_DEPARTMENTS.length);
});
