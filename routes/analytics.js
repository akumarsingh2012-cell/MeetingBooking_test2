// routes/analytics.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');

// GET /api/analytics/summary  (admin only)
router.get('/summary', auth, adminOnly, (req, res) => {
  const total    = db.prepare("SELECT COUNT(*) as c FROM bookings").get().c;
  const approved = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'approved'").get().c;
  const pending  = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'pending'").get().c;
  const cancelled_rejected = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status IN ('cancelled','rejected')").get().c;
  const food_requests = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'approved' AND food = 1").get().c;

  // Room utilization
  const roomStats = db.prepare(`
    SELECT r.id, r.name, r.color,
      COUNT(b.id) as booking_count
    FROM rooms r
    LEFT JOIN bookings b ON b.room_id = r.id AND b.status = 'approved'
    GROUP BY r.id ORDER BY booking_count DESC
  `).all();

  // Meeting types
  const internal = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='approved' AND meeting_type='internal'").get().c;
  const external = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='approved' AND meeting_type='external'").get().c;

  // Peak hours (approved bookings by hour)
  const hourRows = db.prepare(`
    SELECT substr(start_time, 1, 2) as hr, COUNT(*) as c
    FROM bookings WHERE status = 'approved'
    GROUP BY hr ORDER BY hr
  `).all();

  const peakHours = Array.from({ length: 11 }, (_, i) => {
    const hr = String(i + 9).padStart(2, '0');
    const found = hourRows.find(r => r.hr === hr);
    return { hour: `${9 + i}:00`, count: found ? found.c : 0 };
  });

  // Monthly trend
  const monthRows = db.prepare(`
    SELECT substr(date, 1, 7) as month, COUNT(*) as c
    FROM bookings WHERE status = 'approved'
    GROUP BY month ORDER BY month
  `).all();

  res.json({ total, approved, pending, cancelled_rejected, food_requests, roomStats, internal, external, peakHours, monthRows });
});

// GET /api/analytics/export  (admin only) — returns all rows as JSON for CSV/Excel
router.get('/export', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT
      b.date, b.start_time, b.end_time,
      r.name as room, r.floor,
      u.name as booked_by, u.email, u.phone, u.dept,
      b.meeting_type, b.persons, b.food, b.veg_nonveg,
      b.purpose, b.remarks, b.status, b.rejection_reason,
      b.created_at
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    ORDER BY b.date DESC, b.start_time DESC
  `).all();

  res.json(rows.map(r => ({ ...r, food: r.food ? 'Yes' : 'No' })));
});

module.exports = router;
