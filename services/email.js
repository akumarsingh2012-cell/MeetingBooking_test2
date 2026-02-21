// services/email.js
// Email is handled client-side via EmailJS (no SMTP config needed on server)
// The server just logs email events. Frontend calls EmailJS directly.

const db = require('../db/database');
const genId = () => `el_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function logEmail(bookingId, recipient, subject, type, status='sent', error='') {
  try {
    db.prepare(`INSERT INTO email_log (id,booking_id,recipient,subject,type,status,error) VALUES (?,?,?,?,?,?,?)`)
      .run(genId(), bookingId||null, recipient, subject, type, status, error);
  } catch(e) {}
}

// These are called by routes to log that an email should be sent
// The actual sending happens from the frontend via EmailJS
function sendNewBookingAdmin(booking)  { logEmail(booking.id, 'admin', `New Booking – ${booking.room_name}`, 'new_booking'); }
function sendApproved(booking)         { logEmail(booking.id, booking.user_email, `Approved – ${booking.room_name}`, 'approved'); }
function sendRejected(booking)         { logEmail(booking.id, booking.user_email, `Rejected – ${booking.room_name}`, 'rejected'); }
function sendCancelled(booking)        { logEmail(booking.id, booking.user_email, `Cancelled – ${booking.room_name}`, 'cancelled'); }
function sendReminder(booking)         { logEmail(booking.id, booking.user_email, `Reminder – ${booking.room_name}`, 'reminder'); }
function isConfigured()                { return false; } // EmailJS configured client-side

module.exports = { sendNewBookingAdmin, sendApproved, sendRejected, sendCancelled, sendReminder, isConfigured };
