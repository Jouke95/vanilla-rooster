const { test } = require('node:test');
const { setupApp, checker, iso } = require('./setup');

test('Tabblad Afwezigheid', async t => {
  const { w, db, calls, text, byText, tick, act, start, menuAction } = setupApp();
  const check = checker();

  // Werkdagen in de huidige maand, onafhankelijk van de dag waarop de test draait
  const now = new Date();
  const weekdays = [];
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d.getMonth() === now.getMonth(); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) weekdays.push(iso(d));
  }
  // Ad: vakantie op de eerste twee werkdagen; Bert: ziek op de laatste werkdag
  db.vacations = [
    { id: 11, driver_id: 1, driver_name: 'Ad', start_date: weekdays[0], end_date: weekdays[1], type: 'vacation' },
    { id: 12, driver_id: 2, driver_name: 'Bert', start_date: weekdays[weekdays.length - 1], end_date: weekdays[weekdays.length - 1], type: 'sick' },
  ];

  await start();
  await act(async () => { byText('Afwezigheid', 'button')[0].click(); }); await tick();
  const monthName = now.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  check('Titel en huidige maand', text().includes('Afwezigheid') && w.document.querySelector('.rr-month-label').textContent === monthName);
  check('Label "deze maand"', text().includes('deze maand'));

  const grid = () => w.document.querySelector('.rr-absence-grid');
  const rowNames = () => [...grid().children].filter(e => e.querySelector && e.querySelector('span') && !e.className).map(e => e.firstChild.textContent);
  check('Alleen mensen die deze maand afwezig zijn: Ad en Bert', JSON.stringify(rowNames()) === '["Ad","Bert"]');
  check('Kolom per werkdag van de maand', grid().style.gridTemplateColumns === `150px repeat(${weekdays.length}, 26px)`);
  check('Ad: twee vakjes vakantie', w.document.querySelectorAll('.rr-absence-vacation').length === 2);
  check('Bert: één vakje ziek', w.document.querySelectorAll('.rr-absence-sick').length === 1);
  const vac = w.document.querySelector('.rr-absence-vacation');
  check('Tooltip met naam en soort', vac.title.startsWith('Ad · Vakantie/vrij ·'));

  await act(async () => { w.document.querySelector('.rr-show-all').click(); });
  check('"Iedereen tonen" toont ook Cor en Eva', JSON.stringify(rowNames()) === '["Ad","Bert","Cor","Eva"]');
  check('Team achter de naam', text().includes('Evaproductie') || [...grid().children].some(e => e.textContent === 'Evaproductie'));

  // Rechtsklik op een leeg vakje: menu met niet beschikbaar en ziek
  const emptyCell = [...w.document.querySelectorAll('.rr-absence-cell')].find(c => c.className === 'rr-absence-cell');
  await act(async () => { emptyCell.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  check('Rechtsklik geeft "Niet beschikbaar" en "Ziek (deze dag)"', byText('Ziek (deze dag)', 'div').length === 1);
  const n = calls.length;
  await act(async () => { byText('Ziek (deze dag)', 'div')[0].click(); }); await tick();
  check('Ziek melden vanaf dit tabblad', calls.slice(n).some(c => c.startsWith('POST /api/vacations') && c.includes('"type":"sick"')));

  // Volgende maand
  await act(async () => { w.document.querySelector('.rr-show-all').click(); });
  await act(async () => { w.document.querySelector('[aria-label="Volgende maand"]').click(); });
  check('Volgende maand: knop "Naar deze maand"', byText('Naar deze maand', 'button').length === 1);
  check('Volgende maand: niemand afwezig', text().includes('Niemand afwezig in'));
  await act(async () => { byText('Naar deze maand', 'button')[0].click(); });
  check('Terug naar deze maand', w.document.querySelector('.rr-month-label').textContent === monthName);

  await menuAction('Uitleg');
  check('Uitleg afwezigheid', w.document.querySelector('.rr-help').textContent.includes('Uitleg afwezigheid'));

  await check.report(t);
});
