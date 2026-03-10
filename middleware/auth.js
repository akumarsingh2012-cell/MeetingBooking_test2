// middleware/auth.js  –  JWT verification middleware
const jwt = require('jsonwebtoken');
const db = require('../db/database');

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    // Verify user still exists and is active
    const user = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account not found or inactive' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { auth, adminOnly };
