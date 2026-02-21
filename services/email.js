// services/email.js
// Email is handled client-side via EmailJS (no SMTP config needed on server)
// The server just logs email events.

const db = require('../db/database');

const genId = () => `el_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

function logEmail(bookingId, recipient, subject, type, status='sent', error='') {
  try {
    db.prepare(`
      INSERT INTO email_log (id,booking_id,recipient,subject,type,status,error)
      VALUES (?,?,?,?,?,?,?)
    `).run(genId(), bookingId || null, recipient, subject, type, status, error);
  } catch (e) {
    console.error("Email log failed:", e.message);
  }
}

/* 
   IMPORTANT:
   All functions now return Promise.
   So routes can safely use .catch() or await.
*/

async function sendNewBookingAdmin(booking) {
  logEmail(booking.id, 'admin', `New Booking – ${booking.room_name}`, 'new_booking');
  return Promise.resolve();
}

async function sendApproved(booking) {
  logEmail(booking.id, booking.user_email, `Approved – ${booking.room_name}`, 'approved');
  return Promise.resolve();
}

async function sendRejected(booking) {
  logEmail(booking.id, booking.user_email, `Rejected – ${booking.room_name}`, 'rejected');
  return Promise.resolve();
}

async function sendCancelled(booking) {
  logEmail(booking.id, booking.user_email, `Cancelled – ${booking.room_name}`, 'cancelled');
  return Promise.resolve();
}

async function sendReminder(booking) {
  logEmail(booking.id, booking.user_email, `Reminder – ${booking.room_name}`, 'reminder');
  return Promise.resolve();
}

function isConfigured() {
  return false; // EmailJS configured client-side
}

module.exports = {
  sendNewBookingAdmin,
  sendApproved,
  sendRejected,
  sendCancelled,
  sendReminder,
  isConfigured
};
