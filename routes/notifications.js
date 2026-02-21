// routes/notifications.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth } = require('../middleware/auth');

// GET /api/notifications
router.get('/', auth, (req, res) => {
  const notifs = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.user.id);
  const unread = notifs.filter(n => !n.is_read).length;
  res.json({ notifications: notifs, unread_count: unread });
});

// PATCH /api/notifications/mark-all-read
router.patch('/mark-all-read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All marked read' });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Marked read' });
});

module.exports = router;
