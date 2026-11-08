function notFound(req, res) {
  res.status(404).json({ error: "Not found." });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed.", details: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
  }
  if (error.code === 11000) return res.status(409).json({ error: "A record with that unique value already exists." });
  if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ error: "Invalid record data." });
  if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
}

module.exports = { notFound, errorHandler };
