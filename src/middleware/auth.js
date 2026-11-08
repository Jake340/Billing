const ROLES = {
  admin: ["billing_admin"],
  billing: ["billing_admin", "billing_officer"],
  cashier: ["billing_admin", "cashier"],
  readBilling: ["billing_admin", "billing_officer", "cashier", "billing_auditor"],
  adminOrAuditor: ["billing_admin", "billing_auditor"]
};

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Authentication required." });
  next();
}

function allowRoles(roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Authentication required." });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: "You do not have permission to perform this action." });
    next();
  };
}

module.exports = { ROLES, requireAuth, allowRoles };
