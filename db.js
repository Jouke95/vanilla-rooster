require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initSchema() {
  await db.executeMultiple(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vacations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'vacation',
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_key TEXT NOT NULL,
      day_index INTEGER NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      driver_id INTEGER,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
    );
  `);

  // Migratie voor databases die zijn aangemaakt vóór de 'type'-kolom bestond
  const columns = await db.execute('PRAGMA table_info(vacations)');
  if (!columns.rows.some((col) => col.name === 'type')) {
    await db.execute("ALTER TABLE vacations ADD COLUMN type TEXT NOT NULL DEFAULT 'vacation'");
  }
}

module.exports = { db, initSchema };