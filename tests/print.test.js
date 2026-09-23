const { test } = require('node:test');
const { setupApp, checker } = require('./setup');

test('Gecombineerde print chauffeurs + magazijn', async t => {
  const { w, text, byText, tick, act, start } = setupApp({ extraRoutes: [{ id: 12, day_index: 4, code: 'Zeeland', driver_id: null, driver_name: null }] });
  const check = checker();
  let printed = null;
  w.print = () => {
    const el = w.document.querySelector('.rr-print-only');
    const tabWrapper = w.document.getElementById('root').firstChild.children[1];
    printed = {
      rows: el ? [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent)) : null,
      title: el && el.querySelector('h1').textContent,
      tabHidden: tabWrapper.className === 'no-print',
    };
  };

  await start();
  await act(async () => { byText('Magazijn', 'button')[0].click(); }); await tick();
  check('Geen printweergave vóór klikken', !w.document.querySelector('.rr-print-only'));
  await act(async () => { byText('Print chauffeurs + magazijn', 'button')[0].click(); }); await tick(); await tick();
  check('window.print() aangeroepen', !!printed && !!printed.rows);
  const row = name => printed.rows.find(r => r[0] === name);
  const names = printed.rows.map(r => r[0]);
  console.log('     ' + printed.title);
  printed.rows.forEach(r => console.log('     | ' + r.map(c => (c || '').padEnd(16)).join('| ')));
  check('Titel met weeknummer', /^Weekrooster week \d+ · /.test(printed.title));
  check('Volgorde: Chauffeurs, Ad, Bert, Niet toegewezen, Magazijn, Bert, Cor', JSON.stringify(names.slice(1)) === JSON.stringify(['Chauffeurs','Ad','Bert','Niet toegewezen','Magazijn','Bert','Cor']));
  check('Bert staat in beide groepen', names.filter(n => n === 'Bert').length === 2);
  check('Ad maandag: We Supply', row('Ad')[1] === 'We Supply');
  const bertRows = printed.rows.filter(r => r[0] === 'Bert');
  check('Bert bij Chauffeurs dinsdag: alleen Rotterdam', bertRows[0][2] === 'Rotterdam');
  check('Bert bij Magazijn dinsdag: alleen 07:00–15:00', bertRows[1][2] === '07:00–15:00');
  check('Cor maandag: "werkt" (dienst zonder tijden)', row('Cor')[1] === 'werkt');
  check('Cor woensdag: Vakantie/vrij', row('Cor')[3] === 'Vakantie/vrij');
  check('Niet toegewezen vrijdag: Zeeland', row('Niet toegewezen')[5] === 'Zeeland');
  check('Tabbladinhoud verborgen tijdens printen', printed.tabHidden);
  check('Printweergave weer weg na printen', !w.document.querySelector('.rr-print-only'));
  check('Gewone tab-inhoud weer zichtbaar', w.document.getElementById('root').firstChild.children[1].className === '');

  await check.report(t);
});
