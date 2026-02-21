// services/notify.js  –  Slack & WhatsApp (Twilio) notifications
const axios = require('axios');
const db = require('../db/database');

// ─── Helpers ───────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

function ft(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hh = +h, ap = hh >= 12 ? 'PM' : 'AM';
  return (hh % 12 || 12) + ':' + m + ' ' + ap;
}

function statusEmoji(status) {
  return { approved: '✅', pending: '⏳', rejected: '❌', cancelled: '🚫' }[status] || '📋';
}

// ═══════════════════════════════════════════════════════════════════════════
// SLACK
// ═══════════════════════════════════════════════════════════════════════════

function getSlackWebhook() { return getSetting('slack_webhook'); }
function isSlackConfigured() { return !!getSlackWebhook(); }

async function sendSlack(payload) {
  const webhook = getSlackWebhook();
  if (!webhook) return { skipped: true };
  try {
    await axios.post(webhook, payload, { timeout: 8000 });
    console.log('[SLACK ✅]', payload.text || 'notification sent');
    return { sent: true };
  } catch (err) {
    console.error('[SLACK ❌]', err.message);
    return { sent: false, error: err.message };
  }
}

// Slack block-kit formatted booking message
function bookingBlocks(booking, title, color) {
  const foodStr = booking.food ? ` · 🍽️ ${booking.veg_nonveg || 'Food'}` : '';
  const guestCount = (booking.guest_emails || []).length;
  return {
    attachments: [{
      color,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: title, emoji: true }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Room:*\n${booking.room_name}${booking.room_floor ? ' · ' + booking.room_floor : ''}` },
            { type: 'mrkdwn', text: `*Date:*\n${booking.date}` },
            { type: 'mrkdwn', text: `*Time:*\n${ft(booking.start_time)} – ${ft(booking.end_time)}` },
            { type: 'mrkdwn', text: `*Booked By:*\n${booking.user_name}` },
            { type: 'mrkdwn', text: `*Type:*\n${booking.meeting_type}${foodStr}` },
            { type: 'mrkdwn', text: `*Status:*\n${statusEmoji(booking.status)} ${booking.status.toUpperCase()}` },
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Purpose:* ${booking.purpose}${guestCount ? `\n*Guests:* ${guestCount} invited` : ''}${booking.rejection_reason ? `\n*Reason:* ${booking.rejection_reason}` : ''}` }
        },
        { type: 'divider' },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `SLMG Meeting Room Booking System · ${new Date().toLocaleString('en-IN')}` }]
        }
      ]
    }]
  };
}

async function slackNewBooking(booking) {
  return sendSlack(bookingBlocks(booking, '📅 New Booking Request', booking.meeting_type === 'external' ? '#FFA500' : '#36C5F0'));
}

async function slackApproved(booking) {
  return sendSlack(bookingBlocks(booking, '✅ Booking Approved', '#2EB67D'));
}

async function slackRejected(booking) {
  return sendSlack(bookingBlocks(booking, '❌ Booking Rejected', '#E01E5A'));
}

async function slackCancelled(booking) {
  return sendSlack(bookingBlocks(booking, '🚫 Booking Cancelled', '#ECB22E'));
}

async function slackReminder(booking) {
  const mins = process.env.REMINDER_MINUTES || 30;
  return sendSlack({
    attachments: [{
      color: '#3d6ce7',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `⏰ Meeting in ${mins} minutes!`, emoji: true } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Room:*\n${booking.room_name}` },
            { type: 'mrkdwn', text: `*Time:*\n${ft(booking.start_time)} – ${ft(booking.end_time)}` },
            { type: 'mrkdwn', text: `*Booked By:*\n${booking.user_name}` },
            { type: 'mrkdwn', text: `*Purpose:*\n${booking.purpose}` },
          ]
        }
      ]
    }]
  });
}

async function slackWaitlistNotify(entry, booking) {
  return sendSlack({
    attachments: [{
      color: '#2EB67D',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🔔 Waitlist Slot Available!', emoji: true } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${entry.user_name}*, a slot has opened for *${booking.room_name}* on *${entry.date}* from *${ft(entry.start_time)}* to *${ft(entry.end_time)}.* Book now before it's taken!` }
        }
      ]
    }]
  });
}

