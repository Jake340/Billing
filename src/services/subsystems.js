// Read-only access to the collections owned by the other MediLink subsystems.
// Billing never writes to these collections; it only fetches from them.
const mongoose = require("mongoose");
const { toDepartments } = require("../config/departments");

const shared = (name) => mongoose.connection.collection(name);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patientName(patient) {
  return [patient.firstName, patient.middleName, patient.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || "Unnamed patient";
}

function toPatient(patient) {
  return { patientId: patient.patientId, patientName: patientName(patient), status: patient.status || "" };
}

async function listDepartments() {
  const subsystems = await shared("portal_subsystems").find({}, { projection: { id: 1, name: 1 } }).toArray();
  return toDepartments(subsystems);
}

async function findDepartment(id) {
  return (await listDepartments()).find((department) => department.id === id) || null;
}

async function listPatients(search = "") {
  const text = String(search).trim().slice(0, 100);
  const filter = { patientId: { $type: "string", $ne: "" } };
  if (text) {
    const pattern = { $regex: escapeRegex(text), $options: "i" };
    filter.$or = [{ patientId: pattern }, { firstName: pattern }, { lastName: pattern }];
  }
  const patients = await shared("patients").find(filter, { projection: { patientId: 1, firstName: 1, middleName: 1, lastName: 1, status: 1 } })
    .sort({ lastName: 1, firstName: 1 }).limit(300).toArray();
  return patients.map(toPatient);
}

// Returns the raw patient document (needed for its _id), or null.
async function findPatient(patientId) {
  if (typeof patientId !== "string" || !patientId) return null;
  return shared("patients").findOne({ patientId });
}

// Records the chosen department holds for a patient, offered as the source of a bill.
// The other subsystems do not store prices (except room rates), so the amount is still typed in.
async function listSourceRecords(departmentId, patient) {
  if (departmentId === 3) {
    const rows = await shared("medicationOrders").find({ patientId: patient.patientId }).sort({ createdAt: -1 }).limit(50).toArray();
    return rows.map((row) => ({ reference: row.orderNumber || "", label: [row.orderNumber, [row.medicationName, `${row.prescribedDose || ""}${row.doseUnit || ""}`].filter(Boolean).join(" ")].filter(Boolean).join(" · "), status: row.orderStatus || "" }));
  }
  if (departmentId === 4) {
    const rows = await shared("laboratory_requests").find({ patient: patient._id, status: { $nin: ["draft", "cancelled"] } }).sort({ createdAt: -1 }).limit(50).toArray();
    return rows.map((row) => ({ reference: row.requestNumber || "", label: [row.requestNumber, (row.tests || []).map((item) => item?.testSnapshot?.testName).filter(Boolean).join(", ")].filter(Boolean).join(" · "), status: row.status || "" }));
  }
  if (departmentId === 8) {
    const rows = await shared("ipd_room_rates").find({ dailyRate: { $type: "number", $gt: 0 } }).sort({ dailyRate: 1 }).limit(50).toArray();
    return rows.map((row) => ({ reference: "", label: `${row.category || "Room"} room rate, per day`, status: "", amountCents: Math.round(row.dailyRate * 100) }))
      .filter((row) => Number.isSafeInteger(row.amountCents));
  }
  return [];
}

module.exports = { listDepartments, findDepartment, listPatients, findPatient, listSourceRecords, toPatient };
