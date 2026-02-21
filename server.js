// server.js  –  Main entry point
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/rooms',         require('./routes/rooms'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/waitlist',      require('./routes/waitlist'));
app.use('/api/amenities',     require('./routes/amenities'));
app.use('/api/gcal',          require('./routes/gcal'));

// ─── Public check-in page ─────────────────────────────────────────────────
app.get('/checkin/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'checkin.html'));
});

// ─── Frontend ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error Handler ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 MeetingBook server → http://localhost:${PORT}`);
  console.log(`   Email  : ${process.env.SMTP_USER ? '✅ ' + process.env.SMTP_USER : '⚠️  Not configured'}`);
  console.log(`   Slack  : ${process.env.SLACK_WEBHOOK ? '✅ configured' : '⚠️  Not configured'}`);
  console.log(`   WA     : ${process.env.TWILIO_SID ? '✅ configured' : '⚠️  Not configured'}\n`);

  try { require('./services/scheduler').startReminderJob(); } catch(e) { console.warn('[SCHEDULER]', e.message); }
});