async function slackAmenityRequest(req, booking) {
  const items = Array.isArray(req.items) ? req.items.join(', ') : req.items;
  return sendSlack({
    attachments: [{
      color: '#7c3aed',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🔧 Amenity Request', emoji: true } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Room:*\n${booking.room_name}` },
            { type: 'mrkdwn', text: `*Date:*\n${booking.date}` },
            { type: 'mrkdwn', text: `*Requested By:*\n${req.user_name}` },
            { type: 'mrkdwn', text: `*Items:*\n${items}` },
          ]
        },
        req.notes ? { type: 'section', text: { type: 'mrkdwn', text: `*Notes:* ${req.notes}` } } : null,
      ].filter(Boolean)
    }]
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP (Twilio)
// ═══════════════════════════════════════════════════════════════════════════

function getTwilioConfig() {
  return {
    sid:   getSetting('twilio_sid')   || process.env.TWILIO_SID,
    token: getSetting('twilio_token') || process.env.TWILIO_TOKEN,
    from:  getSetting('twilio_from')  || process.env.TWILIO_FROM,  // whatsapp:+14155238886
    to:    getSetting('twilio_to')    || process.env.TWILIO_TO,    // whatsapp:+91xxxxxxxxxx (admin)
  };
}

function isWhatsAppConfigured() {
  const c = getTwilioConfig();
  return !!(c.sid && c.token && c.from && c.to);
}

async function sendWhatsApp(message) {
  const c = getTwilioConfig();
  if (!c.sid || !c.token || !c.from || !c.to) return { skipped: true };
  try {
    const res = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`,
      new URLSearchParams({ From: c.from, To: c.to, Body: message }).toString(),
      {
        auth: { username: c.sid, password: c.token },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
    console.log('[WHATSAPP ✅] Message sent');
    return { sent: true };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('[WHATSAPP ❌]', msg);
    return { sent: false, error: msg };
  }
}

function waBookingMsg(booking, eventTitle) {
  const foodStr = booking.food ? `\n🍽️ Food: ${booking.veg_nonveg || 'Yes'}` : '';
  return `${eventTitle}\n\n🏢 *${booking.room_name}*${booking.room_floor ? ' · ' + booking.room_floor : ''}\n📅 ${booking.date}\n⏰ ${ft(booking.start_time)} – ${ft(booking.end_time)}\n👤 ${booking.user_name} (${booking.user_email})${foodStr}\n🎯 ${booking.purpose}${booking.rejection_reason ? '\n❌ Reason: ' + booking.rejection_reason : ''}\n\n_SLMG Meeting Room Booking_`;
}

async function waNewBooking(booking) { return sendWhatsApp(waBookingMsg(booking, '📅 *New Booking Request*')); }
async function waApproved(booking)   { return sendWhatsApp(waBookingMsg(booking, '✅ *Booking Approved*')); }
async function waRejected(booking)   { return sendWhatsApp(waBookingMsg(booking, '❌ *Booking Rejected*')); }
async function waCancelled(booking)  { return sendWhatsApp(waBookingMsg(booking, '🚫 *Booking Cancelled*')); }
async function waReminder(booking) {
  const mins = process.env.REMINDER_MINUTES || 30;
  return sendWhatsApp(`⏰ *Meeting Reminder*\n\nYour meeting in *${booking.room_name}* starts in *${mins} minutes!*\n⏰ ${ft(booking.start_time)} – ${ft(booking.end_time)}\n🎯 ${booking.purpose}\n\n_SLMG Meeting Room Booking_`);
}
async function waWaitlistNotify(entry) {
  return sendWhatsApp(`🔔 *Waitlist Alert!*\n\nA slot opened for *${entry.room_name}*\n📅 ${entry.date} | ⏰ ${ft(entry.start_time)} – ${ft(entry.end_time)}\n\nBook now before it's taken!\n\n_SLMG Meeting Room Booking_`);
}

module.exports = {
  // Slack
  isSlackConfigured,
  slackNewBooking, slackApproved, slackRejected, slackCancelled, slackReminder, slackWaitlistNotify, slackAmenityRequest,
  // WhatsApp
  isWhatsAppConfigured,
  isWaConfigured: isWhatsAppConfigured, // alias used by settings route
  waNewBooking, waApproved, waRejected, waCancelled, waReminder, waWaitlistNotify,
};
