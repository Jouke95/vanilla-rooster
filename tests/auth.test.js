// Start de echte server tegen een tijdelijke lokale database en controleert dat zonder login niets te zien is.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooster-auth-test-'));
const PORT = String(3100 + Math.floor(Math.random() * 800));
const BASE = `http://localhost:${PORT}`;
// Lege TURSO_AUTH_TOKEN zodat dotenv de echte waarden uit .env niet gebruikt
Object.assign(process.env, { TURSO_DATABASE_URL: `file:${path.join(dir, 'test.db')}`, TURSO_AUTH_TOKEN: '', PORT });

let server;
let setPassword;
let db;
const PASSWORD = 'correct horse battery';

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: process.env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/login`); break; } catch (err) { await new Promise(r => setTimeout(r, 100)); }
  }
  ({ setPassword } = require('../auth'));
  ({ db } = require('../db'));
});

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (url, cookie) => fetch(BASE + url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const login = password => fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
const cookieFrom = res => res.headers.get('set-cookie').split(';')[0];

test('zonder login: pagina stuurt door naar /login', async () => {
  for (const url of ['/', '/index.html']) {
    const res = await get(url);
    assert.strictEqual(res.status, 302, url);
    assert.strictEqual(res.headers.get('location'), '/login', url);
  }
});

test('zonder login: inlogscherm is bereikbaar', async () => {
  const res = await get('/login');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Wachtwoord/);
});

test('zonder login: alle API-adressen geven 401', async () => {
  for (const url of ['/api/drivers', '/api/vacations', '/api/routes?week_key=2026-09-21', '/api/warehouse-shifts?week_key=2026-09-21', '/api/warehouse-templates']) {
    const res = await get(url);
    assert.strictEqual(res.status, 401, url);
  }
  const write = await fetch(`${BASE}/api/drivers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Indringer' }) });
  assert.strictEqual(write.status, 401);
});

test('zonder ingesteld wachtwoord kan niemand inloggen', async () => {
  const res = await login('');
  assert.strictEqual(res.status, 503);
});

test('fout wachtwoord wordt geweigerd', async () => {
  await setPassword(PASSWORD);
  const res = await login('fout wachtwoord');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.headers.get('set-cookie'), null);
});

test('juist wachtwoord geeft toegang met een veilige cookie', async () => {
  const res = await login(PASSWORD);
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookie, /Secure/, 'over http geen Secure, anders stuurt de browser de cookie niet terug');
  const cookie = cookieFrom(res);
  assert.strictEqual((await get('/api/drivers', cookie)).status, 200);
  assert.strictEqual((await get('/', cookie)).status, 200);

  // In de database staat alleen een hash van de sessiecode
  const token = cookie.split('=')[1];
  const sessions = await db.execute('SELECT token_hash FROM sessions');
  assert.ok(sessions.rows.length > 0);
  assert.ok(sessions.rows.every(r => r.token_hash !== token));
});

test('verzonnen sessiecode geeft geen toegang', async () => {
  assert.strictEqual((await get('/api/drivers', 'rooster_session=verzonnen')).status, 401);
});

test('uitloggen maakt de sessie ongeldig', async () => {
  const cookie = cookieFrom(await login(PASSWORD));
  const res = await fetch(`${BASE}/api/logout`, { method: 'POST', headers: { cookie } });
  assert.strictEqual(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.strictEqual((await get('/api/drivers', cookie)).status, 401);
});

test('wachtwoord wijzigen logt iedereen uit', async () => {
  const cookie = cookieFrom(await login(PASSWORD));
  await setPassword('een heel nieuw wachtwoord');
  assert.strictEqual((await get('/api/drivers', cookie)).status, 401);
  assert.strictEqual((await login(PASSWORD)).status, 401);
  await setPassword(PASSWORD);
});

// Als laatste, want na deze test is dit IP-adres 15 minuten geblokkeerd
test('na 5 foute pogingen 15 minuten geblokkeerd, ook met het juiste wachtwoord', async () => {
  // Eerdere tests deden al foute pogingen; een geslaagde login zet de teller op nul
  assert.strictEqual((await login(PASSWORD)).status, 200);
  for (let i = 0; i < 4; i++) assert.strictEqual((await login('fout')).status, 401);
  const res = await login(PASSWORD);
  assert.strictEqual(res.status, 200, 'vóór de 5e fout nog wel toegang');
  // Succesvol inloggen reset de teller; nu 5 keer fout
  for (let i = 0; i < 5; i++) await login('fout');
  const blocked = await login(PASSWORD);
  assert.strictEqual(blocked.status, 429);
  assert.match((await blocked.json()).error, /15 minuten/);
});
