// db/database.js  –  SQLite schema & singleton connection
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || './data/mrb.sqlite';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'employee',
    active      INTEGER NOT NULL DEFAULT 1,
    phone       TEXT DEFAULT '',
    dept        TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    capacity    INTEGER NOT NULL DEFAULT 10,
    color       TEXT NOT NULL DEFAULT '#3d6ce7',
    blocked     INTEGER NOT NULL DEFAULT 0,
    max_dur     INTEGER NOT NULL DEFAULT 240,
    floor       TEXT DEFAULT '',
    amenities   TEXT DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id),
    room_id           TEXT NOT NULL REFERENCES rooms(id),
    date              TEXT NOT NULL,
    start_time        TEXT NOT NULL,
    end_time          TEXT NOT NULL,
    meeting_type      TEXT NOT NULL DEFAULT 'internal',
    purpose           TEXT NOT NULL,
    persons           TEXT DEFAULT '',
    food              INTEGER NOT NULL DEFAULT 0,
    veg_nonveg        TEXT DEFAULT '',
    remarks           TEXT DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'approved',
    rejection_reason  TEXT DEFAULT '',
    approved_at       TEXT DEFAULT NULL,
    checkin_at        TEXT DEFAULT NULL,
    checkin_token     TEXT DEFAULT NULL,
    recurring_group   TEXT DEFAULT NULL,
    reminder_sent     INTEGER NOT NULL DEFAULT 0,
    guest_emails      TEXT DEFAULT '[]',
    gcal_event_id     TEXT DEFAULT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS waitlist (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    room_id     TEXT NOT NULL REFERENCES rooms(id),
    date        TEXT NOT NULL,
    start_time  TEXT NOT NULL,
    end_time    TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    notified    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS amenity_requests (
    id          TEXT PRIMARY KEY,
    booking_id  TEXT NOT NULL REFERENCES bookings(id),
    user_id     TEXT NOT NULL REFERENCES users(id),
    room_id     TEXT NOT NULL REFERENCES rooms(id),
    items       TEXT NOT NULL DEFAULT '[]',
    notes       TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    admin_note  TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'info',
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id          TEXT PRIMARY KEY,
    booking_id  TEXT,
    recipient   TEXT NOT NULL,
    subject     TEXT NOT NULL,
    type        TEXT NOT NULL,
    sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
    status      TEXT NOT NULL DEFAULT 'sent',
    error       TEXT DEFAULT ''
  );
`);

// ─── Safe column migrations ───────────────────────────────────────────────
const safeAddCol = (table, col, def) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch {}
};
safeAddCol('bookings', 'checkin_at',      'TEXT DEFAULT NULL');
safeAddCol('bookings', 'checkin_token',   'TEXT DEFAULT NULL');
safeAddCol('bookings', 'recurring_group', 'TEXT DEFAULT NULL');
safeAddCol('bookings', 'reminder_sent',   'INTEGER NOT NULL DEFAULT 0');
safeAddCol('bookings', 'guest_emails',    "TEXT DEFAULT '[]'");
safeAddCol('bookings', 'gcal_event_id',   'TEXT DEFAULT NULL');

// ─── Seed ─────────────────────────────────────────────────────────────────
function seed() {
  const adminEmail = process.env.ADMIN_EMAIL || 'abhishek.s@slmgbev.com';
  const adminName  = process.env.ADMIN_NAME  || 'Abhishek';
  const adminPass  = process.env.ADMIN_PASSWORD || 'admin@123';

  // Check if ANY admin exists
  const anyAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();

  if (!anyAdmin) {
    // Fresh install — seed first admin
    const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare(`INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, 'admin')`)
      .run(id, adminName, adminEmail, hash);
    console.log('✅ Admin seeded: ' + adminEmail);
  } else {
    // Admin exists — make sure the target email is active and password works
    const target = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
    if (!target) {
      // Email changed — update the existing admin's email + name
      db.prepare("UPDATE users SET email = ?, name = ?, active = 1 WHERE role = 'admin'")
        .run(adminEmail, adminName);
      console.log('✅ Admin email updated to: ' + adminEmail);
    } else if (!target.active) {
      db.prepare("UPDATE users SET active = 1 WHERE email = ?").run(adminEmail);
      console.log('✅ Admin re-activated: ' + adminEmail);
    }
  }
  const roomCount = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
  if (roomCount === 0) {
    const rooms = [
      { name: 'Conference Room', cap: 20, color: '#3d6ce7', max_dur: 480, floor: '2nd Floor', amen: ['Projector','Video Call','Whiteboard','AC'] },
      { name: 'Meeting Room 1',  cap: 10, color: '#16a34a', max_dur: 240, floor: '1st Floor', amen: ['TV Screen','Whiteboard','AC'] },
      { name: 'Meeting Room 2',  cap: 8,  color: '#7c3aed', max_dur: 240, floor: '1st Floor', amen: ['TV Screen','AC'] },
      { name: 'Board Room',      cap: 15, color: '#dc2626', max_dur: 480, floor: '3rd Floor', amen: ['Projector','Video Call','Catering','AC'] },
    ];
    const ins = db.prepare(`INSERT INTO rooms (id, name, capacity, color, max_dur, floor, amenities) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    rooms.forEach(r => {
      const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      ins.run(id, r.name, r.cap, r.color, r.max_dur, r.floor, JSON.stringify(r.amen));
    });
    console.log('✅ Default rooms seeded');
  }
}

seed();
module.exports = db;
