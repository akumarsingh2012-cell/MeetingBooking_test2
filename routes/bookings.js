// routes/bookings.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');
const emailSvc = require('../services/email');
const notify   = require('../services/notify');
const gcalSvc  = require('../services/gcal');
const QRCode   = require('qrcode');

const genId  = () => `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const genNId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const genToken = () => require('crypto').randomBytes(20).toString('hex');

function t2m(t) { const [h, m] = (t || '0:0').split(':'); return +h * 60 + +m; }
function today() { return new Date().toISOString().split('T')[0]; }
function safeJson(s, fb) { try { return JSON.parse(s); } catch { return fb; } }

// ─── Validation ────────────────────────────────────────────────────────────
function validate({ room_id, date, start_time, end_time, persons, exclude_id }) {
  const sm = t2m(start_time), em = t2m(end_time);
  if (isNaN(sm) || isNaN(em))       return 'Invalid times.';
  if (sm < 9 * 60 || em > 20 * 60) return 'Office hours: 9 AM – 8 PM only.';
  if (sm >= em)                      return 'End must be after start.';
  if (em - sm < 15)                  return 'Minimum 15 minutes.';
  if (date < today())                return 'Cannot book in the past.';

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room)        return 'Room not found.';
  if (room.blocked) return 'Room is currently blocked.';
  if (em - sm > room.max_dur) return `Exceeds max ${room.max_dur / 60}h for this room.`;
  if (persons && +persons > room.capacity) return `Exceeds room capacity (${room.capacity}).`;

  // Check against ALL approved bookings (hard block)
  let conflictQ = `
    SELECT b.start_time, b.end_time, u.name as user_name
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    WHERE b.room_id = ? AND b.date = ? AND b.status = 'approved'
  `;
  const params = [room_id, date];
  if (exclude_id) { conflictQ += ' AND b.id != ?'; params.push(exclude_id); }

  const existing = db.prepare(conflictQ).all(...params);
  for (const b of existing) {
    if (sm < t2m(b.end_time) && em > t2m(b.start_time)) {
      return `Time slot already booked (${b.start_time}–${b.end_time}) by ${b.user_name}. Please choose a different slot.`;
    }
  }
  return null;
}

function addNotification(user_id, title, message, type = 'info') {
  db.prepare(`INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)`)
    .run(genNId(), user_id, title, message, type);
}

function formatBooking(b) {
  return {
    ...b,
    food: !!b.food,
    guest_emails: safeJson(b.guest_emails, []),
    reminder_sent: !!b.reminder_sent,
  };
}

// ─── Add X working days to a date ─────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ─── GET /api/bookings ─────────────────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const { room_id, status, meeting_type, date, q } = req.query;
  let sql = `
    SELECT b.*, u.name as user_name, u.email as user_email,
           r.name as room_name, r.color as room_color, r.floor as room_floor
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role !== 'admin') { sql += ' AND b.user_id = ?'; params.push(req.user.id); }
  if (room_id)      { sql += ' AND b.room_id = ?';      params.push(room_id); }
  if (status)       { sql += ' AND b.status = ?';       params.push(status); }
  if (meeting_type) { sql += ' AND b.meeting_type = ?'; params.push(meeting_type); }
  if (date)         { sql += ' AND b.date = ?';         params.push(date); }
  if (q) {
    sql += ' AND (b.purpose LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY b.date DESC, b.start_time DESC';
  res.json(db.prepare(sql).all(...params).map(formatBooking));
});

// ─── GET /api/bookings/pending-count ──────────────────────────────────────
router.get('/pending-count', auth, adminOnly, (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'pending'").get();
  res.json({ count: row.c });
});

// ─── GET /api/bookings/calendar ────────────────────────────────────────────
// Returns ALL non-cancelled bookings across all users for calendar display.
// Visible to every authenticated user so they can see occupied slots.
// Sensitive info (email) is hidden for non-admins; purpose is shown (needed for UX).
router.get('/calendar', auth, (req, res) => {
  const { month, year } = req.query; // optional: ?year=2025&month=6 (1-based)
  let sql = `
    SELECT b.id, b.date, b.start_time, b.end_time, b.meeting_type, b.purpose,
           b.status, b.recurring_group, b.food, b.veg_nonveg, b.user_id,
           u.name as user_name,
           r.id as room_id, r.name as room_name, r.color as room_color, r.floor as room_floor
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE b.status NOT IN ('cancelled','rejected')
  `;
  const params = [];
  if (year && month) {
    const ym = `${year}-${String(month).padStart(2,'0')}`;
    sql += ` AND b.date LIKE ?`;
    params.push(ym + '%');
  }
  sql += ' ORDER BY b.date ASC, b.start_time ASC';
  const rows = db.prepare(sql).all(...params).map(b => ({
    ...b,
    food: !!b.food,
    is_mine: b.user_id === req.user.id,
    // Hide email from non-admins but keep user name
    user_email: req.user.role === 'admin' ? (db.prepare('SELECT email FROM users WHERE id=?').get(b.user_id)||{}).email : undefined,
  }));
  res.json(rows);
});

