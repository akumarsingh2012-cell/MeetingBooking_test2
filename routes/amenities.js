// routes/amenities.js  –  Room amenity requests
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');
const notify = require('../services/notify');

const genId  = () => `ar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const genNId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function addNotification(user_id, title, message, type = 'info') {
  db.prepare(`INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)`)
    .run(genNId(), user_id, title, message, type);
}

function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }
function formatReq(r) { return { ...r, items: safeJson(r.items, []) }; }

// GET /api/amenities  –  my requests (admin: all)
router.get('/', auth, (req, res) => {
  let sql = `
    SELECT ar.*, u.name as user_name, u.email as user_email,
           r.name as room_name, r.color as room_color,
           b.date, b.start_time, b.end_time, b.purpose
    FROM amenity_requests ar
    JOIN users u ON u.id = ar.user_id
    JOIN rooms r ON r.id = ar.room_id
    JOIN bookings b ON b.id = ar.booking_id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role !== 'admin') { sql += ' AND ar.user_id = ?'; params.push(req.user.id); }
  sql += ' ORDER BY ar.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(formatReq));
});

// POST /api/amenities  –  create request for a booking
router.post('/', auth, (req, res) => {
  const { booking_id, items = [], notes = '' } = req.body;
  if (!booking_id || !items.length) return res.status(400).json({ error: 'booking_id and items required' });

  const booking = db.prepare(`
    SELECT b.*, r.name as room_name, r.floor as room_floor
    FROM bookings b JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ? AND b.user_id = ?
  `).get(booking_id, req.user.id);

  if (!booking) return res.status(404).json({ error: 'Booking not found or not yours' });
  if (!['approved','pending'].includes(booking.status)) return res.status(400).json({ error: 'Booking must be active to request amenities' });

  // Check for existing request for this booking
  const existing = db.prepare('SELECT id FROM amenity_requests WHERE booking_id = ?').get(booking_id);
  if (existing) {
    // Update instead of create
    db.prepare('UPDATE amenity_requests SET items = ?, notes = ?, status = ? WHERE booking_id = ?')
      .run(JSON.stringify(items), notes, 'pending', booking_id);
    const updated = db.prepare(`SELECT ar.*, u.name as user_name, r.name as room_name, b.date, b.start_time, b.end_time, b.purpose FROM amenity_requests ar JOIN users u ON u.id=ar.user_id JOIN rooms r ON r.id=ar.room_id JOIN bookings b ON b.id=ar.booking_id WHERE ar.booking_id=?`).get(booking_id);
    return res.json(formatReq(updated));
  }

  const id = genId();
  db.prepare(`INSERT INTO amenity_requests (id, booking_id, user_id, room_id, items, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, booking_id, req.user.id, booking.room_id, JSON.stringify(items), notes);

  // Notify admins
  const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all();
  admins.forEach(a => addNotification(a.id, '🔧 Amenity Request', `${req.user.name} requested amenities for ${booking.room_name} on ${booking.date}`, 'info'));

  // Slack notify
  notify.slackAmenityRequest(
    { user_name: req.user.name, items, notes },
    { room_name: booking.room_name, date: booking.date }
  ).catch(() => {});

  const created = db.prepare(`SELECT ar.*, u.name as user_name, u.email as user_email, r.name as room_name, r.color as room_color, b.date, b.start_time, b.end_time, b.purpose FROM amenity_requests ar JOIN users u ON u.id=ar.user_id JOIN rooms r ON r.id=ar.room_id JOIN bookings b ON b.id=ar.booking_id WHERE ar.id=?`).get(id);
  res.status(201).json(formatReq(created));
});

// PATCH /api/amenities/:id/respond  –  admin approves/rejects amenity request
router.patch('/:id/respond', auth, adminOnly, (req, res) => {
  const { status, admin_note = '' } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });

  const ar = db.prepare('SELECT * FROM amenity_requests WHERE id = ?').get(req.params.id);
  if (!ar) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE amenity_requests SET status = ?, admin_note = ? WHERE id = ?').run(status, admin_note, req.params.id);

  const items = safeJson(ar.items, []).join(', ');
  const msg = status === 'approved'
    ? `Your amenity request (${items}) has been approved.${admin_note ? ' Note: ' + admin_note : ''}`
    : `Your amenity request (${items}) was not fulfilled.${admin_note ? ' Reason: ' + admin_note : ''}`;

  addNotification(ar.user_id, status === 'approved' ? '🔧 Amenity Approved' : '🔧 Amenity Not Fulfilled', msg, status === 'approved' ? 'success' : 'error');

  res.json({ message: 'Response saved' });
});

// GET /api/amenities/pending-count (admin)
router.get('/pending-count', auth, adminOnly, (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as c FROM amenity_requests WHERE status = 'pending'").get();
  res.json({ count: row.c });
});

module.exports = router;
