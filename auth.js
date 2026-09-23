// Inloggen met één gedeeld wachtwoord. De scrypt-hash staat in settings; sessies staan in de tabel sessions
// (alleen een sha256-hash van de sessiecode, zodat een gelekte database geen bruikbare sessies bevat).
const crypto = require('crypto');
const { db } = require('./db');

const COOKIE_NAME = 'rooster_session';
const SESSION_DAYS = 7;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// Nieuw wachtwoord instellen; iedereen wordt uitgelogd
async function setPassword(password) {
  await db.batch([
    { sql: "INSERT INTO settings (key, value) VALUES ('password_hash', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", args: [hashPassword(password)] },
    'DELETE FROM sessions',
  ], 'write');
}

function readSessionToken(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i === -1 ? [part.trim(), ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }));
  return cookies[COOKIE_NAME] || null;
}

function sessionCookie(req, token, maxAgeSeconds) {
  // Secure alleen als de verbinding https is, anders zou de browser de cookie over http niet terugsturen
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${req.secure ? '; Secure' : ''}`;
}

async function isLoggedIn(req) {
  const token = readSessionToken(req);
  if (!token) return false;
  const result = await db.execute({
    sql: "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')",
    args: [sha256(token)],
  });
  return result.rows.length > 0;
}

// Mislukte pogingen per IP-adres, alleen in het geheugen (na een herstart begint de telling opnieuw)
const failedAttempts = new Map();

function lockoutMinutesLeft(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry || entry.count < MAX_ATTEMPTS) return 0;
  const msLeft = entry.lockedAt + LOCKOUT_MINUTES * 60000 - Date.now();
  if (msLeft <= 0) { failedAttempts.delete(ip); return 0; }
  return Math.ceil(msLeft / 60000);
}

function registerFailure(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedAt: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedAt = Date.now();
  failedAttempts.set(ip, entry);
}

async function login(req, res) {
  const minutesLeft = lockoutMinutesLeft(req.ip);
  if (minutesLeft > 0) {
    return res.status(429).json({ error: `Te veel mislukte pogingen. Probeer het over ${minutesLeft} ${minutesLeft === 1 ? 'minuut' : 'minuten'} opnieuw.` });
  }
  const stored = await db.execute("SELECT value FROM settings WHERE key = 'password_hash'");
  if (stored.rows.length === 0) {
    return res.status(503).json({ error: 'Er is nog geen wachtwoord ingesteld. Doe dat op de server met: npm run set-password' });
  }
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!verifyPassword(password, stored.rows[0].value)) {
    registerFailure(req.ip);
    return res.status(401).json({ error: 'Onjuist wachtwoord' });
  }
  failedAttempts.delete(req.ip);

  const token = crypto.randomBytes(32).toString('base64url');
  await db.batch([
    "DELETE FROM sessions WHERE expires_at <= datetime('now')",
    { sql: `INSERT INTO sessions (token_hash, expires_at) VALUES (?, datetime('now', '+${SESSION_DAYS} days'))`, args: [sha256(token)] },
  ], 'write');
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
  res.json({ ok: true });
}

async function logout(req, res) {
  const token = readSessionToken(req);
  if (token) await db.execute({ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [sha256(token)] });
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.status(204).send();
}

// Alles hierna alleen voor ingelogde gebruikers: API geeft 401, pagina's sturen door naar het inlogscherm
async function requireLogin(req, res, next) {
  if (await isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'niet ingelogd' });
  res.redirect('/login');
}

module.exports = { login, logout, requireLogin, setPassword, hashPassword, verifyPassword };
