// Start de echte server tegen een tijdelijke lokale database en controleert de productie-adressen
// en dat magazijn en productie elk hun eigen diensten en standaardrooster hebben.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooster-production-test-'));
const PORT = String(4900 + Math.floor(Math.random() * 800)); // andere reeks dan de andere servertests, die tegelijk draaien
const BASE = `http://localhost:${PORT}`;
// Lege TURSO_AUTH_TOKEN zodat dotenv de echte waarden uit .env niet gebruikt
Object.assign(process.env, { TURSO_DATABASE_URL: `file:${path.join(dir, 'test.db')}`, TURSO_AUTH_TOKEN: '', PORT });

let server;
let db;
let cookie;
const WEEK = '2026-10-05';

const call = (method, url, body) => fetch(BASE + url, {
  method,
  headers: { 'Content-Type': 'application/json', cookie },
  body: body ? JSON.stringify(body) : undefined,
});
const json = async (method, url, body) => (await call(method, url, body)).json();

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: process.env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/login`); break; } catch (err) { await new Promise(r => setTimeout(r, 100)); }
  }
  await require('../auth').setPassword('test');
  ({ db } = require('../db'));
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nieuwe persoon in productie en teamlidmaatschap aanpassen', async () => {
  const eva = await json('POST', '/api/drivers', { name: 'Eva', is_driver: 0, is_production: 1 });
  assert.deepStrictEqual({ ...eva, id: undefined }, { id: undefined, name: 'Eva', is_driver: 0, is_warehouse: 0, is_production: 1 });
  const bert = await json('POST', '/api/drivers', { name: 'Bert', is_driver: 1 });
  assert.strictEqual(bert.is_production, 0, 'standaard niet in productie');
  const patched = await json('PATCH', `/api/drivers/${bert.id}`, { is_warehouse: 1, is_production: 1 });
  assert.strictEqual(patched.is_production, 1);
  assert.strictEqual(patched.is_driver, 1, 'ongenoemde teams blijven zoals ze waren');
  const all = await json('GET', '/api/drivers');
  assert.strictEqual(all.find(d => d.name === 'Bert').is_production, 1);
});

test('diensten en standaardrooster van productie staan los van het magazijn', async () => {
  const people = await json('GET', '/api/drivers');
  const bert = people.find(d => d.name === 'Bert');
  const eva = people.find(d => d.name === 'Eva');
  await call('POST', '/api/production-shifts', { week_key: WEEK, day_index: 0, driver_id: eva.id, start_time: '09:00', end_time: '16:30' });
  await call('POST', '/api/warehouse-shifts', { week_key: WEEK, day_index: 1, driver_id: bert.id, start_time: '07:00', end_time: '16:30' });
  assert.deepStrictEqual((await json('GET', `/api/production-shifts?week_key=${WEEK}`)).map(s => [s.day_index, s.driver_id]), [[0, eva.id]]);
  assert.deepStrictEqual((await json('GET', `/api/warehouse-shifts?week_key=${WEEK}`)).map(s => [s.day_index, s.driver_id]), [[1, bert.id]]);

  // Standaardrooster productie voor Eva op dinsdag en donderdag
  await call('PUT', `/api/production-templates/${eva.id}`, { days: [{ day_index: 1, start_time: '09:00', end_time: '16:30' }, { day_index: 3, start_time: '10:00', end_time: '14:00' }] });
  assert.strictEqual((await json('GET', '/api/production-templates')).length, 2);
  assert.strictEqual((await json('GET', '/api/warehouse-templates')).length, 0, 'magazijn heeft geen standaardrooster gekregen');

  // Nieuwe week: alleen productie wordt ingevuld; donderdag is "feestdag"
  const next = '2026-10-12';
  assert.deepStrictEqual(await json('POST', '/api/production-shifts/apply-template', { week_key: next, only_if_new: true, skip_days: [3] }), { applied: true });
  assert.deepStrictEqual((await json('GET', `/api/production-shifts?week_key=${next}`)).map(s => [s.day_index, s.start_time]), [[1, '09:00']]);
  assert.deepStrictEqual(await json('POST', '/api/production-shifts/apply-template', { week_key: next, only_if_new: true }), { applied: false }, 'tweede keer openen doet niets');
  assert.deepStrictEqual(await json('POST', '/api/warehouse-shifts/apply-template', { week_key: next, only_if_new: true }), { applied: false }, 'magazijn zonder standaardrooster');
  const weeks = await db.execute('SELECT week_key FROM production_weeks');
  assert.deepStrictEqual(weeks.rows.map(r => r.week_key), [next]);

  // Toepassen voor één persoon vervangt alleen haar productiediensten
  await call('POST', `/api/production-shifts/apply-template/${eva.id}`, { week_key: WEEK });
  assert.deepStrictEqual((await json('GET', `/api/production-shifts?week_key=${WEEK}`)).map(s => s.day_index).sort(), [1, 3]);
  assert.strictEqual((await json('GET', `/api/warehouse-shifts?week_key=${WEEK}`)).length, 1, 'magazijndienst van Bert blijft');

  // Dienst verwijderen
  await call('DELETE', '/api/production-shifts', { week_key: WEEK, day_index: 3, driver_id: eva.id });
  assert.deepStrictEqual((await json('GET', `/api/production-shifts?week_key=${WEEK}`)).map(s => s.day_index), [1]);
});

test('week openen in één verzoek: standaardrooster alleen de eerste keer, diensten terug', async () => {
  const eva = (await json('GET', '/api/drivers')).find(d => d.name === 'Eva');
  const W = '2026-11-02';
  // Magazijn heeft geen standaardrooster: niets ingevuld en de week niet gemarkeerd
  assert.deepStrictEqual(await json('POST', '/api/warehouse-shifts/open-week', { week_key: W, fill_new: true }), []);
  const marked = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM warehouse_weeks WHERE week_key = ?', args: [W] });
  assert.strictEqual(Number(marked.rows[0].n), 0, 'zonder standaardrooster niet markeren');

  // Productie: Eva di (09:00) en do (10:00); donderdag is feestdag
  const first = await json('POST', '/api/production-shifts/open-week', { week_key: W, fill_new: true, skip_days: [3] });
  assert.deepStrictEqual(first.map(r => [r.day_index, r.driver_id, r.start_time]), [[1, eva.id, '09:00']]);

  // Dienst weghalen en opnieuw openen: wordt niet opnieuw ingevuld (week is gemarkeerd)
  await call('DELETE', '/api/production-shifts', { week_key: W, day_index: 1, driver_id: eva.id });
  assert.deepStrictEqual(await json('POST', '/api/production-shifts/open-week', { week_key: W, fill_new: true }), []);

  // Zonder fill_new (weken in het verleden): alleen ophalen, niet markeren
  const PAST = '2026-01-05';
  assert.deepStrictEqual(await json('POST', '/api/production-shifts/open-week', { week_key: PAST, fill_new: false }), []);
  const pastMarked = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM production_weeks WHERE week_key = ?', args: [PAST] });
  assert.strictEqual(Number(pastMarked.rows[0].n), 0);
});

test('week leegmaken haalt alleen de productiediensten van die week weg', async () => {
  const eva = (await json('GET', '/api/drivers')).find(d => d.name === 'Eva');
  await call('POST', '/api/production-shifts', { week_key: '2026-10-19', day_index: 0, driver_id: eva.id, start_time: '09:00', end_time: '16:30' });
  const before = await json('GET', `/api/production-shifts?week_key=${WEEK}`);
  assert.ok(before.length > 0);
  assert.deepStrictEqual(await json('POST', '/api/production-shifts/clear', { week_key: WEEK }), { deleted: before.length });
  assert.strictEqual((await json('GET', `/api/production-shifts?week_key=${WEEK}`)).length, 0);
  assert.strictEqual((await json('GET', '/api/production-shifts?week_key=2026-10-19')).length, 1, 'andere week blijft');
  assert.strictEqual((await json('GET', `/api/warehouse-shifts?week_key=${WEEK}`)).length, 1, 'magazijn blijft');
  assert.strictEqual((await json('GET', '/api/production-templates')).length, 2, 'standaardrooster blijft');
});

test('persoon verwijderen haalt ook productiediensten en -standaardrooster weg', async () => {
  const eva = (await json('GET', '/api/drivers')).find(d => d.name === 'Eva');
  await call('DELETE', `/api/drivers/${eva.id}`);
  const shifts = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM production_shifts WHERE driver_id = ?', args: [eva.id] });
  const templates = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM production_templates WHERE driver_id = ?', args: [eva.id] });
  assert.strictEqual(Number(shifts.rows[0].n), 0);
  assert.strictEqual(Number(templates.rows[0].n), 0);
});
