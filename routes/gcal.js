// routes/gcal.js  –  Google Calendar OAuth + sync endpoints
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { auth, adminOnly } = require('../middleware/auth');
const gcal = require('../services/gcal');

// GET /api/gcal/status  –  is Google Calendar configured?
router.get('/status', auth, adminOnly, (req, res) => {
  res.json({
    configured: gcal.isConfigured(),
    auth_url: gcal.getAuthUrl(),
    calendar_id: db.prepare("SELECT value FROM settings WHERE key='gcal_calendar_id'").get()?.value || 'primary',
  });
});

// GET /api/gcal/callback  –  OAuth redirect handler (admin visits this URL once)
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`<h3>❌ Google Calendar auth failed: ${error}</h3><a href="/">Back to App</a>`);
  if (!code) return res.status(400).send('<h3>No code provided</h3>');

  try {
    await gcal.exchangeCode(code);
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>✅ Google Calendar Connected!</h2>
        <p>Bookings will now be automatically synced to Google Calendar.</p>
        <a href="/" style="background:#3d6ce7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Return to App</a>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`<h3>❌ Error: ${err.message}</h3><a href="/">Back</a>`);
  }
});

// PUT /api/gcal/settings  –  save calendar settings
router.put('/settings', auth, adminOnly, (req, res) => {
  const { gcal_client_id, gcal_client_secret, gcal_calendar_id } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (gcal_client_id)     upsert.run('gcal_client_id', gcal_client_id);
  if (gcal_client_secret) upsert.run('gcal_client_secret', gcal_client_secret);
  if (gcal_calendar_id)   upsert.run('gcal_calendar_id', gcal_calendar_id || 'primary');
  // Reset refresh token so admin re-auths with new credentials
  if (gcal_client_id || gcal_client_secret) {
    upsert.run('gcal_refresh_token', '');
  }
  res.json({ message: 'Saved. Now visit the Auth URL to connect your Google account.', auth_url: gcal.getAuthUrl() });
});

module.exports = router;
