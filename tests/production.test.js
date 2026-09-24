const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Productie als apart team', async t => {
  const { w, db, calls, text, byText, tick, act, start, click, menuAction } = setupApp();
  const check = checker();

  // Bert zit ook in productie en werkt dinsdag zowel in het magazijn als in productie
  Object.assign(db.drivers.find(d => d.name === 'Bert'), { is_production: 1 });
  db.productionShifts.push({ id: 8, day_index: 1, driver_id: 2, start_time: '12:00', end_time: '16:30' });
  // en donderdag alleen in het magazijn, zonder route
  db.shifts.push({ id: 9, day_index: 3, driver_id: 2, start_time: '07:00', end_time: '16:30' });

  await start();
  check('Tabblad Productie aanwezig', byText('Productie', 'button').length === 1);
  check('Chauffeurs-tab: Bert dinsdag "⚠ magazijn, productie"', text().includes('⚠ magazijn, productie'));
  const bertCells = (() => { const kids = [...[...w.document.querySelectorAll('.rr-driver-grid')][1].children]; const i = kids.findIndex(e => e.textContent === 'Bert'); return kids.slice(i + 1, i + 6); })();
  check('Chauffeurs-tab: Bert donderdag (alleen magazijn, geen route) zonder label', bertCells[3].textContent === '');
  const bertChip = [...w.document.querySelectorAll('.rr-driver-chip')].find(e => e.firstChild.textContent === 'Bert');
  check('Chip van Bert toont "+ magazijn, productie"', bertChip.textContent.includes('+ magazijn, productie'));

  // Naar productie
  await act(async () => { byText('Productie', 'button')[0].click(); }); await tick();
  check('Titel "Weekrooster productie"', text().includes('Weekrooster productie'));
  const chips = [...w.document.querySelectorAll('.rr-driver-chip')].map(e => e.firstChild.textContent);
  check('Productie toont alleen Bert en Eva', JSON.stringify(chips) === '["Bert","Eva"]');
  check('Week openen productie in één verzoek (fill_new)', calls.some(c => c.startsWith('POST /api/production-shifts/open-week') && c.includes('"fill_new":true')));
  check('Eva woensdag 09:00–16:30', text().includes('09:00–16:30'));
  check('Bert dinsdag: label "⚠ magazijn" (werkt ook in het magazijn)', text().includes('⚠ magazijn'));
  check('Bert dinsdag: label "⚠ rijdt: Rotterdam"', text().includes('⚠ rijdt: Rotterdam'));

  // Lege cel: standaardtijden productie 09:00–16:30
  const cells = () => [...w.document.querySelectorAll('.rr-shift-cell')];
  await click(cells()[5 + 0]); await tick();  // Eva maandag
  check('Lege cel krijgt 09:00–16:30 via production-shifts', calls.some(c => c.startsWith('POST /api/production-shifts ') && c.includes('"driver_id":5') && c.includes('"start_time":"09:00","end_time":"16:30"')));
  check('Geen magazijndienst aangemaakt', !calls.some(c => c.startsWith('POST /api/warehouse-shifts ')));

  // Standaardrooster van Eva: nieuwe dag begint met 09:00–16:30
  await act(async () => { [...w.document.querySelectorAll('.rr-person-name')].find(e => e.textContent === 'Eva').click(); }); await tick();
  const times = [...w.document.querySelectorAll('input[type=time]')];
  check('Standaardrooster productie: standaardtijd 09:00', times[0].value === '09:00' && times[1].value === '16:30');
  await act(async () => { w.document.querySelectorAll('input[type=checkbox]')[0].click(); });
  await act(async () => { byText('Opslaan', 'button')[0].click(); }); await tick();
  check('Standaardrooster opslaan via production-templates', calls.some(c => c.startsWith('PUT /api/production-templates/5')));

  // Nieuwe persoon in productie
  const setVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  const input = w.document.querySelector('.rr-input');
  await act(async () => { setVal.call(input, 'Fien'); input.dispatchEvent(new w.Event('input', { bubbles: true })); });
  await act(async () => { byText('+ toevoegen', 'button')[0].click(); }); await tick();
  check('Nieuwe persoon krijgt alleen is_production=1', calls.some(c => c.startsWith('POST /api/drivers') && c.includes('"is_driver":0,"is_warehouse":0,"is_production":1')));

  // Knoppen zoals bij de chauffeurs; geen eigen printknop meer
  check('Alleen de ene printknop bovenaan, geen eigen printknop op productie', byText('Print rooster', 'button').length === 1);
  let n = calls.length;
  await menuAction('Week leegmaken');
  check('Week leegmaken stuurt clear voor productie', calls.slice(n).some(c => c.startsWith('POST /api/production-shifts/clear')));
  check('Na leegmaken geen diensten meer in beeld', !text().includes('09:00–16:30'));
  n = calls.length;
  await menuAction('Standaardrooster toepassen');
  check('Standaardrooster toepassen voor productie', calls.slice(n).some(c => c.startsWith('POST /api/production-shifts/apply-template') && c.includes('"only_if_new":false')));

  check('Geen uitlegregel meer onder de titel', !text().includes('Klik op een lege dag om iemand in te plannen, op een dienst'));
  await menuAction('Uitleg');
  check('Uitleg op productie gaat over magazijn en productie', w.document.querySelector('.rr-help').textContent.includes('Uitleg magazijn en productie'));
  await act(async () => { w.document.querySelector('.rr-help [aria-label="Sluiten"]').click(); });

  // Wisselen naar magazijn geeft het magazijnrooster, niet dat van productie
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  const whChips = [...w.document.querySelectorAll('.rr-driver-chip')].map(e => e.firstChild.textContent);
  check('Magazijn toont Bert en Cor (niet Eva)', JSON.stringify(whChips) === '["Bert","Cor"]');
  check('Magazijn: Bert dinsdag label "⚠ productie"', text().includes('⚠ productie'));

  await check.report(t);
});
