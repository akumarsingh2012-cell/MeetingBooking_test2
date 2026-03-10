// routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');

const genId = () => `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// GET /api/users  (admin only)
router.get('/', auth, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active, u.phone, u.dept, u.created_at,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'approved') as approved_count
    FROM users u ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

// GET /api/users/:id  (auth — user can fetch their own, admin can fetch any)
router.get('/:id', auth, (req, res) => {
  if (req.params.id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = db.prepare('SELECT id, name, email, role, active, phone, dept, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// POST /api/users  (admin only) — create user
router.post('/', auth, adminOnly, (req, res) => {
  const { name, email, password, role = 'employee', phone = '', dept = '' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Minimum 6 characters for password' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (exists) return res.status(409).json({ error: 'Email already in use' });

  const id = genId();
  db.prepare(`
    INSERT INTO users (id, name, email, password, role, phone, dept)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), role, phone, dept);

  const user = db.prepare('SELECT id, name, email, role, active, phone, dept, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json(user);
});

// PATCH /api/users/:id  — edit user (admin edits anyone; employee edits only themselves, limited fields)
router.patch('/:id', auth, (req, res) => {
  const isSelf = req.params.id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Fields anyone can update on themselves
  const name    = req.body.name    !== undefined ? req.body.name.trim()    : user.name;
  const phone   = req.body.phone   !== undefined ? req.body.phone.trim()   : user.phone;
  const dept    = req.body.dept    !== undefined ? req.body.dept.trim()     : user.dept;

  // Admin-only fields
  let email  = user.email;
  let role   = user.role;
  let active = user.active;

  if (isAdmin) {
    if (req.body.email !== undefined) {
      const newEmail = req.body.email.toLowerCase().trim();
      const clash = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.params.id);
      if (clash) return res.status(409).json({ error: 'Email already in use' });
      email = newEmail;
    }
    if (req.body.role   !== undefined) role   = req.body.role;
    if (req.body.active !== undefined) active = req.body.active ? 1 : 0;
  }

  if (!name) return res.status(400).json({ error: 'Name is required' });

  db.prepare(`
    UPDATE users SET name = ?, email = ?, phone = ?, dept = ?, role = ?, active = ? WHERE id = ?
  `).run(name, email, phone, dept, role, active, req.params.id);

  const updated = db.prepare('SELECT id, name, email, role, active, phone, dept, created_at FROM users WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// PATCH /api/users/:id/toggle-active  (admin only)
router.patch('/:id/toggle-active', auth, adminOnly, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(user.active ? 0 : 1, req.params.id);
  res.json({ active: !user.active });
});

// PATCH /api/users/:id/reset-password  (admin only)
router.patch('/:id/reset-password', auth, adminOnly, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.params.id);
  res.json({ message: 'Password reset' });
});

// DELETE /api/users/:id  (admin only, cannot delete self)
router.delete('/:id', auth, adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: 'User deleted' });
});

module.exports = router;
