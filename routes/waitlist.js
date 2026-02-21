// routes/waitlist.js  –  Booking capacity waitlist
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');
const emailSvc = require('../services/email');
const notify   = require('../services/notify');

const genId = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const genNId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function addNotification(user_id, title, message, type = 'info') {
  db.prepare(`INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)`)
    .run(genNId(), user_id, title, message, type);
}

// GET /api/waitlist  –  my waitlist entries (admin sees all)
router.get('/', auth, (req, res) => {
  let sql = `
    SELECT w.*, u.name as user_name, u.email as user_email, r.name as room_name, r.color as room_color, r.floor as room_floor
    FROM waitlist w
    JOIN users u ON u.id = w.user_id
    JOIN rooms r ON r.id = w.room_id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role !== 'admin') { sql += ' AND w.user_id = ?'; params.push(req.user.id); }
  sql += ' ORDER BY w.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/waitlist  –  join waitlist for a slot
router.post('/', auth, (req, res) => {
  const { room_id, date, start_time, end_time, purpose } = req.body;
  if (!room_id || !date || !start_time || !end_time || !purpose) {
    return res.status(400).json({ error: 'room_id, date, start_time, end_time, purpose required' });
  }

  // Check if user already on waitlist for same slot
  const existing = db.prepare(`
    SELECT id FROM waitlist WHERE user_id = ? AND room_id = ? AND date = ? AND start_time = ? AND end_time = ?
  `).get(req.user.id, room_id, date, start_time, end_time);
  if (existing) return res.status(409).json({ error: 'You are already on the waitlist for this slot.' });

  const id = genId();
  db.prepare(`INSERT INTO waitlist (id, user_id, room_id, date, start_time, end_time, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.user.id, room_id, date, start_time, end_time, purpose);

  const entry = db.prepare(`
    SELECT w.*, u.name as user_name, u.email as user_email, r.name as room_name, r.floor as room_floor
    FROM waitlist w JOIN users u ON u.id=w.user_id JOIN rooms r ON r.id=w.room_id WHERE w.id=?
  `).get(id);

  res.status(201).json(entry);
});

// DELETE /api/waitlist/:id  –  leave waitlist
router.delete('/:id', auth, (req, res) => {
  const entry = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM waitlist WHERE id = ?').run(req.params.id);
  res.json({ message: 'Removed from waitlist' });
});

// Internal: called when a booking is cancelled/rejected to notify waitlist users
async function notifyWaitlist(room_id, date, start_time, end_time) {
  function t2m(t) { const [h, m] = (t || '0:0').split(':'); return +h * 60 + +m; }
  const sm = t2m(start_time), em = t2m(end_time);

  const waiters = db.prepare(`
    SELECT w.*, u.name as user_name, u.email as user_email, r.name as room_name, r.floor as room_floor
    FROM waitlist w
    JOIN users u ON u.id = w.user_id
    JOIN rooms r ON r.id = w.room_id
    WHERE w.room_id = ? AND w.date = ? AND w.notified = 0
    ORDER BY w.created_at ASC
  `).all(room_id, date);

  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  for (const w of waiters) {
    const wSm = t2m(w.start_time), wEm = t2m(w.end_time);
    // Only notify if slot overlaps their requested slot
    if (wSm < em && wEm > sm) {
      addNotification(w.user_id, '🔔 Waitlist Slot Available!',
        `A slot opened for ${w.room_name} on ${w.date} (${w.start_time}–${w.end_time}). Book now!`, 'success');

      // Email notification
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#f8fafc;border-radius:12px;">
        <h2 style="color:#16a34a;">🔔 Waitlist Slot Available!</h2>
        <p>Good news! A slot opened up that matches your waitlist entry.</p>
        <div style="background:#fff;border-radius:8px;padding:16px;margin:16px 0;border-left:4px solid #16a34a;">
          <div><strong>Room:</strong> ${w.room_name}</div>
          <div><strong>Date:</strong> ${w.date}</div>
          <div><strong>Time:</strong> ${w.start_time} – ${w.end_time}</div>
        </div>
        <a href="${appUrl}" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Book Now</a>
      </div>`;

      emailSvc.sendRaw({ to: w.user_email, subject: `[MRB] 🔔 Waitlist Slot Available – ${w.room_name} on ${w.date}`, html }).catch(() => {});
      notify.slackWaitlistNotify(w, { room_name: w.room_name }).catch(() => {});
      notify.waWaitlistNotify(w).catch(() => {});

      db.prepare('UPDATE waitlist SET notified = 1 WHERE id = ?').run(w.id);
    }
  }
}

module.exports = router;
module.exports.notifyWaitlist = notifyWaitlist;
