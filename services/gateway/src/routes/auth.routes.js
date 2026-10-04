const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const config = require("../config");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/v1/auth/register
 * Creates a new user with role 'ADMIN' or 'AUDITOR'
 */
router.post("/register", async (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: "Missing required fields: email, password, full_name" });
  }

  const assignedRole = role === "ADMIN" ? "ADMIN" : "AUDITOR";

  try {
    const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, created_at`,
      [email, password_hash, full_name, assignedRole]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    return res.status(201).json({
      message: "User registered successfully",
      user,
      token,
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res.status(500).json({ error: "Internal server error during registration." });
  }
});

/**
 * POST /api/v1/auth/login
 * Verifies credentials and returns signed JWT with RBAC claims
 */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const result = await db.query(
      "SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: "User account is inactive." });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_resource, target_id, metadata, ip_address)
       VALUES ($1, 'USER_LOGIN', 'user', $1, $2, $3)`,
      [user.id, JSON.stringify({ email: user.email, role: user.role }), req.ip]
    );

    return res.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error during login." });
  }
});

/**
 * GET /api/v1/auth/me
 * Retrieves authenticated user profile
 */
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, email, full_name, role, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json({ user: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
