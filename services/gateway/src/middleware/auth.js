const jwt = require("jsonwebtoken");
const config = require("../config");

/**
 * Middleware to authenticate JWT tokens from Authorization header
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Access token is required to access this resource.",
    });
  }

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Invalid or expired access token.",
      });
    }
    req.user = user;
    next();
  });
}

/**
 * Role-Based Access Control (RBAC) middleware
 * @param {Array<string>} allowedRoles e.g. ['ADMIN'] or ['ADMIN', 'AUDITOR']
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        error: "Forbidden",
        message: "User role could not be verified.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Role '${req.user.role}' lacks sufficient privileges. Required: [${allowedRoles.join(", ")}]`,
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
};
