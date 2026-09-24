const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Gecombineerde print van alle teams', async t => {
  const { w, text, byText, tick, act, start } = setupApp({ extraRoutes: [{ id: 12, day_index: 4, code: 'Zeeland', driver_id: null, driver_name: null }] });
  const check = checker();
  let printed = null;
  w.print = () => {
    const el = w.document.querySelector('.rr-print-only');
    const tabWrapper = w.document.getElementById('root').firstChild.children[1];
    printed = {
      rows: el ? [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent)) : null,
      colors: el ? [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.style.background)) : null,
      css: el && el.querySelector('style').textContent,
      cellFont: el && (td => td && { size: td.style.fontSize, weight: td.firstChild.style.fontWeight })([...el.querySelectorAll('td')].find(td => td.textContent === 'We Supply')),
      legend: el && el.querySelector('.rr-print-legend').textContent,
      title: el && el.querySelector('h1').textContent,
      tabHidden: tabWrapper.className === 'no-print',
    };
  };

  await start();
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  check('Geen printweergave vóór klikken', !w.document.querySelector('.rr-print-only'));
  await act(async () => { byText('Print rooster', 'button')[0].click(); }); await tick(); await tick();
  check('window.print() aangeroepen', !!printed && !!printed.rows);
  const row = name => printed.rows.find(r => r[0] === name);
  const names = printed.rows.map(r => r[0]);
  console.log('     ' + printed.title);
  printed.rows.forEach(r => console.log('     | ' + r.map(c => (c || '').padEnd(16)).join('| ')));
  check('Titel met weeknummer', /^Weekrooster week \d+ · /.test(printed.title));
  check('Volgorde: Chauffeurs, Ad, Bert, Niet toegewezen, Magazijn, Bert, Cor, Productie, Eva', JSON.stringify(names.slice(1)) === JSON.stringify(['Chauffeurs','Ad','Bert','Niet toegewezen','Magazijn','Bert','Cor','Productie','Eva']));
  check('Eva (productie) woensdag: 09:00–16:30', row('Eva')[3] === '09:00–16:30');
  check('Bert staat in beide groepen', names.filter(n => n === 'Bert').length === 2);
  check('Ad maandag: We Supply', row('Ad')[1] === 'We Supply');
  const bertRows = printed.rows.filter(r => r[0] === 'Bert');
  check('Bert bij Chauffeurs dinsdag: alleen Rotterdam', bertRows[0][2] === 'Rotterdam');
  check('Bert bij Magazijn dinsdag: alleen 07:00–15:00', bertRows[1][2] === '07:00–15:00');
  check('Cor maandag: "werkt" (dienst zonder tijden)', row('Cor')[1] === 'werkt');
  check('Cor woensdag: Vakantie/vrij', row('Cor')[3] === 'Vakantie/vrij');
  check('Niet toegewezen vrijdag: Zeeland', row('Niet toegewezen')[5] === 'Zeeland');
  // Kleuren: chauffeur lichtgroen, magazijn lichtblauw, vakantie oranje, niet werken wit met streepje
  const colorsOf = name => printed.colors[printed.rows.findIndex(r => r[0] === name)];
  const bertColors = printed.rows.map((r, i) => r[0] === 'Bert' ? printed.colors[i] : null).filter(Boolean);
  check('Ad maandag (rijdt) lichtgroen', colorsOf('Ad')[1] === 'rgb(205, 235, 197)');
  check('Bert magazijn dinsdag lichtblauw', bertColors[1][2] === 'rgb(201, 226, 248)');
  check('Eva productie woensdag lichtgeel', colorsOf('Eva')[3] === 'rgb(255, 240, 160)');
  check('Cor woensdag vakantie oranje', colorsOf('Cor')[3] === 'rgb(255, 184, 102)');
  check('Ad dinsdag (werkt niet) wit met streepje', row('Ad')[2] === '–' && colorsOf('Ad')[2] === 'rgb(255, 255, 255)');
  check('Print: tekst in de vakjes 12px en vet', printed.cellFont && printed.cellFont.size === '12px' && printed.cellFont.weight === '700');
  check('Print staand A4', printed.css.includes('size: A4 portrait'));
  check('Legenda met Chauffeur, Magazijn, Productie, Vakantie/vrij, Ziek, Niet beschikbaar', ['Chauffeur', 'Magazijn', 'Productie', 'Vakantie/vrij', 'Ziek', 'Niet beschikbaar'].every(l => printed.legend.includes(l)));
  check('Tabbladinhoud verborgen tijdens printen', printed.tabHidden);
  check('Printweergave weer weg na printen', !w.document.querySelector('.rr-print-only'));
  check('Gewone tab-inhoud weer zichtbaar', w.document.getElementById('root').firstChild.children[1].className === '');

  await check.report(t);
});
