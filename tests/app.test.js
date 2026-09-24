const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Teams, magazijnrooster, uren en standaardrooster', async t => {
  const { w, calls, text, byText, tick, act, start, monday: mon, weekKey: wk } = setupApp();
  const check = checker();


  await start();

  // Chauffeurs-tab
  const chauffeurChips = [...w.document.querySelectorAll('.rr-driver-chip')].map(e => e.firstChild.textContent);
  check('Chauffeurs-tab toont alleen Ad en Bert in de personenbalk', JSON.stringify(chauffeurChips) === '["Ad","Bert"]');
  check('Chip van Bert toont "+ magazijn"', text().includes('+ magazijn'));
  check('Chauffeurs-tab: waarschuwing "⚠ magazijn" bij Bert (dubbel op dinsdag)', text().includes('⚠ magazijn'));
  check('Keuzelijst "+ iemand uit een ander team toevoegen" met Cor en Eva', byText('Cor', 'option').length === 1 && byText('Eva', 'option').length === 1);

  // Naar Magazijn
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  const whChips = [...w.document.querySelectorAll('.rr-driver-chip')].map(e => e.firstChild.textContent);
  check('Magazijn-tab toont alleen Bert en Cor', JSON.stringify(whChips) === '["Bert","Cor"]');
  check('Magazijn-tab: "⚠ rijdt: Rotterdam" bij Bert', text().includes('⚠ rijdt: Rotterdam'));
  check('Cor heeft vakantie op woensdag', text().includes('Vakantie/vrij'));
  check('Ad staat niet in het magazijnrooster', !whChips.includes('Ad') && byText('Ad', 'div').length === 0);
  check('Week openen: standaardrooster en diensten in één verzoek (fill_new)', calls.some(c => c.startsWith('POST /api/warehouse-shifts/open-week') && c.includes('"fill_new":true')));
  check('Dienst toont tijden "07:00–15:00"', text().includes('07:00–15:00'));
  check('Dienst zonder tijden toont "Werkt"', byText('Werkt', 'span').length === 1);
  // Uren per persoon in het blok "Uren deze week"
  const hoursOf = name => { const row = [...w.document.querySelectorAll('div')].find(d => d.children.length === 2 && d.children[0].textContent === name && /^[\d,]+$/.test(d.children[1].textContent)); return row && row.children[1].textContent; };
  check('Bert 7,5 uur (8 uur min pauze), Cor 0 (dienst zonder tijden telt 0)', hoursOf('Bert') === '7,5' && hoursOf('Cor') === '0');
  check('Geen tegels "diensten totaal" en "uren totaal" meer', !text().includes('diensten totaal') && !text().includes('uren totaal'));
  const sm = (a, b) => w.shiftMinutes({ start_time: a, end_time: b });
  check('Precies 5,5 uur: geen pauze', sm('08:00', '13:30') === 330);
  check('5,5 uur + 1 min: half uur pauze eraf', sm('08:00', '13:31') === 301);
  check('Korte dienst 4 uur: geen pauze', sm('09:00', '13:00') === 240);

  const cells = () => [...w.document.querySelectorAll('.rr-shift-cell')];
  const click = el => act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 })); });
  // rijen: Bert (0-4), Cor (5-9)
  await click(cells()[5 + 1]); await tick();
  check('Lege cel met standaardrooster krijgt 09:00–13:00', calls.some(c => c.startsWith('POST /api/warehouse-shifts ') && c.includes('"driver_id":3') && c.includes('"start_time":"09:00","end_time":"13:00"')));
  await click(cells()[0]); await tick();
  check('Lege cel zonder standaardrooster krijgt 07:00–16:30', calls.some(c => c.startsWith('POST /api/warehouse-shifts ') && c.includes('"day_index":0,"driver_id":2') && c.includes('"start_time":"07:00","end_time":"16:30"')));
  check('Uren nu Bert 7,5 + 9 = 16,5 en Cor 4', hoursOf('Bert') === '16,5' && hoursOf('Cor') === '4');
  const before = calls.length;
  await click(cells()[5 + 2]); await tick();
  check('Vakantiecel doet niets bij klikken', calls.length === before);

  // Ingevulde cel -> tijden aanpassen
  await click(cells()[1]); await tick();
  const setVal = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  const timeInputs = () => [...w.document.querySelectorAll('input[type=time]')];
  check('Bewerkvenster opent met huidige tijden', timeInputs().length === 2 && timeInputs()[0].value === '07:00');
  await act(async () => { setVal.call(timeInputs()[1], '17:00'); timeInputs()[1].dispatchEvent(new w.Event('input', { bubbles: true })); });
  await act(async () => { byText('Opslaan', 'button')[0].click(); }); await tick();
  check('Opslaan stuurt 07:00–17:00', calls.some(c => c.startsWith('POST /api/warehouse-shifts ') && c.includes('"start_time":"07:00","end_time":"17:00"')));
  check('Cel toont nu 07:00–17:00', text().includes('07:00–17:00'));
  // Ongeldige tijden: opslaan uitgeschakeld
  await click(cells()[1]); await tick();
  await act(async () => { setVal.call(timeInputs()[1], '06:00'); timeInputs()[1].dispatchEvent(new w.Event('input', { bubbles: true })); });
  check('Eindtijd vóór begintijd: Opslaan uitgeschakeld', byText('Opslaan', 'button')[0].disabled === true);
  await act(async () => { byText('Werkt niet', 'button')[0].click(); }); await tick();
  check('"Werkt niet" verwijdert de dienst', calls.some(c => c.startsWith('DELETE /api/warehouse-shifts') && c.includes('"day_index":1,"driver_id":2')));

  // Standaardrooster via naam
  await act(async () => { w.document.querySelector('.rr-person-name').click(); }); await tick();
  check('Klik op naam opent standaardrooster', text().includes('Standaardrooster Bert'));
  const boxes = [...w.document.querySelectorAll('input[type=checkbox]')];
  await act(async () => { boxes[0].click(); boxes[4].click(); });
  check('Totaal per week 18 uur (2 × 9)', text().includes('18 uur'));
  await act(async () => { byText('Opslaan', 'button')[0].click(); }); await tick();
  check('Opslaan stuurt PUT met ma en vr', calls.some(c => c.startsWith('PUT /api/warehouse-templates/2') && c.includes('"day_index":0') && c.includes('"day_index":4') && !c.includes('"day_index":1')));
  check('Venster sluit na opslaan', !text().includes('Standaardrooster Bert'));

  // Opslaan en toepassen op deze week
  await act(async () => { w.document.querySelector('.rr-person-name').click(); }); await tick();
  const applyBtn = [...w.document.querySelectorAll('button')].find(b => b.textContent.startsWith('Opslaan en toepassen op deze week'));
  check('Knop "Opslaan en toepassen op deze week" aanwezig', !!applyBtn);
  const n = calls.length;
  await act(async () => { applyBtn.click(); }); await tick();
  const newCalls = calls.slice(n);
  const iPut = newCalls.findIndex(c => c.startsWith('PUT /api/warehouse-templates/2'));
  const iApply = newCalls.findIndex(c => c.startsWith('POST /api/warehouse-shifts/apply-template/2') && c.includes(`"week_key":"${wk}"`));
  const iReload = newCalls.findIndex((c, i) => i > iApply && c.startsWith('GET /api/warehouse-shifts?'));
  check('Eerst template opslaan, dan toepassen op week, dan herladen', iPut >= 0 && iApply > iPut && iReload > iApply);
  check('Venster sluit', !text().includes('Standaardrooster Bert'));

  await act(async () => { byText('Standaardrooster toepassen', 'button')[0].click(); }); await tick();
  check('Knop past standaardrooster toe (only_if_new=false)', calls.some(c => c.startsWith('POST /api/warehouse-shifts/apply-template') && c.includes('"only_if_new":false')));

  // Ad koppelen aan magazijn via keuzelijst
  const sel = [...w.document.querySelectorAll('select')].find(s => s.textContent.includes('iemand uit een ander team'));
  await act(async () => { sel.value = '1'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }); await tick();
  check('Ad koppelen stuurt PATCH is_warehouse=1', calls.some(c => c.startsWith('PATCH /api/drivers/1') && c.includes('"is_warehouse":1')));
  check('Ad staat nu in het magazijn', [...w.document.querySelectorAll('.rr-driver-chip')].some(e => e.firstChild.textContent === 'Ad'));

  // Nieuwe persoon op Magazijn
  const input = w.document.querySelector('.rr-input');
  await act(async () => { setVal.call(input, 'Dirk'); input.dispatchEvent(new w.Event('input', { bubbles: true })); });
  await act(async () => { byText('+ toevoegen', 'button')[0].click(); }); await tick();
  check('Nieuwe persoon krijgt is_warehouse=1, is_driver=0, is_production=0', calls.some(c => c.startsWith('POST /api/drivers') && c.includes('"is_driver":0,"is_warehouse":1,"is_production":0')));

  // Rechtsklik -> niet beschikbaar
  const cells2 = cells();
  await act(async () => { cells2[0].dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
  await act(async () => { byText('Niet beschikbaar', 'div').find(e => e.style.cursor === 'pointer').click(); }); await tick();
  check('Rechtsklik maakt iemand niet beschikbaar', calls.some(c => c.startsWith('POST /api/vacations') && c.includes('unavailable')));

  // Week behouden bij wisselen
  await act(async () => { w.document.querySelector('[aria-label="Volgende week"]').click(); }); await tick();
  await act(async () => { byText('Chauffeurs', 'button')[0].click(); }); await tick();
  check('Week blijft behouden bij wisselen van tab', byText('Naar deze week', 'button').length === 1);
  await act(async () => { byText('Naar deze week', 'button')[0].click(); }); await tick();
  check('"Naar deze week" gaat terug en toont weer het label "deze week"', byText('Naar deze week', 'button').length === 0 && text().includes('deze week'));
  await act(async () => { w.document.querySelector('[aria-label="Vorige week"]').click(); }); await tick();
  const weekNr = w.document.querySelector('.rr-week-number').textContent;
  check('Pijltje terug: weeknummer één lager', weekNr === `Week ${w.getISOWeekNumber(new Date(mon.getTime() - 7 * 86400000))}`);

  await check.report(t);
});
