const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Niet toegewezen inklappen en plusje in de dagkop', async t => {
  const { w, calls, text, byText, tick, act, start, menuAction } = setupApp();
  const check = checker();
  const sticky = () => w.document.querySelector('.rr-sticky');
  function drop(target, payload) {
    return act(async () => {
      const ev = new w.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } });
      target.dispatchEvent(ev);
    });
  }

  // Standaard testdata: alle routes hebben een chauffeur
  await start();
  const collapsed = () => w.document.querySelector('.rr-unassigned-none');
  check('Alles toegewezen: één balk "✓ Alles toegewezen"', collapsed() && collapsed().textContent === '✓ Alles toegewezen');
  check('Geen lege oranje vakjes', w.document.querySelectorAll('.rr-unassigned-cell').length === 0);
  check('Balk loopt over alle vijf dagen', collapsed().style.gridColumn === '2 / -1');

  // Een plusje in elke dagkop, niet meer als grote knop "+ route" in de vakjes
  const addLinks = [...sticky().querySelectorAll('.rr-add-route')];
  check('Vijf plusjes in de dagkoppen, met uitleg bij aanwijzen', addLinks.length === 5 && addLinks.every(b => b.textContent === '+') && addLinks[2].title === 'Route toevoegen op woensdag');
  check('Geen oude grote "+ route"-knoppen meer', w.document.querySelectorAll('.rr-add-btn').length === 0);

  // Route terugzetten door hem op de ingeklapte balk te slepen (Ad, maandag, We Supply)
  let n = calls.length;
  await drop(collapsed(), { routeId: 11, dayIndex: 0 }); await tick();
  check('Slepen naar de balk zet de route terug (driver_id null)', calls.slice(n).some(c => c.startsWith('PATCH /api/routes/11') && c.includes('"driver_id":null')));
  check('Balk klapt uit zodra er iets niet toegewezen is', !collapsed() && w.document.querySelectorAll('.rr-unassigned-cell').length === 5);
  check('We Supply staat nu bij maandag in "Niet toegewezen"', [...w.document.querySelectorAll('.rr-unassigned-cell')[0].querySelectorAll('input')].some(i => i.value === 'We Supply'));

  // Extra route via het plusje bij woensdag
  n = calls.length;
  await act(async () => { [...sticky().querySelectorAll('.rr-add-route')][2].click(); }); await tick();
  check('Plusje bij woensdag maakt een route op dag 2', calls.slice(n).some(c => c.startsWith('POST /api/routes ') && c.includes('"day_index":2')));

  // Menu "⋯ Meer"
  const items = () => [...w.document.querySelectorAll('.rr-more-item')];
  check('Menu is dicht tot je op "⋯ Meer" klikt', items().length === 0 && w.document.querySelector('.rr-more-btn').textContent === '⋯Meer');
  await act(async () => { w.document.querySelector('.rr-more-btn').click(); });
  check('Menu toont Standaardrooster toepassen, Week leegmaken en Uitleg', items().map(b => b.textContent).join('|') === '↻Standaardrooster toepassen|✕Week leegmaken|?Uitleg');
  check('Lijntje boven Uitleg', w.document.querySelectorAll('.rr-more-menu [role=separator]').length === 1);
  check('Week leegmaken is gemarkeerd als gevaarlijk (rood bij aanwijzen)', items()[1].className.includes('rr-more-danger'));
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); });
  check('Esc sluit het menu', items().length === 0);
  await act(async () => { w.document.querySelector('.rr-more-btn').click(); });
  await act(async () => { w.document.querySelector('.rr-more-menu').previousSibling.click(); });
  check('Klik ernaast sluit het menu', items().length === 0);

  // Uitleg
  await menuAction('Uitleg');
  const help = () => w.document.querySelector('.rr-help');
  check('Uitleg opent venster "Uitleg chauffeurs"', help() && help().textContent.includes('Uitleg chauffeurs') && help().textContent.includes('Route toewijzen'));
  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); });
  check('Esc sluit het uitlegvenster', !help());
  await menuAction('Uitleg');
  await act(async () => { help().querySelector('[aria-label="Sluiten"]').click(); });
  check('× sluit het uitlegvenster', !help());

  await check.report(t);
});
