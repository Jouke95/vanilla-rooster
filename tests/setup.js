// Gedeelde opzet voor de UI-tests: laadt public/index.html in jsdom met React en een nagebootste API.
// Elk testbestand draait in een eigen proces (node --test), dus globale variabelen botsen niet.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appScript = html.split('<script>')[1].split('</script>')[0];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Maandag van deze week, zelfde logica als de app
function mondayOfThisWeek() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Standaard testdata: Ad is chauffeur, Bert zit in beide teams, Cor alleen in het magazijn
function defaultDb(monday) {
  const wednesday = new Date(monday);
  wednesday.setDate(monday.getDate() + 2);
  return {
    drivers: [
      { id: 1, name: 'Ad', is_driver: 1, is_warehouse: 0 },
      { id: 2, name: 'Bert', is_driver: 1, is_warehouse: 1 },
      { id: 3, name: 'Cor', is_driver: 0, is_warehouse: 1 },
    ],
    vacations: [{ id: 1, driver_id: 3, driver_name: 'Cor', start_date: iso(wednesday), end_date: iso(wednesday), type: 'vacation' }],
    routes: [
      { id: 10, day_index: 1, code: 'Rotterdam', driver_id: 2, driver_name: 'Bert' },
      { id: 11, day_index: 0, code: 'We Supply', driver_id: 1, driver_name: 'Ad' },
    ],
    shifts: [
      { id: 1, day_index: 1, driver_id: 2, start_time: '07:00', end_time: '15:00' },
      { id: 2, day_index: 0, driver_id: 3, start_time: null, end_time: null },
    ],
    templates: [{ driver_id: 3, day_index: 1, start_time: '09:00', end_time: '13:00' }],
    routeTemplates: [{ day_index: 1, code: 'Vroeg 1', driver_id: 2 }],
  };
}

function setupApp({ extraRoutes = [] } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(global, { window: w, document: w.document, HTMLElement: w.HTMLElement, Event: w.Event, MouseEvent: w.MouseEvent });
  // React waarschuwt bij updates na een fetch buiten act(); dat is hier verwacht en vervuilt alleen de uitvoer
  const consoleError = console.error;
  console.error = (...args) => { if (!String(args[0]).includes('not wrapped in act')) consoleError(...args); };
  global.IS_REACT_ACT_ENVIRONMENT = true;
  w.IS_REACT_ACT_ENVIRONMENT = true;
  w.React = require('react');
  w.ReactDOM = require('react-dom/client');
  w.confirm = () => true;

  const monday = mondayOfThisWeek();
  const db = defaultDb(monday);
  db.routes.push(...extraRoutes);

  // Alle API-aanroepen als "METHODE url body", zodat tests kunnen controleren wat er verstuurd is
  const calls = [];
  // failNext = { match(method, url), status, body } of { match, network: true }: de eerstvolgende passende aanroep mislukt
  const state = { failNext: null };
  w.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push(`${method} ${url} ${opts.body || ''}`);
    if (state.failNext && state.failNext.match(method, url)) {
      const f = state.failNext;
      state.failNext = null;
      if (f.network) throw new TypeError('Failed to fetch');
      return { ok: false, status: f.status, json: async () => f.body };
    }
    const json = data => ({ ok: true, status: 200, json: async () => data });
    if (url === '/api/drivers' && method === 'GET') return json(db.drivers);
    if (url === '/api/vacations' && method === 'GET') return json(db.vacations);
    if (url.startsWith('/api/routes?')) return json(db.routes);
    if (url.startsWith('/api/warehouse-shifts?')) return json(db.shifts);
    if (url === '/api/warehouse-templates') return json(db.templates);
    if (url === '/api/route-templates') return json(db.routeTemplates);
    if (url.startsWith('/api/route-templates/') && method === 'PUT') {
      const id = +url.split('/').pop();
      const keep = db.routeTemplates.filter(t => t.driver_id !== id && !body.routes.some(r => r.day_index === t.day_index && r.code === t.code));
      db.routeTemplates = [...keep, ...body.routes.map(r => ({ ...r, driver_id: id }))];
      return json(db.routeTemplates);
    }
    if (url.startsWith('/api/warehouse-templates/') && method === 'PUT') return json(body.days.map(d => ({ driver_id: +url.split('/').pop(), ...d })));
    if (url.startsWith('/api/warehouse-shifts/apply-template')) return json({ applied: true });
    if (url === '/api/drivers' && method === 'POST') return json({ id: 99, name: body.name, is_driver: body.is_driver, is_warehouse: body.is_warehouse });
    if (url.startsWith('/api/drivers/') && method === 'PATCH') { const d = db.drivers.find(x => x.id === +url.split('/').pop()); return json({ ...d, ...body }); }
    if (url === '/api/vacations' && method === 'POST') return json({ id: 50, ...body });
    return json({});
  };

  // In de browser vangt de app al gemelde fouten af via window 'unhandledrejection'. In Node komen ze bij het
  // proces uit, waar de testrunner ze als testfout telt. Zelfde gedrag als de browser nabootsen: gemelde fouten
  // negeren, alle andere gewoon doorgeven aan de testrunner.
  const unexpectedErrors = [];
  const runnerListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.reported) return;
    unexpectedErrors.push(reason);
    runnerListeners.forEach(listener => listener(reason, promise));
  });

  const { act } = require('react');
  const text = () => w.document.getElementById('root').textContent;
  const byText = (t, sel = '*') => [...w.document.querySelectorAll(sel)].filter(e => e.textContent === t);
  const tick = () => act(async () => { await new Promise(r => setTimeout(r, 20)); });
  const click = el => act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 })); });
  const setInputValue = (input, value) => act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  const start = async () => { await act(async () => { w.eval(appScript); }); await tick(); };

  return { w, db, calls, state, monday, weekKey: iso(monday), act, text, byText, tick, click, setInputValue, start, unexpectedErrors };
}

// Verzamelt controles tijdens een testscenario en meldt ze daarna als losse subtests,
// zodat je in de uitvoer per controle ziet wat er goed of fout ging.
function checker() {
  const results = [];
  const check = (label, cond) => results.push({ label, cond: !!cond });
  check.report = async t => {
    for (const r of results) await t.test(r.label, () => assert.ok(r.cond, r.label));
  };
  return check;
}

module.exports = { setupApp, checker, appScript, iso };
