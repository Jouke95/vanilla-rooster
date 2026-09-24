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
      name TEXT UNIQUE NOT NULL,
      is_driver INTEGER NOT NULL DEFAULT 1,
      is_warehouse INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS warehouse_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_key TEXT NOT NULL,
      day_index INTEGER NOT NULL,
      driver_id INTEGER NOT NULL,
      start_time TEXT,
      end_time TEXT,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
      UNIQUE (week_key, day_index, driver_id)
    );

    CREATE TABLE IF NOT EXISTS warehouse_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER NOT NULL,
      day_index INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
      UNIQUE (driver_id, day_index)
    );

    -- Standaardrooster chauffeurs: per weekdag en vaste route de vaste chauffeur
    CREATE TABLE IF NOT EXISTS route_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_index INTEGER NOT NULL,
      code TEXT NOT NULL,
      driver_id INTEGER NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
      UNIQUE (day_index, code)
    );

    -- Weken waarin het standaardrooster al is ingevuld
    CREATE TABLE IF NOT EXISTS warehouse_weeks (
      week_key TEXT PRIMARY KEY
    );

    -- Instellingen, o.a. de scrypt-hash van het gedeelde wachtwoord (key 'password_hash')
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Inlogsessies; token_hash is een sha256 van de sessiecode in de cookie
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );
  `);

  // Migraties voor databases die zijn aangemaakt vóór deze kolommen bestonden
  await addColumnIfMissing('vacations', 'type', "TEXT NOT NULL DEFAULT 'vacation'");
  await addColumnIfMissing('drivers', 'is_driver', 'INTEGER NOT NULL DEFAULT 1');
  await addColumnIfMissing('drivers', 'is_warehouse', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing('warehouse_shifts', 'start_time', 'TEXT');
  await addColumnIfMissing('warehouse_shifts', 'end_time', 'TEXT');
}

async function addColumnIfMissing(table, column, definition) {
  const columns = await db.execute(`PRAGMA table_info(${table})`);
  if (!columns.rows.some((col) => col.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = { db, initSchema };