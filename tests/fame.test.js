const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Easter egg: Hall of Fame', async t => {
  const { w, calls, tick, act, start } = setupApp();
  const check = checker();
  await start();

  const btn = w.document.querySelector('.rr-fame-btn');
  check('Piepklein 🏆-knopje aanwezig', btn && btn.textContent === '🏆');
  check('Geen weetjes opgevraagd zolang het dicht is', !calls.some(c => c.startsWith('GET /api/stats')));
  await act(async () => { btn.click(); }); await tick();
  const hall = () => w.document.querySelector('.rr-hall');
  check('Klik opent de Hall of Fame', hall() && hall().textContent.includes('Hall of Fame'));
  check('Routekoning met getal in Nederlandse notatie', hall().textContent.includes('Ad, met 1.234 routes'));
  check('Koffie-index', hall().textContent.includes("goed voor zo'n 750 bakken koffie"));
  check('Geen vroege vogel: nette tekst', hall().textContent.includes('nog niemand vóór half 8'));
  check('Vanaf welke datum', hall().textContent.includes('Alles van 7 september 2026 tot en met vandaag'));
  check('Onafscheidelijk duo', hall().textContent.includes('Ad & Rotterdam: 38 keer samen'));
  check('Ontdekkingsreiziger', hall().textContent.includes('Bert, 14 verschillende routes gereden'));
  check('Allrounder met teams in gewone zin', hall().textContent.includes('Bert: rijden, magazijn en productie'));
  check('Drukste dag ooit met datum', hall().textContent.includes('15 september 2026, 23 mensen aan het werk'));
  check('Mijlpaal: 5.000 routes met confetti', hall().textContent.includes('🎉 Mijlpaal: 5.000 routes gereden!') && !!w.document.querySelector('.rr-confetti'));

  // Persoonlijke kaart
  const personBtn = [...w.document.querySelectorAll('.rr-fame-person')].find(b => b.textContent === 'Cor');
  check('Namen om een kaart te bekijken', !!personBtn);
  await act(async () => { personBtn.click(); }); await tick();
  check('Kaart van Cor opgevraagd', calls.some(c => c.startsWith('GET /api/stats/person/3')));
  check('Kaart toont teams en vroegste begin', hall().textContent.includes('🏅 Cor') && hall().textContent.includes('magazijn en productie') && hall().textContent.includes('07:15'));
  await act(async () => { w.document.querySelector('.rr-fame-back').click(); });
  check('Terug naar het overzicht', hall().textContent.includes('Routekoning'));

  await act(async () => { w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); });
  check('Esc sluit de Hall of Fame', !hall());

  await check.report(t);
});
