// Start de echte server tegen een tijdelijke lokale database en controleert de weetjes van de Hall of Fame.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooster-stats-test-'));
const PORT = String(5800 + Math.floor(Math.random() * 800)); // andere reeks dan de andere servertests, die tegelijk draaien
const BASE = `http://localhost:${PORT}`;
// Lege TURSO_AUTH_TOKEN zodat dotenv de echte waarden uit .env niet gebruikt
Object.assign(process.env, { TURSO_DATABASE_URL: `file:${path.join(dir, 'test.db')}`, TURSO_AUTH_TOKEN: '', PORT });

let server;
let db;
let cookie;

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

const stats = async () => (await fetch(`${BASE}/api/stats`, { headers: { cookie } })).json();

test('zonder gegevens: nette lege weetjes', async () => {
  assert.deepStrictEqual(await stats(), { routeKing: null, topRoute: null, totalRoutes: 0, earlyBird: null, hardWorker: null, duo: null, explorer: null, busiestDay: null, allrounder: null, hours: 0, coffee: 0, since: null });
});

test('weetjes tellen alleen tot en met vandaag', async () => {
  await db.execute("INSERT INTO drivers (id, name, is_driver, is_warehouse, is_production) VALUES (1, 'Ad', 1, 0, 0), (2, 'Bert', 1, 1, 0), (3, 'Cor', 0, 1, 1)");
  // Week in het verleden: Ad rijdt 3x Rotterdam, Bert 1x Noord; één route zonder chauffeur telt niet
  await db.execute(`INSERT INTO routes (week_key, day_index, code, driver_id) VALUES
    ('2026-01-05', 0, 'Rotterdam', 1), ('2026-01-05', 1, 'Rotterdam', 1), ('2026-01-05', 2, 'Rotterdam', 1),
    ('2026-01-05', 0, 'Noord', 2), ('2026-01-05', 3, 'Zeeland', NULL)`);
  // Diensten: Cor 2x vroeg (07:15–15:45 = 8,5 u - 0,5 = 8 u), Bert 1x 07:30–11:30 = 4 u (niet vóór half 8);
  // productie Cor 09:00–13:00 = 4 u
  await db.execute(`INSERT INTO warehouse_shifts (week_key, day_index, driver_id, start_time, end_time) VALUES
    ('2026-01-05', 0, 3, '07:15', '15:45'), ('2026-01-05', 1, 3, '07:15', '15:45'), ('2026-01-05', 2, 2, '07:30', '11:30')`);
  await db.execute("INSERT INTO production_shifts (week_key, day_index, driver_id, start_time, end_time) VALUES ('2026-01-05', 3, 3, '09:00', '13:00')");
  // Ver in de toekomst: telt niet mee
  await db.execute("INSERT INTO routes (week_key, day_index, code, driver_id) VALUES ('2099-01-05', 0, 'Noord', 2), ('2099-01-05', 1, 'Noord', 2), ('2099-01-05', 2, 'Noord', 2)");
  await db.execute("INSERT INTO warehouse_shifts (week_key, day_index, driver_id, start_time, end_time) VALUES ('2099-01-05', 0, 2, '05:00', '15:00')");

  assert.deepStrictEqual(await stats(), {
    routeKing: { name: 'Ad', count: 3 },
    topRoute: { code: 'Rotterdam', count: 3 },
    totalRoutes: 4,
    earlyBird: { name: 'Cor', count: 2 },
    hardWorker: { name: 'Ad', days: 3 },   // Ad en Cor allebei 3 dagen: bij gelijke stand alfabetisch
    duo: { name: 'Ad', code: 'Rotterdam', count: 3 },
    explorer: { name: 'Ad', routes: 1 },   // Ad en Bert elk 1 route: alfabetisch
    busiestDay: { date: '2026-01-05', people: 3 },  // maandag: Ad en Bert rijden, Cor in het magazijn
    allrounder: { name: 'Bert', teams: ['rijden', 'magazijn'] },  // Bert en Cor elk 2 teams: alfabetisch
    hours: 24,                             // 8 + 8 + 4 + 4 (half uur pauze bij meer dan 5,5 uur)
    coffee: 12,
    since: '2026-01-05',
  });
});

test('persoonlijke kaart', async () => {
  const card = async id => (await fetch(`${BASE}/api/stats/person/${id}`, { headers: { cookie } })).json();
  assert.deepStrictEqual(await card(3), {
    name: 'Cor', routes: 0, distinctRoutes: 0, favoriteRoute: null, shifts: 3, hours: 20,
    earliestStart: '07:15', days: 3, teams: ['magazijn', 'productie'], firstDay: '2026-01-05',
  });
  const bert = await card(2);
  assert.strictEqual(bert.routes, 1, 'routes in de toekomst tellen niet');
  assert.deepStrictEqual(bert.favoriteRoute, { code: 'Noord', count: 1 });
  assert.strictEqual(bert.earliestStart, '07:30', 'dienst van 05:00 in de toekomst telt niet');
  assert.deepStrictEqual(bert.teams, ['rijden', 'magazijn']);
  assert.strictEqual((await fetch(`${BASE}/api/stats/person/999`, { headers: { cookie } })).status, 404);
});
