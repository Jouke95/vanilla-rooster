const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Feestdagen in de kerstweek van 2026', async t => {
  const { w, calls, text, byText, tick, act, start, monday: mon } = setupApp({ extraRoutes: [{ id: 12, day_index: 4, code: 'Zeeland', driver_id: null, driver_name: null }, { id: 13, day_index: 4, code: 'Rotterdam', driver_id: null, driver_name: null }] });
  const check = checker();
  let printed = null;
  w.print = () => { const el = w.document.querySelector('.rr-print-only'); printed = el && el.querySelector('thead').textContent; };
  // Kopregel + "Niet toegewezen" (vast bovenaan) en daarna de chauffeurs, als één lijst
  const gridKids = () => [...w.document.querySelectorAll('.rr-driver-grid')].flatMap(g => [...g.children]);
  function drop(target, payload) {
    return act(async () => {
      const ev = new w.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } });
      target.dispatchEvent(ev);
    });
  }

  await start();
  // Naar de week van 21 dec 2026
  const target = new Date(2026, 11, 21);
  const weeks = Math.round((target - mon) / (7 * 86400000));
  for (let i = 0; i < weeks; i++) await act(async () => { byText('volgende week →', 'button')[0].click(); });
  await tick();
  check('Week van 21 dec geopend', text().includes('21 dec – 25 dec'));

  // Chauffeurs
  const headers = gridKids().slice(1, 6).map(e => e.textContent);
  check('Kop vrijdag toont "1e Kerstdag"', headers[4].includes('1e Kerstdag'));
  check('Andere dagen geen feestdag', headers.slice(0, 4).every(h => !/Kerst|Paas|Koning|Hemel|Pinkster|Nieuwjaar/.test(h)));
  const unassigned = () => gridKids().slice(7, 12);
  check('Hint bij feestdag met routes', unassigned()[4].textContent.includes('Feestdag: sleep routes naar een andere dag'));
  check('Geen hint op gewone dag', !unassigned()[0].textContent.includes('Feestdag'));

  // Zeeland (vr, feestdag) -> niet toegewezen donderdag
  let n = calls.length;
  await drop(unassigned()[3], { routeId: 12, dayIndex: 4 }); await tick();
  check('Route vanaf feestdag naar donderdag: PATCH day_index 3', calls.slice(n).some(c => c.startsWith('PATCH /api/routes/12') && c.includes('"day_index":3') && c.includes('"driver_id":null')));
  check('Zeeland staat nu bij donderdag', unassigned()[3].textContent.includes('Zeeland') || [...unassigned()[3].querySelectorAll('input')].some(i => i.value === 'Zeeland'));
  // Rotterdam (vr) -> Ad op woensdag. Rijen: Ad op index 12, cellen 13-17
  n = calls.length;
  await drop(gridKids()[13 + 2], { routeId: 13, dayIndex: 4 }); await tick();
  check('Route vanaf feestdag naar Ad op woensdag: day_index 2 + driver_id 1', calls.slice(n).some(c => c.startsWith('PATCH /api/routes/13') && c.includes('"day_index":2') && c.includes('"driver_id":1')));
  check('Hint verdwijnt als de feestdag leeg is', !unassigned()[4].textContent.includes('Feestdag:'));
  // Gewone route mag niet naar andere dag
  n = calls.length;
  await drop(unassigned()[1], { routeId: 11, dayIndex: 0 }); await tick();
  check('Route van gewone dag naar andere dag: niets gebeurt', calls.slice(n).length === 0);
  // Zelfde dag toewijzen werkt nog
  n = calls.length;
  await drop(gridKids()[13 + 3], { routeId: 12, dayIndex: 3 }); await tick();
  check('Toewijzen binnen dezelfde dag werkt nog (alleen driver_id)', calls.slice(n).some(c => c.startsWith('PATCH /api/routes/12') && c.includes('"driver_id":1') && !c.includes('day_index')));

  // Magazijn
  n = calls.length;
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  check('Standaardrooster slaat vrijdag over (skip_days [4])', calls.slice(n).some(c => c.startsWith('POST /api/warehouse-shifts/open-week') && c.includes('"skip_days":[4]')));
  const whHeaders = [...w.document.querySelector('.rr-warehouse-grid').children].slice(1, 6).map(e => e.textContent);
  check('Magazijn: kop vrijdag toont "1e Kerstdag"', whHeaders[4].includes('1e Kerstdag'));
  const cells = [...w.document.querySelectorAll('.rr-shift-cell')];
  n = calls.length;
  await act(async () => { cells[4].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await tick();
  check('Feestdag is met de hand in te plannen', calls.slice(n).some(c => c.startsWith('POST /api/warehouse-shifts ') && c.includes('"day_index":4')));
  n = calls.length;
  await act(async () => { byText('Standaardrooster toepassen', 'button')[0].click(); }); await tick();
  check('Knop toepassen stuurt skip_days [4]', calls.slice(n).some(c => c.includes('"only_if_new":false') && c.includes('"skip_days":[4]')));

  // Gecombineerde print
  await act(async () => { byText('Print alle teams', 'button')[0].click(); }); await tick(); await tick();
  check('Print: kop toont "1e Kerstdag"', printed && printed.includes('1e Kerstdag'));

  await check.report(t);
});
