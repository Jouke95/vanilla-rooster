// Start de echte server tegen een tijdelijke lokale database en controleert het standaardrooster voor chauffeurs.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooster-routes-test-'));
const PORT = String(4000 + Math.floor(Math.random() * 800)); // andere reeks dan auth.test.js, die tegelijk draait
const BASE = `http://localhost:${PORT}`;
// Lege TURSO_AUTH_TOKEN zodat dotenv de echte waarden uit .env niet gebruikt
Object.assign(process.env, { TURSO_DATABASE_URL: `file:${path.join(dir, 'test.db')}`, TURSO_AUTH_TOKEN: '', PORT });

let server;
let db;
let cookie;
const WEEK = '2026-10-05'; // maandag, geen feestdagen

const call = (method, url, body) => fetch(BASE + url, {
  method,
  headers: { 'Content-Type': 'application/json', cookie },
  body: body ? JSON.stringify(body) : undefined,
});

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: process.env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/login`); break; } catch (err) { await new Promise(r => setTimeout(r, 100)); }
  }
  await require('../auth').setPassword('test');
  ({ db } = require('../db'));
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];

  // Ad en Bert rijden, Cor zit alleen in het magazijn
  await db.execute("INSERT INTO drivers (id, name, is_driver, is_warehouse) VALUES (1, 'Ad', 1, 0), (2, 'Bert', 1, 0), (3, 'Cor', 0, 1)");
});

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function driverOf(id) {
  const result = await db.execute({ sql: 'SELECT driver_id FROM routes WHERE id = ?', args: [id] });
  return result.rows[0].driver_id;
}

test('vaste routes per chauffeur opslaan en weer ophalen', async () => {
  const put = (id, routes) => call('PUT', `/api/route-templates/${id}`, { routes });
  assert.strictEqual((await put(1, [{ day_index: 0, code: 'Rotterdam' }, { day_index: 2, code: 'Zeeland' }, { day_index: 1, code: 'Rotterdam' }])).status, 200);
  await put(2, [{ day_index: 1, code: 'Rotterdam' }, { day_index: 4, code: 'Den Haag' }]);
  await put(3, [{ day_index: 3, code: 'Noord' }]);
  const rows = await (await call('GET', '/api/route-templates')).json();
  assert.deepStrictEqual(rows, [
    { day_index: 0, code: 'Rotterdam', driver_id: 1 },
    { day_index: 1, code: 'Rotterdam', driver_id: 2 },
    { day_index: 2, code: 'Zeeland', driver_id: 1 },
    { day_index: 3, code: 'Noord', driver_id: 3 },
    { day_index: 4, code: 'Den Haag', driver_id: 2 },
  ], 'dinsdag Rotterdam is overgegaan van Ad naar Bert');
});

test('ongeldige vaste route wordt geweigerd', async () => {
  const res = await call('PUT', '/api/route-templates/1', { routes: [{ day_index: 7, code: 'X' }] });
  assert.strictEqual(res.status, 400);
});

test('invullen: alleen lege routes, niet bij vakantie, feestdag of wie geen chauffeur meer is', async () => {
  await db.execute(`INSERT INTO routes (id, week_key, day_index, code, driver_id) VALUES
    (1, '${WEEK}', 0, 'Rotterdam', NULL),
    (2, '${WEEK}', 1, 'Rotterdam', 1),
    (3, '${WEEK}', 2, 'Zeeland', NULL),
    (4, '${WEEK}', 3, 'Noord', NULL),
    (5, '${WEEK}', 4, 'Den Haag', NULL),
    (6, '${WEEK}', 0, 'Extra', NULL),
    (7, '2026-10-12', 0, 'Rotterdam', NULL)`);
  // Ad heeft woensdag vakantie
  await db.execute("INSERT INTO vacations (driver_id, start_date, end_date, type) VALUES (1, '2026-10-07', '2026-10-07', 'vacation')");

  const res = await call('POST', '/api/routes/apply-template', { week_key: WEEK, skip_days: [4] });
  assert.deepStrictEqual(await res.json(), { updated: 1 });
  assert.strictEqual(await driverOf(1), 1, 'maandag Rotterdam krijgt Ad');
  assert.strictEqual(await driverOf(2), 1, 'met de hand toegewezen route blijft staan');
  assert.strictEqual(await driverOf(3), null, 'Ad heeft woensdag vakantie');
  assert.strictEqual(await driverOf(4), null, 'Cor is geen chauffeur');
  assert.strictEqual(await driverOf(5), null, 'vrijdag is overgeslagen (feestdag)');
  assert.strictEqual(await driverOf(6), null, 'route zonder standaardrooster blijft leeg');
  assert.strictEqual(await driverOf(7), null, 'andere week blijft ongemoeid');
});

test('route van iemand die geen chauffeur meer is, wordt opnieuw ingevuld', async () => {
  await db.execute("UPDATE routes SET driver_id = 3 WHERE id = 5");
  await call('POST', '/api/routes/apply-template', { week_key: WEEK });
  assert.strictEqual(await driverOf(5), 2, 'vrijdag Den Haag krijgt Bert');
});

test('toepassen voor één chauffeur: ook over iemand anders heen, niet als hij vrij is of op een feestdag', async () => {
  await call('PUT', '/api/route-templates/1', { routes: [{ day_index: 0, code: 'Rotterdam' }, { day_index: 2, code: 'Zeeland' }, { day_index: 4, code: 'Den Haag' }] });
  await db.execute("UPDATE routes SET driver_id = 2 WHERE id IN (1, 5)");
  await db.execute("UPDATE routes SET driver_id = NULL WHERE id = 3");
  const res = await call('POST', '/api/routes/apply-template/1', { week_key: WEEK, skip_days: [4] });
  assert.deepStrictEqual(await res.json(), { updated: 1 });
  assert.strictEqual(await driverOf(1), 1, 'maandag Rotterdam gaat van Bert naar Ad');
  assert.strictEqual(await driverOf(3), null, 'Ad heeft woensdag vakantie');
  assert.strictEqual(await driverOf(5), 2, 'vrijdag overgeslagen (feestdag)');
  assert.strictEqual(await driverOf(7), null, 'andere week blijft ongemoeid');
});

test('week leegmaken zet alle routes van die week terug naar niet toegewezen', async () => {
  await db.execute("UPDATE routes SET driver_id = 1 WHERE id = 7");
  const res = await call('POST', '/api/routes/clear', { week_key: WEEK });
  assert.deepStrictEqual(await res.json(), { updated: 6 });
  for (const id of [1, 2, 3, 4, 5, 6]) assert.strictEqual(await driverOf(id), null);
  assert.strictEqual(await driverOf(7), 1, 'andere week blijft ongemoeid');
});

test('persoon verwijderen haalt hem ook uit het standaardrooster', async () => {
  await call('DELETE', '/api/drivers/2');
  const rows = await (await call('GET', '/api/route-templates')).json();
  assert.ok(rows.every(r => r.driver_id !== 2));
});
