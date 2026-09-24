const { test } = require('node:test');
const { setupApp, checker, iso } = require('./setup');

test('Status ziek', async t => {
  const { w, db, calls, text, byText, tick, act, start, monday, weekKey: wk } = setupApp();
  const check = checker();
  const day = n => { const d = new Date(monday); d.setDate(monday.getDate() + n); return iso(d); };

  // Ad is donderdag ziek, Bert (beide teams) vrijdag
  db.vacations.push(
    { id: 2, driver_id: 1, driver_name: 'Ad', start_date: day(3), end_date: day(3), type: 'sick' },
    { id: 3, driver_id: 2, driver_name: 'Bert', start_date: day(4), end_date: day(4), type: 'sick' }
  );
  // Nieuwe ziekmelding: server meldt dat er een route terug is gezet
  // Bert rijdt dinsdag twee routes
  db.routes.push({ id: 20, day_index: 1, code: 'Den Haag', driver_id: 2, driver_name: 'Bert' });
  const mockFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    const res = await mockFetch(url, opts);
    if (url === '/api/vacations' && opts.method === 'POST') {
      const body = await res.json();
      return { ok: true, status: 200, json: async () => ({ ...body, unassigned: body.type === 'sick' ? 1 : 0 }) };
    }
    return res;
  };

  await start();

  // Chauffeurs-tab
  const rows = () => [...w.document.querySelectorAll('.rr-driver-grid')][1];
  const cellsOf = name => {
    const kids = [...rows().children];
    const i = kids.findIndex(e => e.textContent === name);
    return kids.slice(i + 1, i + 6);
  };
  check('Ad donderdag toont "Ziek"', cellsOf('Ad')[3].textContent === 'Ziek');
  check('Ziek-cel is rood', cellsOf('Ad')[3].style.background === 'rgb(248, 215, 212)');
  check('Ad maandag (rijdt) groen, zoals het magazijn', cellsOf('Ad')[0].style.background === 'rgb(221, 239, 224)');
  check('Ad dinsdag (rijdt niet) lichtgrijs zonder rand', cellsOf('Ad')[1].style.background === 'rgb(245, 246, 248)' && cellsOf('Ad')[1].style.border.includes('transparent'));
  const fontSizes = cell => [...cell.querySelectorAll('input')].map(i => i.style.fontSize);
  check('Eén route in een vakje: gewone lettergrootte', fontSizes(cellsOf('Ad')[0]).join() === '12.5px');
  check('Twee routes in een vakje: kleinere letters', fontSizes(cellsOf('Bert')[1]).join() === '11px,11px');
  check('Geen scheidingslijnen tussen chauffeurs: per chauffeur naam + 5 vakjes', rows().children.length === 2 * 6);
  check('Ad woensdag niet ziek', cellsOf('Ad')[2].textContent !== 'Ziek');
  check('Ziekmelding staat in de lijst rechts', [...w.document.querySelectorAll('strong')].some(e => e.textContent.trim() === 'Ziek'));

  // Ziek melden via het paneel
  const panelType = w.document.querySelector('.rr-vac-type');
  check('Paneel heeft keuze Vakantie/vrij of Ziek', panelType && [...panelType.options].map(o => o.textContent).join('|') === 'Vakantie/vrij|Ziek');
  const setVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  const dates = [...w.document.querySelectorAll('input[type=date]')];
  await act(async () => { panelType.value = 'sick'; panelType.dispatchEvent(new w.Event('change', { bubbles: true })); });
  await act(async () => {
    setVal.call(dates[0], day(1)); dates[0].dispatchEvent(new w.Event('input', { bubbles: true }));
    setVal.call(dates[1], day(2)); dates[1].dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  let n = calls.length;
  await act(async () => { byText('Toevoegen', 'button')[0].click(); }); await tick();
  check('Paneel stuurt ziekmelding met type sick', calls.slice(n).some(c => c.startsWith('POST /api/vacations') && c.includes('"type":"sick"') && c.includes(`"start_date":"${day(1)}"`)));
  check('Na ziekmelding worden de routes opnieuw geladen', calls.slice(n).some(c => c.startsWith(`GET /api/routes?week_key=${wk}`)));

  // Rechtsklik: niet beschikbaar (Bert woensdag), voor de printkleur verderop
  await act(async () => { cellsOf('Bert')[2].dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  await act(async () => { byText('Niet beschikbaar', 'div').find(e => e.style.cursor === 'pointer').click(); }); await tick();

  // Rechtsklik: één dag ziek
  await act(async () => { cellsOf('Ad')[0].dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  check('Rechtsklikmenu toont "Ziek (deze dag)"', byText('Ziek (deze dag)', 'div').length === 1);
  n = calls.length;
  await act(async () => { byText('Ziek (deze dag)', 'div')[0].click(); }); await tick();
  check('Rechtsklik meldt ziek voor die dag', calls.slice(n).some(c => c.startsWith('POST /api/vacations') && c.includes('"type":"sick"') && c.includes(`"start_date":"${day(0)}","end_date":"${day(0)}"`)));

  // Rechtsklik op een zieke dag: weer beter melden
  await act(async () => { cellsOf('Ad')[3].dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  n = calls.length;
  await act(async () => { byText('Niet meer ziek', 'div')[0].click(); }); await tick();
  check('"Niet meer ziek" verwijdert de ziekmelding', calls.slice(n).some(c => c.startsWith('DELETE /api/vacations/2')));
  check('Ad donderdag niet meer ziek', cellsOf('Ad')[3].textContent !== 'Ziek');

  // Magazijn-tab
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  const shiftCells = [...w.document.querySelectorAll('.rr-shift-cell')];
  check('Magazijn: Bert vrijdag toont "Ziek"', shiftCells[4].textContent === 'Ziek');
  check('Magazijn: zieke cel niet klikbaar', !shiftCells[4].className.includes('rr-shift-toggle'));

  // Print
  let printed = '';
  let sickColor = '';
  let unavailableColor = '';
  w.print = () => {
    const el = w.document.querySelector('.rr-print-only');
    printed = el.textContent;
    const td = [...el.querySelectorAll('td')].find(e => e.textContent === 'Ziek');
    sickColor = td && td.style.background;
    const na = [...el.querySelectorAll('td')].find(e => e.textContent === 'Niet beschikbaar');
    unavailableColor = na && na.style.background;
  };
  await act(async () => { byText('Print rooster', 'button')[0].click(); }); await tick();
  check('Print toont "Ziek"', printed.includes('Ziek'));
  check('Ziek is rood in de print', sickColor === 'rgb(242, 139, 130)');
  check('Niet beschikbaar is lichtgrijs in de print', unavailableColor === 'rgb(213, 213, 213)');

  await check.report(t);
});
