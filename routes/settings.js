// routes/settings.js
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');

// GET /api/settings
router.get('/', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  res.json(out);
});

// PUT /api/settings
router.put('/', auth, adminOnly, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const txn = db.transaction((pairs) => {
    for (const [k, v] of Object.entries(pairs)) upsert.run(k, String(v));
  });
  txn(req.body);
  res.json({ message: 'Settings saved' });
});

// POST /api/settings/test-slack
router.post('/test-slack', auth, adminOnly, async (req, res) => {
  const notify = require('../services/notify');
  if (!notify.isSlackConfigured()) return res.status(400).json({ error: 'Slack webhook not configured.' });
  try {
    await notify.slackNewBooking({
      user_name: req.user.name, user_email: req.user.email,
      room_name: 'Test Room', room_floor: '2nd Floor',
      date: new Date().toISOString().split('T')[0],
      start_time: '10:00', end_time: '11:00',
      meeting_type: 'internal', purpose: 'Slack integration test',
      status: 'approved', food: false, guest_emails: [],
    });
    res.json({ message: 'Test message sent to Slack!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/settings/test-whatsapp
router.post('/test-whatsapp', auth, adminOnly, async (req, res) => {
  const notify = require('../services/notify');
  if (!notify.isWaConfigured()) return res.status(400).json({ error: 'WhatsApp not configured. Save Twilio credentials first.' });
  try {
    await notify.waNewBooking({
      user_name: req.user.name, user_email: req.user.email,
      room_name: 'Test Room', room_floor: '2nd Floor',
      date: new Date().toISOString().split('T')[0],
      start_time: '10:00', end_time: '11:00',
      meeting_type: 'internal', purpose: '✅ WhatsApp test — everything is working!',
      status: 'approved', food: false, guest_emails: [],
    });
    res.json({ message: 'Test WhatsApp message sent!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/settings/email-log
router.get('/email-log', auth, adminOnly, (req, res) => {
  const logs = db.prepare('SELECT * FROM email_log ORDER BY sent_at DESC LIMIT 100').all();
  res.json(logs);
});

module.exports = router;
