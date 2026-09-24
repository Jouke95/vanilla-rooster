const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Standaardrooster chauffeurs', async t => {
  const { w, calls, byText, tick, act, start, weekKey: wk } = setupApp();
  const check = checker();

  // Weken na deze week zijn nog nieuw: geen routes tot ze zijn aangemaakt
  const mockFetch = w.fetch;
  w.fetch = async (url, opts = {}) => {
    const res = await mockFetch(url, opts);
    if (url.startsWith('/api/routes?') && !url.includes(wk)) return { ok: true, status: 200, json: async () => [] };
    return res;
  };

  await start();

  // Klik op naam opent het standaardrooster van die chauffeur
  const nameCell = () => [...w.document.querySelectorAll('.rr-person-name')].find(e => e.textContent === 'Ad');
  check('Naam Ad in het rooster is klikbaar', !!nameCell());
  await act(async () => { nameCell().click(); }); await tick();
  check('Venster "Standaardrooster Ad" opent', w.document.body.textContent.includes('Standaardrooster Ad'));
  check('Vroeg 1 op dinsdag toont dat Bert hem standaard rijdt', w.document.body.textContent.includes('(standaard: Bert)'));
  const box = code => [...w.document.querySelectorAll('label')].filter(l => l.textContent.startsWith(code)).map(l => l.querySelector('input'));
  await act(async () => { box('We Supply')[0].click(); });  // maandag
  await act(async () => { box('Vroeg 1')[0].click(); });    // dinsdag, nu van Bert
  check('Aanvinken van Bert zijn route toont "gaat over van Bert"', w.document.body.textContent.includes('(gaat over van Bert)'));
  await act(async () => { byText('Opslaan', 'button')[0].click(); }); await tick();
  const put = calls.find(c => c.startsWith('PUT /api/route-templates/1'));
  check('Opslaan stuurt de aangevinkte routes van Ad', put && put.includes('{"routes":[{"day_index":0,"code":"We Supply"},{"day_index":1,"code":"Vroeg 1"}]}'));
  check('Venster sluit na opslaan', !w.document.body.textContent.includes('Standaardrooster Ad'));
  check('Niet toegepast op deze week bij gewoon opslaan', !calls.some(c => c.startsWith('POST /api/routes/apply-template/1')));

  // Opnieuw openen: vinkjes staan er nog, Vroeg 1 is nu van Ad
  await act(async () => { nameCell().click(); }); await tick();
  check('Opnieuw openen: We Supply staat aangevinkt', box('We Supply')[0].checked);
  check('Opnieuw openen: Vroeg 1 is niet meer van Bert', !w.document.body.textContent.includes('(standaard: Bert)'));
  const applyBtn = [...w.document.querySelectorAll('button')].find(b => b.textContent.startsWith('Opslaan en toepassen op deze week'));
  const n0 = calls.length;
  await act(async () => { applyBtn.click(); }); await tick();
  const after = calls.slice(n0);
  const iPut = after.findIndex(c => c.startsWith('PUT /api/route-templates/1'));
  const iApply1 = after.findIndex(c => c.startsWith('POST /api/routes/apply-template/1') && c.includes(`"week_key":"${wk}"`));
  const iReload1 = after.findIndex((c, i) => i > iApply1 && c.startsWith(`GET /api/routes?week_key=${wk}`));
  check('Opslaan en toepassen: eerst opslaan, dan toepassen, dan herladen', iPut >= 0 && iApply1 > iPut && iReload1 > iApply1);

  // Via de personenbalk onderaan
  const chip = [...w.document.querySelectorAll('.rr-driver-chip .rr-person-name')].find(e => e.textContent === 'Bert');
  await act(async () => { chip.click(); }); await tick();
  check('Naam in de personenbalk opent ook het standaardrooster', w.document.body.textContent.includes('Standaardrooster Bert'));
  await act(async () => { byText('Annuleren', 'button')[0].click(); }); await tick();
  check('Annuleren sluit zonder opslaan', !calls.some(c => c.startsWith('PUT /api/route-templates/2')));

  // Invullen voor een bestaande week
  const n2 = calls.length;
  await act(async () => { byText('Standaardrooster invullen', 'button')[0].click(); }); await tick();
  const fill = calls.slice(n2);
  const iApply = fill.findIndex(c => c.startsWith('POST /api/routes/apply-template') && c.includes(`"week_key":"${wk}"`));
  check('Invullen stuurt apply-template voor deze week', iApply >= 0);
  check('Daarna worden de routes opnieuw geladen', fill.findIndex((c, i) => i > iApply && c.startsWith(`GET /api/routes?week_key=${wk}`)) > iApply);

  // Week leegmaken
  const n4 = calls.length;
  await act(async () => { byText('Week leegmaken', 'button')[0].click(); }); await tick();
  check('Week leegmaken stuurt clear voor deze week', calls.slice(n4).some(c => c.startsWith('POST /api/routes/clear') && c.includes(`"week_key":"${wk}"`)));
  check('Na leegmaken staan geen routes meer bij een chauffeur', byText('↩', 'span').length === 0);

  // Nieuwe week: eerst vaste routes aanmaken, dan standaardrooster, dan laden
  const n3 = calls.length;
  await act(async () => { byText('volgende week →', 'button')[0].click(); });
  for (let i = 0; i < 20 && w.document.getElementById('root').textContent.includes('Rooster laden…'); i++) await tick();
  const next = calls.slice(n3);
  const lastSeed = next.map(c => c.startsWith('POST /api/routes ')).lastIndexOf(true);
  const iNewApply = next.findIndex(c => c.startsWith('POST /api/routes/apply-template'));
  const iReload = next.map(c => c.startsWith('GET /api/routes?')).lastIndexOf(true);
  check('Nieuwe week: vaste routes aangemaakt', lastSeed >= 0);
  check('Nieuwe week: standaardrooster na het aanmaken toegepast', iNewApply > lastSeed);
  check('Nieuwe week: routes daarna opnieuw geladen', iReload > iNewApply);

  await check.report(t);
});
