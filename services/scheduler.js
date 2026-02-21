// services/scheduler.js  –  Background cron jobs
const cron = require('node-cron');
const db = require('../db/database');
const { sendReminder } = require('./email');

function t2m(t) { const [h, m] = (t || '0:0').split(':'); return +h * 60 + +m; }

// ─── Run every minute: check for upcoming meetings needing reminder ────────
function startReminderJob() {
  const reminderMin = parseInt(process.env.REMINDER_MINUTES || '30');

  cron.schedule('* * * * *', () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const curMin = now.getHours() * 60 + now.getMinutes();
    const targetMin = curMin + reminderMin; // send reminder when meeting is X min away

    try {
      // Find approved bookings today that haven't had reminder sent yet
      const upcoming = db.prepare(`
        SELECT b.*, u.name as user_name, u.email as user_email,
               r.name as room_name, r.floor as room_floor
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        JOIN rooms r ON r.id = b.room_id
        WHERE b.date = ? AND b.status = 'approved' AND b.reminder_sent = 0
      `).all(todayStr);

      for (const bk of upcoming) {
        const startMin = t2m(bk.start_time);
        // Send reminder if we are within [targetMin-1, targetMin+1] window
        if (Math.abs(startMin - targetMin) <= 1) {
          sendReminder(bk).catch(e => console.error('[REMINDER ERROR]', e.message));
        }
      }
    } catch (e) {
      console.error('[SCHEDULER ERROR]', e.message);
    }
  });

  console.log(`✅ Reminder scheduler started (${reminderMin} min before meetings)`);
}

module.exports = { startReminderJob };
