const { Counter } = require("../models");

async function nextNumber(name, prefix, session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session }
  );
  return `${prefix}-${String(counter.value).padStart(8, "0")}`;
}

module.exports = { nextNumber };