// ─── GET /api/bookings/:id ─────────────────────────────────────────────────
router.get('/:id', auth, (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as user_name, u.email as user_email,
           r.name as room_name, r.color as room_color, r.floor as room_floor
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && b.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(formatBooking(b));
});

// ─── POST /api/bookings ────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const {
    room_id, date, start_time, end_time, meeting_type, purpose,
    persons = '', food = false, veg_nonveg = '', remarks = '',
    guest_emails = [],
    // Recurring options
    recurring = 'none',   // 'none' | 'daily' | 'weekly'
    recurring_end = null, // YYYY-MM-DD — last date for recurrence
  } = req.body;

  if (!room_id || !date || !start_time || !end_time || !meeting_type || !purpose) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (meeting_type === 'external' && food && !veg_nonveg) {
    return res.status(400).json({ error: 'Food preference required when food is requested' });
  }

  const err = validate({ room_id, date, start_time, end_time, persons });
  if (err) return res.status(422).json({ error: err });

  const status = meeting_type === 'external' ? 'pending' : 'approved';
  const guestsJson = JSON.stringify(Array.isArray(guest_emails) ? guest_emails : []);
  const recurringGroup = (recurring !== 'none' && recurring_end) ? genToken() : null;

  // Build list of dates (for recurring)
  const dates = [date];
  if (recurringGroup && recurring_end >= date) {
    let cur = date;
    const step = recurring === 'daily' ? 1 : 7;
    while (true) {
      cur = addDays(cur, step);
      if (cur > recurring_end) break;
      dates.push(cur);
    }
  }

  const room = db.prepare('SELECT name FROM rooms WHERE id = ?').get(room_id);
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all();

  const createdBookings = [];
  const insertStmt = db.prepare(`
    INSERT INTO bookings (id, user_id, room_id, date, start_time, end_time, meeting_type, purpose, persons, food, veg_nonveg, remarks, status, checkin_token, recurring_group, guest_emails)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const d of dates) {
    // Skip dates that already conflict (for recurring bookings, silently skip)
    if (d !== date) {
      const conflictErr = validate({ room_id, date: d, start_time, end_time, persons });
      if (conflictErr) continue; // skip this date
    }
    const id = genId();
    const token = genToken();
    insertStmt.run(id, req.user.id, room_id, d, start_time, end_time, meeting_type, purpose, persons, food ? 1 : 0, veg_nonveg, remarks, status, token, recurringGroup, guestsJson);
    admins.forEach(a => addNotification(a.id, 'New Booking', `${req.user.name} booked ${room.name} on ${d}`, 'info'));
    createdBookings.push(id);
  }

  // Fetch first created booking for response & email
  const firstId = createdBookings[0];
  if (!firstId) return res.status(422).json({ error: 'Could not create any bookings (all dates conflicted).' });

  const booking = db.prepare(`
    SELECT b.*, u.name as user_name, u.email as user_email,
           r.name as room_name, r.color as room_color, r.floor as room_floor
    FROM bookings b JOIN users u ON u.id = b.user_id JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?
  `).get(firstId);

  // Send emails + Slack + WhatsApp asynchronously (don't block response)
try {
  await emailSvc.sendNewBookingAdmin(formatBooking(booking));
} catch (err) {
  console.log("Email failed:", err.message);
}
  notify.slackNewBooking(formatBooking(booking)).catch(() => {});
  notify.waNewBooking(formatBooking(booking)).catch(() => {});
  if (status === 'approved') {
    emailSvc.sendApproved(formatBooking(booking)).catch(() => {});
    gcalSvc.createEvent(formatBooking(booking)).catch(() => {});
  }

  res.status(201).json({
    ...formatBooking(booking),
    recurring_count: createdBookings.length,
    recurring_ids: createdBookings,
  });
});

// ─── PATCH /api/bookings/:id/cancel ───────────────────────────────────────
router.patch('/:id/cancel', auth, async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && b.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!['approved','pending'].includes(b.status)) return res.status(400).json({ error: 'Cannot cancel this booking' });
  if (req.user.role !== 'admin' && new Date() >= new Date(`${b.date}T${b.start_time}`)) {
    return res.status(400).json({ error: 'Meeting already started.' });
  }
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);

  // Send cancellation emails
  const full = db.prepare(`SELECT b.*, u.name as user_name, u.email as user_email, r.name as room_name, r.floor as room_floor FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id WHERE b.id=?`).get(req.params.id);
  emailSvc.sendCancelled(formatBooking(full)).catch(() => {});
  notify.slackCancelled(formatBooking(full)).catch(() => {});
  notify.waCancelled(formatBooking(full)).catch(() => {});

  res.json({ message: 'Booking cancelled' });
});

// ─── PATCH /api/bookings/:id/cancel-recurring ─────────────────────────────
router.patch('/:id/cancel-recurring', auth, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (!b.recurring_group) return res.status(400).json({ error: 'Not a recurring booking' });
  if (req.user.role !== 'admin' && b.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const count = db.prepare(`
    UPDATE bookings SET status = 'cancelled'
    WHERE recurring_group = ? AND status IN ('approved','pending') AND date >= ?
  `).run(b.recurring_group, today()).changes;

  res.json({ message: `Cancelled ${count} upcoming occurrences` });
});

// ─── PATCH /api/bookings/:id/approve ──────────────────────────────────────
router.patch('/:id/approve', auth, adminOnly, async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });

  db.prepare("UPDATE bookings SET status = 'approved', approved_at = datetime('now') WHERE id = ?").run(req.params.id);
  addNotification(b.user_id, 'Booking Approved', `Your booking for ${b.date} has been approved.`, 'success');

  // Auto-reject conflicting pending bookings
  const conflicting = db.prepare(`
    SELECT id, user_id FROM bookings
    WHERE room_id = ? AND date = ? AND status = 'pending' AND id != ?
  `).all(b.room_id, b.date, b.id);
  const sm = t2m(b.start_time), em = t2m(b.end_time);
  const reason = 'Slot was taken by another approved booking for the same time.';
  let autoRejected = 0;
  conflicting.forEach(c => {
    const cb = db.prepare('SELECT start_time, end_time FROM bookings WHERE id = ?').get(c.id);
    if (t2m(cb.start_time) < em && t2m(cb.end_time) > sm) {
      db.prepare("UPDATE bookings SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(reason, c.id);
      addNotification(c.user_id, 'Booking Auto-Rejected', `Another booking was approved for the same slot on ${b.date}.`, 'error');
      autoRejected++;
    }
  });

  // Send approval email with ICS
  const full = db.prepare(`SELECT b.*, u.name as user_name, u.email as user_email, r.name as room_name, r.floor as room_floor FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id WHERE b.id=?`).get(req.params.id);
  emailSvc.sendApproved(formatBooking(full)).catch(() => {});
  notify.slackApproved(formatBooking(full)).catch(() => {});
  notify.waApproved(formatBooking(full)).catch(() => {});
  gcalSvc.createEvent(formatBooking(full)).catch(() => {});

  res.json({ message: 'Approved', auto_rejected: autoRejected });
});

// ─── PATCH /api/bookings/:id/reject ───────────────────────────────────────
router.patch('/:id/reject', auth, adminOnly, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });

  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Booking is not pending' });

  db.prepare("UPDATE bookings SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(reason, req.params.id);
  addNotification(b.user_id, 'Booking Rejected', `Reason: ${reason}`, 'error');

  const full2 = db.prepare(`SELECT b.*, u.name as user_name, u.email as user_email, r.name as room_name, r.floor as room_floor FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id WHERE b.id=?`).get(req.params.id);
  emailSvc.sendRejected({ ...formatBooking(full2), rejection_reason: reason }).catch(() => {});
  notify.slackRejected({ ...formatBooking(full2), rejection_reason: reason }).catch(() => {});
  notify.waRejected({ ...formatBooking(full2), rejection_reason: reason }).catch(() => {});

  res.json({ message: 'Rejected' });
});

// ─── GET /api/bookings/:id/qr ──────────────────────────────────────────────
// Returns a QR code PNG data URL for check-in
router.get('/:id/qr', auth, async (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && b.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const checkinUrl = `${appUrl}/checkin/${b.checkin_token}`;
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 300, margin: 2, color: { dark: '#0f172a', light: '#fff' } });
  res.json({ qr: qrDataUrl, url: checkinUrl, token: b.checkin_token });
});

// ─── GET /api/checkin/:token  (public — no auth, used by scanned QR) ───────
router.get('/checkin/:token', (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as user_name, r.name as room_name, r.floor as room_floor
    FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id
    WHERE b.checkin_token = ?
  `).get(req.params.token);
  if (!b) return res.status(404).json({ error: 'Invalid check-in link' });

  const now = new Date();
  const meetingStart = new Date(`${b.date}T${b.start_time}`);
  const meetingEnd   = new Date(`${b.date}T${b.end_time}`);
  const earlyMs = 15 * 60 * 1000; // allow check-in 15 min early

  if (now < new Date(meetingStart - earlyMs)) {
    return res.status(400).json({ error: `Too early — check-in opens at ${b.start_time} (15 min before).` });
  }
  if (now > meetingEnd) {
    return res.status(400).json({ error: 'Meeting has already ended.' });
  }
  if (b.status !== 'approved') {
    return res.status(400).json({ error: 'Booking is not approved.' });
  }
  if (b.checkin_at) {
    return res.json({ already: true, checkin_at: b.checkin_at, booking: formatBooking(b) });
  }

  db.prepare("UPDATE bookings SET checkin_at = datetime('now') WHERE checkin_token = ?").run(req.params.token);
  const updated = db.prepare(`SELECT b.*, u.name as user_name, r.name as room_name, r.floor as room_floor FROM bookings b JOIN users u ON u.id=b.user_id JOIN rooms r ON r.id=b.room_id WHERE b.checkin_token=?`).get(req.params.token);
  res.json({ success: true, booking: formatBooking(updated) });
});

module.exports = router;
