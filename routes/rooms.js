// routes/rooms.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');

const genId = () => `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// GET /api/rooms  (all authenticated users)
router.get('/', auth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name').all();
  res.json(rooms.map(formatRoom));
});

// GET /api/rooms/:id/availability?date=YYYY-MM-DD
router.get('/:id/availability', auth, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query param required' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const bookings = db.prepare(`
    SELECT start_time, end_time, status, meeting_type FROM bookings
    WHERE room_id = ? AND date = ? AND status NOT IN ('cancelled','rejected')
  `).all(req.params.id, date);

  const slots = [];
  for (let h = 9; h < 20; h++) {
    const s = pad(h) + ':00';
    const e = pad(h + 1) + ':00';
    // A slot is busy only if there is an APPROVED booking overlapping it.
    // Pending external bookings do not block — they are waiting for admin approval.
    const busy = bookings.some(b =>
      b.status === 'approved' &&
      t2m(b.start_time) < t2m(e) && t2m(b.end_time) > t2m(s)
    );
    // Count how many pending requests exist for this slot (for info display)
    const pendingCount = bookings.filter(b =>
      b.status === 'pending' &&
      t2m(b.start_time) < t2m(e) && t2m(b.end_time) > t2m(s)
    ).length;
    slots.push({ start: s, end: e, free: !busy, pending_requests: pendingCount });
  }

  res.json({ slots, bookings });
});

// POST /api/rooms  (admin only)
router.post('/', auth, adminOnly, (req, res) => {
  const { name, capacity = 10, color = '#3d6ce7', max_dur = 240, floor = '', amenities = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name required' });
  const id = genId();
  db.prepare(`
    INSERT INTO rooms (id, name, capacity, color, max_dur, floor, amenities)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), capacity, color, max_dur, floor, JSON.stringify(amenities));
  res.status(201).json(formatRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id)));
});

// PATCH /api/rooms/:id  (admin only)
router.patch('/:id', auth, adminOnly, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });

  const name      = req.body.name      !== undefined ? req.body.name.trim() : room.name;
  const capacity  = req.body.capacity  !== undefined ? req.body.capacity    : room.capacity;
  const color     = req.body.color     !== undefined ? req.body.color       : room.color;
  const max_dur   = req.body.max_dur   !== undefined ? req.body.max_dur     : room.max_dur;
  const floor     = req.body.floor     !== undefined ? req.body.floor       : room.floor;
  const amenities = req.body.amenities !== undefined ? JSON.stringify(req.body.amenities) : room.amenities;
  const blocked   = req.body.blocked   !== undefined ? (req.body.blocked ? 1 : 0) : room.blocked;

  db.prepare(`
    UPDATE rooms SET name=?, capacity=?, color=?, max_dur=?, floor=?, amenities=?, blocked=? WHERE id=?
  `).run(name, capacity, color, max_dur, floor, amenities, blocked, req.params.id);

  res.json(formatRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id)));
});

// PATCH /api/rooms/:id/toggle-block  (admin only)
router.patch('/:id/toggle-block', auth, adminOnly, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE rooms SET blocked = ? WHERE id = ?').run(room.blocked ? 0 : 1, req.params.id);
  res.json({ blocked: !room.blocked });
});

// DELETE /api/rooms/:id  (admin only)
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ message: 'Room deleted' });
});

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatRoom(r) {
  return {
    ...r,
    amenities: safeParseJson(r.amenities, []),
    blocked: !!r.blocked
  };
}

function safeParseJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function pad(n) { return String(n).padStart(2, '0'); }
function t2m(t) { const [h, m] = (t || '0:0').split(':'); return +h * 60 + +m; }

module.exports = router;
