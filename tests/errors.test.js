const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Foutmeldingen bij mislukt opslaan of laden', async t => {
  const { w, calls, state, text, byText, tick, act, start, unexpectedErrors } = setupApp();
  const check = checker();
  const banner = () => w.document.querySelector('[role=alert]');
  let unhandled = 0;
  process.on('unhandledRejection', reason => { if (!(reason && reason.reported)) { unhandled++; console.log('onverwacht:', reason); } });

  await start();
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  check('Geen melding bij normaal gebruik', !banner());

  // 1. Serverfout bij opslaan van een dienst
  const cells = () => [...w.document.querySelectorAll('.rr-shift-cell')];
  state.failNext = { match: (m, u) => m === 'POST' && u === '/api/warehouse-shifts', status: 500, body: { error: 'serverfout' } };
  let n = calls.length;
  await act(async () => { cells()[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await tick(); await tick();
  check('Melding "Niet opgeslagen: serverfout"', banner() && banner().textContent.includes('Niet opgeslagen: serverfout'));
  const after = calls.slice(n);
  check('Na fout: personen, vakanties, diensten en templates opnieuw geladen',
    ['GET /api/drivers', 'GET /api/vacations', 'GET /api/warehouse-shifts?', 'GET /api/warehouse-templates'].every(p => after.some(c => c.startsWith(p))));
  check('Na herladen staat de mislukte dienst niet meer in beeld', !text().includes('07:00–16:30'));

  await act(async () => { byText('×', 'span').find(e => e.title === 'Sluiten').click(); });
  check('Melding sluit met ×', !banner());

  // 2. Geen verbinding bij verwijderen van een vakantie
  state.failNext = { match: (m, u) => m === 'DELETE' && u.startsWith('/api/vacations/'), network: true };
  await act(async () => { byText('×', 'span').find(e => e.title === 'Verwijderen').click(); }); await tick(); await tick();
  check('Melding "Niet opgeslagen: geen verbinding met de server"', banner() && banner().textContent.includes('geen verbinding met de server'));
  check('Vakantie van Cor staat na herladen nog in beeld', text().includes('Vakantie/vrij'));

  // 3. Laadfout overschrijft melding over niet-opgeslagen werk niet
  state.failNext = { match: (m, u) => m === 'GET' && u.startsWith('/api/warehouse-shifts?'), status: 500, body: { error: 'serverfout' } };
  await act(async () => { byText('volgende week →', 'button')[0].click(); }); await tick(); await tick();
  check('Laadfout laat eerdere opslagmelding staan', banner().textContent.includes('Niet opgeslagen'));
  await act(async () => { byText('×', 'span').find(e => e.title === 'Sluiten').click(); });
  n = calls.length;
  state.failNext = { match: (m, u) => m === 'GET' && u.startsWith('/api/warehouse-shifts?'), status: 500, body: { error: 'serverfout' } };
  await act(async () => { byText('volgende week →', 'button')[0].click(); }); await tick(); await tick();
  check('Laadfout geeft "Kon gegevens niet laden"', banner() && banner().textContent.includes('Kon gegevens niet laden: serverfout'));
  check('Laadfout start geen herlaadlus', !calls.slice(n).some(c => c.startsWith('GET /api/drivers')));

  // 4. Foutmelding van de server (400) komt door
  await act(async () => { byText('×', 'span').find(e => e.title === 'Sluiten').click(); });
  await act(async () => { byText('Chauffeurs', 'button')[0].click(); }); await tick();
  state.failNext = { match: (m, u) => m === 'POST' && u === '/api/routes', status: 400, body: { error: 'week_key en day_index zijn verplicht' } };
  await act(async () => { byText('+ route', 'button')[0].click(); }); await tick(); await tick();
  check('Servermelding bij 400 wordt getoond', banner() && banner().textContent.includes('Niet opgeslagen: week_key en day_index zijn verplicht'));
  check('Melding niet geprint (no-print)', banner().className === 'no-print');

  // 5. Sessie verlopen (401): naar het inlogscherm, geen rode melding
  let loginRedirects = 0;
  w.goToLogin = () => { loginRedirects++; };
  await act(async () => { byText('×', 'span').find(e => e.title === 'Sluiten').click(); });
  state.failNext = { match: (m, u) => m === 'POST' && u === '/api/routes', status: 401, body: { error: 'niet ingelogd' } };
  await act(async () => { byText('+ route', 'button')[0].click(); }); await tick();
  check('401: doorgestuurd naar inlogscherm', loginRedirects === 1);
  check('401: geen foutmelding', !banner());

  // 6. Uitloggen
  const beforeLogout = calls.length;
  await act(async () => { byText('Uitloggen', 'button')[0].click(); }); await tick();
  check('Uitloggen stuurt POST /api/logout', calls.slice(beforeLogout).some(c => c.startsWith('POST /api/logout')));
  check('Uitloggen gaat naar inlogscherm', loginRedirects === 2);

  await tick();
  check('Geen onverwachte (niet getoonde) fouten', unexpectedErrors.length === 0);

  await check.report(t);
});
