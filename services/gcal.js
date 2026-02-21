// services/gcal.js  –  Google Calendar integration
// Uses Service Account (recommended for server-side, no user OAuth needed)
// OR falls back to API key for read-only / event creation via domain-wide delegation
const { google } = require('googleapis');
const db = require('../db/database');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (process.env[key.toUpperCase()] || '');
}

function isConfigured() {
  return !!(getSetting('gcal_client_id') && getSetting('gcal_client_secret') && getSetting('gcal_refresh_token'));
}

function getOAuth2Client() {
  const clientId     = getSetting('gcal_client_id');
  const clientSecret = getSetting('gcal_client_secret');
  const refreshToken = getSetting('gcal_refresh_token');
  const redirectUri  = (process.env.APP_URL || 'http://localhost:3000') + '/api/gcal/callback';

  if (!clientId || !clientSecret) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  if (refreshToken) auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

// Build Google OAuth consent URL (admin visits this once to grant permission)
function getAuthUrl() {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
  });
}

// Exchange auth code for tokens (called by /api/gcal/callback)
async function exchangeCode(code) {
  const auth = getOAuth2Client();
  if (!auth) throw new Error('Google OAuth not configured');
  const { tokens } = await auth.getToken(code);
  // Save refresh token to settings
  if (tokens.refresh_token) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('gcal_refresh_token', tokens.refresh_token);
  }
  return tokens;
}

// Create a calendar event and return the event ID
async function createEvent(booking) {
  if (!isConfigured()) return null;
  try {
    const auth = getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = getSetting('gcal_calendar_id') || 'primary';
    const guests = (booking.guest_emails || []).map(e => ({ email: e }));

    const event = await calendar.events.insert({
      calendarId,
      sendUpdates: 'all', // sends Google Calendar invites to attendees
      resource: {
        summary: `[${booking.room_name}] ${booking.purpose}`,
        location: `${booking.room_name}${booking.room_floor ? ', ' + booking.room_floor : ''} – SLMG Beverages`,
        description: `Meeting booked by ${booking.user_name} (${booking.user_email})\nType: ${booking.meeting_type}\nPersons: ${booking.persons || 'N/A'}\n\nBooked via SLMG Meeting Room Booking System`,
        start: {
          dateTime: `${booking.date}T${booking.start_time}:00`,
          timeZone: 'Asia/Kolkata',
        },
        end: {
          dateTime: `${booking.date}T${booking.end_time}:00`,
          timeZone: 'Asia/Kolkata',
        },
        attendees: [
          { email: booking.user_email, displayName: booking.user_name },
          ...guests,
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: parseInt(process.env.REMINDER_MINUTES || '30') },
          ],
        },
        colorId: '1', // Lavender — can be customized
      },
    });

    console.log('[GCAL ✅] Event created:', event.data.id);
    return event.data.id;
  } catch (err) {
    console.error('[GCAL ❌]', err.message);
    return null;
  }
}

// Update an existing event
async function updateEvent(eventId, booking) {
  if (!isConfigured() || !eventId) return null;
  try {
    const auth = getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = getSetting('gcal_calendar_id') || 'primary';

    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: 'all',
      resource: {
        summary: `[${booking.room_name}] ${booking.purpose}`,
        start: { dateTime: `${booking.date}T${booking.start_time}:00`, timeZone: 'Asia/Kolkata' },
        end:   { dateTime: `${booking.date}T${booking.end_time}:00`,   timeZone: 'Asia/Kolkata' },
      },
    });
    return eventId;
  } catch (err) {
    console.error('[GCAL UPDATE ❌]', err.message);
    return null;
  }
}

// Cancel/delete an event
async function cancelEvent(eventId) {
  if (!isConfigured() || !eventId) return;
  try {
    const auth = getOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = getSetting('gcal_calendar_id') || 'primary';
    await calendar.events.delete({ calendarId, eventId, sendUpdates: 'all' });
    console.log('[GCAL ✅] Event cancelled:', eventId);
  } catch (err) {
    console.error('[GCAL DELETE ❌]', err.message);
  }
}

module.exports = { isConfigured, getAuthUrl, exchangeCode, createEvent, updateEvent, cancelEvent };
