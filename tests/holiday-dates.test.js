const { test } = require('node:test');
const assert = require('node:assert');
const { appScript } = require('./setup');

// Alleen de datumfuncties uit de app laden, zonder React
const src = appScript.slice(appScript.indexOf('function weekKey'), appScript.indexOf('function addWeeks'))
  + appScript.slice(appScript.indexOf('function getHolidays'), appScript.indexOf('function dayHeader'));
const { getHolidays, holidayName } = new Function(`${src}; return { getHolidays, holidayName };`)();

const expected = {
  // 2025: Koningsdag valt op zondag en schuift naar zaterdag 26 april
  2025: { '2025-01-01': 'Nieuwjaarsdag', '2025-04-21': '2e Paasdag', '2025-04-26': 'Koningsdag', '2025-05-29': 'Hemelvaartsdag', '2025-06-09': '2e Pinksterdag', '2025-12-25': '1e Kerstdag', '2025-12-26': '2e Kerstdag' },
  2026: { '2026-01-01': 'Nieuwjaarsdag', '2026-04-06': '2e Paasdag', '2026-04-27': 'Koningsdag', '2026-05-14': 'Hemelvaartsdag', '2026-05-25': '2e Pinksterdag', '2026-12-25': '1e Kerstdag', '2026-12-26': '2e Kerstdag' },
  2027: { '2027-01-01': 'Nieuwjaarsdag', '2027-03-29': '2e Paasdag', '2027-04-27': 'Koningsdag', '2027-05-06': 'Hemelvaartsdag', '2027-05-17': '2e Pinksterdag', '2027-12-25': '1e Kerstdag', '2027-12-26': '2e Kerstdag' },
  2028: { '2028-01-01': 'Nieuwjaarsdag', '2028-04-17': '2e Paasdag', '2028-04-27': 'Koningsdag', '2028-05-25': 'Hemelvaartsdag', '2028-06-05': '2e Pinksterdag', '2028-12-25': '1e Kerstdag', '2028-12-26': '2e Kerstdag' },
};

for (const [year, dates] of Object.entries(expected)) {
  test(`feestdagen ${year}`, () => assert.deepStrictEqual(getHolidays(Number(year)), dates));
}

test('holidayName geeft null op een gewone dag', () => {
  assert.strictEqual(holidayName('2026-04-27'), 'Koningsdag');
  assert.strictEqual(holidayName('2026-04-28'), null);
});

test('Goede Vrijdag en Bevrijdingsdag tellen niet mee', () => {
  assert.strictEqual(holidayName('2026-04-03'), null);
  assert.strictEqual(holidayName('2025-05-05'), null);
});
