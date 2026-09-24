require('dotenv').config();
const path = require('path');
const express = require('express');
const { db, initSchema } = require('./db');
const { login, logout, requireLogin } = require('./auth');
const app = express();
const PORT = process.env.PORT || 3000;

// Op Render komt al het verkeer via Renders proxy. Die proxy vertrouwen, zodat req.ip het adres van de bezoeker is
// (voor de blokkade na foute pogingen) en req.secure https herkent (voor de Secure-cookie). Lokaal niet, anders
// kan een bezoeker zelf een X-Forwarded-For meesturen om de blokkade te omzeilen.
if (process.env.RENDER) app.set('trust proxy', 1);

app.use(express.json());

// Alleen het inlogscherm en inloggen zelf zijn zonder login bereikbaar
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/api/login', login);
app.post('/api/logout', logout);
app.use(requireLogin);

app.use(express.static('public'));

app.get('/api/drivers', async (req, res) => {
  const result = await db.execute('SELECT * FROM drivers ORDER BY name');
  res.json(result.rows);
});

app.post('/api/drivers', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is verplicht' });
  const is_driver = req.body.is_driver === undefined ? 1 : (req.body.is_driver ? 1 : 0);
  const is_warehouse = req.body.is_warehouse ? 1 : 0;
  const is_production = req.body.is_production ? 1 : 0;
  try {
    const result = await db.execute({
      sql: 'INSERT INTO drivers (name, is_driver, is_warehouse, is_production) VALUES (?, ?, ?, ?)',
      args: [name, is_driver, is_warehouse, is_production],
    });
    res.status(201).json({ id: Number(result.lastInsertRowid), name, is_driver, is_warehouse, is_production });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'naam bestaat al' });
    }
    throw err;
  }
});

// Teamlidmaatschap aanpassen (chauffeur, magazijn en/of productie)
app.patch('/api/drivers/:id', async (req, res) => {
  const existingResult = await db.execute({ sql: 'SELECT * FROM drivers WHERE id = ?', args: [req.params.id] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'persoon niet gevonden' });

  const is_driver = req.body.is_driver !== undefined ? (req.body.is_driver ? 1 : 0) : existing.is_driver;
  const is_warehouse = req.body.is_warehouse !== undefined ? (req.body.is_warehouse ? 1 : 0) : existing.is_warehouse;
  const is_production = req.body.is_production !== undefined ? (req.body.is_production ? 1 : 0) : existing.is_production;
  await db.execute({
    sql: 'UPDATE drivers SET is_driver = ?, is_warehouse = ?, is_production = ? WHERE id = ?',
    args: [is_driver, is_warehouse, is_production, req.params.id],
  });
  res.json({ id: Number(req.params.id), name: existing.name, is_driver, is_warehouse, is_production });
});

app.delete('/api/drivers/:id', async (req, res) => {
  // Expliciet verwijderen: ON DELETE CASCADE werkt alleen als foreign_keys aan staat op de verbinding
  await db.execute({ sql: 'DELETE FROM warehouse_shifts WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM warehouse_templates WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM production_shifts WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM production_templates WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM route_templates WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM drivers WHERE id = ?', args: [req.params.id] });
  res.status(204).send();
});

app.get('/api/vacations', async (req, res) => {
  const result = await db.execute(`
    SELECT vacations.id, vacations.start_date, vacations.end_date, vacations.type,
           drivers.id AS driver_id, drivers.name AS driver_name
    FROM vacations
    JOIN drivers ON drivers.id = vacations.driver_id
  `);
  res.json(result.rows);
});

app.post('/api/vacations', async (req, res) => {
  const { driver_id, start_date, end_date, type } = req.body;
  if (!driver_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'driver_id, start_date en end_date zijn verplicht' });
  }
  const finalType = ['unavailable', 'sick'].includes(type) ? type : 'vacation';
  const result = await db.execute({
    sql: 'INSERT INTO vacations (driver_id, start_date, end_date, type) VALUES (?, ?, ?, ?)',
    args: [driver_id, start_date, end_date, finalType],
  });
  // Bij ziekte gaan de routes van die dagen terug naar "niet toegewezen", zodat iemand anders ze kan rijden
  let unassigned = 0;
  if (finalType === 'sick') {
    const cleared = await db.execute({
      sql: `UPDATE routes SET driver_id = NULL
            WHERE driver_id = ? AND date(week_key, '+' || day_index || ' days') BETWEEN ? AND ?`,
      args: [driver_id, start_date, end_date],
    });
    unassigned = cleared.rowsAffected;
  }
  res.status(201).json({ id: Number(result.lastInsertRowid), driver_id, start_date, end_date, type: finalType, unassigned });
});

app.delete('/api/vacations/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM vacations WHERE id = ?', args: [req.params.id] });
  res.status(204).send();
});

// Routes van een week met de naam van de chauffeur
function selectWeekRoutes(weekKey) {
  return {
    sql: `
      SELECT routes.id, routes.day_index, routes.code,
             drivers.id AS driver_id, drivers.name AS driver_name
      FROM routes
      LEFT JOIN drivers ON drivers.id = routes.driver_id
      WHERE routes.week_key = ?
      ORDER BY routes.day_index, routes.id
    `,
    args: [weekKey],
  };
}

app.get('/api/routes', async (req, res) => {
  const { week_key } = req.query;
  if (!week_key) {
    return res.status(400).json({ error: 'week_key is verplicht (bijv. ?week_key=2026-09-15)' });
  }
  const result = await db.execute(selectWeekRoutes(week_key));
  res.json(result.rows);
});

app.post('/api/routes', async (req, res) => {
  const { week_key, day_index, code } = req.body;
  if (!week_key || day_index === undefined) {
    return res.status(400).json({ error: 'week_key en day_index zijn verplicht' });
  }
  const result = await db.execute({
    sql: 'INSERT INTO routes (week_key, day_index, code, driver_id) VALUES (?, ?, ?, NULL)',
    args: [week_key, day_index, code || ''],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid), week_key, day_index, code: code || '', driver_id: null });
});

app.patch('/api/routes/:id', async (req, res) => {
  const { code, driver_id, day_index } = req.body;
  if (day_index !== undefined && !(Number.isInteger(day_index) && day_index >= 0 && day_index <= 4)) {
    return res.status(400).json({ error: 'day_index moet 0 t/m 4 zijn' });
  }
  const existingResult = await db.execute({ sql: 'SELECT * FROM routes WHERE id = ?', args: [req.params.id] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'route niet gevonden' });

  const newCode = code !== undefined ? code : existing.code;
  const newDriverId = driver_id !== undefined ? driver_id : existing.driver_id;
  const newDayIndex = day_index !== undefined ? day_index : existing.day_index;

  await db.execute({
    sql: 'UPDATE routes SET code = ?, driver_id = ?, day_index = ? WHERE id = ?',
    args: [newCode, newDriverId, newDayIndex, req.params.id],
  });
  res.json({ id: Number(req.params.id), week_key: existing.week_key, day_index: newDayIndex, code: newCode, driver_id: newDriverId });
});

app.delete('/api/routes/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM routes WHERE id = ?', args: [req.params.id] });
  res.status(204).send();
});

app.get('/api/route-templates', async (req, res) => {
  const result = await db.execute('SELECT day_index, code, driver_id FROM route_templates ORDER BY day_index, code');
  res.json(result.rows);
});

// Vervangt de vaste routes van één chauffeur. Een route die eerst bij iemand anders stond, gaat over naar deze chauffeur.
app.put('/api/route-templates/:driverId', async (req, res) => {
  const routes = Array.isArray(req.body.routes) ? req.body.routes : null;
  if (!routes) return res.status(400).json({ error: 'routes is verplicht' });
  for (const r of routes) {
    if (!(Number.isInteger(r.day_index) && r.day_index >= 0 && r.day_index <= 4) || typeof r.code !== 'string' || !r.code) {
      return res.status(400).json({ error: 'elke route heeft een day_index (0-4) en code nodig' });
    }
  }
  const driverId = Number(req.params.driverId);
  await db.batch([
    { sql: 'DELETE FROM route_templates WHERE driver_id = ?', args: [driverId] },
    ...routes.map(r => ({
      sql: `INSERT INTO route_templates (day_index, code, driver_id) VALUES (?, ?, ?)
            ON CONFLICT (day_index, code) DO UPDATE SET driver_id = excluded.driver_id`,
      args: [r.day_index, r.code, driverId],
    })),
  ], 'write');
  const result = await db.execute('SELECT day_index, code, driver_id FROM route_templates ORDER BY day_index, code');
  res.json(result.rows);
});

// Vult routes van een week zonder (geldige) chauffeur met de vaste chauffeur uit het standaardrooster.
// Slaat over: dagen in skip_days (feestdagen), chauffeurs die niet meer in het team zitten en
// chauffeurs met vakantie, niet beschikbaar of ziek op die dag. Met de hand toegewezen routes blijven staan.
function applyRouteTemplate(weekKey, skipDays) {
  const templateDriver = `
    SELECT t.driver_id FROM route_templates t
    JOIN drivers d ON d.id = t.driver_id
    WHERE t.day_index = routes.day_index AND t.code = routes.code AND d.is_driver = 1
      AND ${notAwayClause('t.driver_id')}`;
  return {
    sql: `UPDATE routes SET driver_id = (${templateDriver})
          WHERE week_key = ?
            AND (driver_id IS NULL OR driver_id NOT IN (SELECT id FROM drivers WHERE is_driver = 1))
            AND EXISTS (${templateDriver})${skipDaysClause(skipDays, 'day_index')}`,
    args: [weekKey],
  };
}

app.post('/api/routes/apply-template', async (req, res) => {
  const { week_key, skip_days } = req.body;
  if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
  const result = await db.execute(applyRouteTemplate(week_key, skip_days));
  res.json({ updated: result.rowsAffected });
});

// Nieuwe week in één keer: vaste routes aanmaken (alleen als de week nog leeg is), standaardrooster toepassen
// en de routes teruggeven. Eén transactie, één keer heen en weer naar de database.
app.post('/api/routes/new-week', async (req, res) => {
  const { week_key, routes, skip_days } = req.body;
  if (!week_key || !Array.isArray(routes)) return res.status(400).json({ error: 'week_key en routes zijn verplicht' });
  for (const r of routes) {
    if (!(Number.isInteger(r.day_index) && r.day_index >= 0 && r.day_index <= 4) || typeof r.code !== 'string') {
      return res.status(400).json({ error: 'elke route heeft een day_index (0-4) en code nodig' });
    }
  }
  const statements = [];
  if (routes.length > 0) {
    // NOT EXISTS: opent iemand anders tegelijk dezelfde week, dan komen de routes er niet dubbel in
    statements.push({
      sql: `INSERT INTO routes (week_key, day_index, code, driver_id)
            SELECT ?, v.column1, v.column2, NULL FROM (VALUES ${routes.map(() => '(?, ?)').join(', ')}) v
            WHERE NOT EXISTS (SELECT 1 FROM routes WHERE week_key = ?)`,
      args: [week_key, ...routes.flatMap(r => [r.day_index, r.code]), week_key],
    });
  }
  statements.push(applyRouteTemplate(week_key, skip_days), selectWeekRoutes(week_key));
  const results = await db.batch(statements, 'write');
  res.json(results[results.length - 1].rows);
});

// Alle routes van een week terug naar "niet toegewezen"; de routes zelf blijven bestaan
app.post('/api/routes/clear', async (req, res) => {
  const { week_key } = req.body;
  if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
  const result = await db.execute({ sql: 'UPDATE routes SET driver_id = NULL WHERE week_key = ?', args: [week_key] });
  res.json({ updated: result.rowsAffected });
});

// Zet de vaste routes van één chauffeur in deze week op zijn naam, ook als er al iemand anders op stond.
// Niet op feestdagen (skip_days) of als hij die dag vakantie heeft, niet beschikbaar of ziek is.
app.post('/api/routes/apply-template/:driverId', async (req, res) => {
  const { week_key, skip_days } = req.body;
  if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
  const driverId = Number(req.params.driverId);
  const result = await db.execute({
    sql: `UPDATE routes SET driver_id = ?
          WHERE week_key = ?
            AND EXISTS (SELECT 1 FROM route_templates t WHERE t.driver_id = ? AND t.day_index = routes.day_index AND t.code = routes.code)
            AND ${notAwayClause('?')}${skipDaysClause(skip_days, 'day_index')}`,
    args: [driverId, week_key, driverId, driverId],
  });
  res.json({ updated: result.rowsAffected });
});

// SQL-voorwaarde: de chauffeur heeft op de dag van de route geen vakantie, niet-beschikbaar of ziekmelding
function notAwayClause(driverColumn) {
  return `NOT EXISTS (
        SELECT 1 FROM vacations v
        WHERE v.driver_id = ${driverColumn}
          AND date(routes.week_key, '+' || routes.day_index || ' days') BETWEEN v.start_date AND v.end_date
      )`;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// skip_days: dagen (0-4) die het standaardrooster overslaat, zoals feestdagen. Levert een veilig SQL-stukje op.
function skipDaysClause(skipDays, column) {
  const days = (Array.isArray(skipDays) ? skipDays : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 4);
  return days.length ? ` AND ${column} NOT IN (${days.join(', ')})` : '';
}

// Teams die in diensten werken (met begin- en eindtijd). Elk team heeft eigen tabellen
// <team>_shifts, <team>_templates en <team>_weeks en eigen adressen /api/<team>-shifts en /api/<team>-templates.
const SHIFT_TEAMS = { warehouse: 'is_warehouse', production: 'is_production' };

for (const [team, teamColumn] of Object.entries(SHIFT_TEAMS)) {
  app.get(`/api/${team}-shifts`, async (req, res) => {
    const { week_key } = req.query;
    if (!week_key) {
      return res.status(400).json({ error: 'week_key is verplicht (bijv. ?week_key=2026-09-15)' });
    }
    const result = await db.execute({
      sql: `SELECT id, day_index, driver_id, start_time, end_time FROM ${team}_shifts WHERE week_key = ?`,
      args: [week_key],
    });
    res.json(result.rows);
  });

  // Dienst aanmaken of de tijden van een bestaande dienst aanpassen
  app.post(`/api/${team}-shifts`, async (req, res) => {
    const { week_key, day_index, driver_id, start_time, end_time } = req.body;
    if (!week_key || day_index === undefined || !driver_id) {
      return res.status(400).json({ error: 'week_key, day_index en driver_id zijn verplicht' });
    }
    if (!TIME_PATTERN.test(start_time) || !TIME_PATTERN.test(end_time) || start_time >= end_time) {
      return res.status(400).json({ error: 'geldige start_time en end_time (HH:MM, start vóór eind) zijn verplicht' });
    }
    await db.execute({
      sql: `INSERT INTO ${team}_shifts (week_key, day_index, driver_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (week_key, day_index, driver_id) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time`,
      args: [week_key, day_index, driver_id, start_time, end_time],
    });
    res.status(201).json({ week_key, day_index, driver_id, start_time, end_time });
  });

  // Week openen in één keer: is de week nieuw (nog niet gemarkeerd), dan eerst het standaardrooster invullen;
  // daarna de diensten teruggeven. Eén transactie, één keer heen en weer naar de database.
  app.post(`/api/${team}-shifts/open-week`, async (req, res) => {
    const { week_key, fill_new, skip_days } = req.body;
    if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
    const statements = [];
    if (fill_new) {
      statements.push(
        // Eerst invullen zolang de week nog niet gemarkeerd is...
        {
          sql: `INSERT OR IGNORE INTO ${team}_shifts (week_key, day_index, driver_id, start_time, end_time)
                SELECT ?, t.day_index, t.driver_id, t.start_time, t.end_time
                FROM ${team}_templates t
                JOIN drivers d ON d.id = t.driver_id
                WHERE d.${teamColumn} = 1
                  AND NOT EXISTS (SELECT 1 FROM ${team}_weeks WHERE week_key = ?)
                  AND t.driver_id NOT IN (SELECT driver_id FROM ${team}_shifts WHERE week_key = ?)${skipDaysClause(skip_days, 't.day_index')}`,
          args: [week_key, week_key, week_key],
        },
        // ...dan markeren, maar alleen als er standaardroosters zijn (anders later nooit meer ingevuld)
        {
          sql: `INSERT OR IGNORE INTO ${team}_weeks (week_key) SELECT ? WHERE EXISTS (SELECT 1 FROM ${team}_templates)`,
          args: [week_key],
        }
      );
    }
    statements.push({ sql: `SELECT id, day_index, driver_id, start_time, end_time FROM ${team}_shifts WHERE week_key = ?`, args: [week_key] });
    const results = await db.batch(statements, 'write');
    res.json(results[results.length - 1].rows);
  });

  // Standaardrooster invullen voor iedereen in het team die die week nog geen diensten heeft.
  // Met only_if_new gebeurt dat alleen de eerste keer dat de week wordt geopend.
  app.post(`/api/${team}-shifts/apply-template`, async (req, res) => {
    const { week_key, only_if_new, skip_days } = req.body;
    if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
    // Zonder standaardroosters niets markeren, anders krijgt deze week later nooit meer het standaardrooster
    const templateCount = await db.execute(`SELECT COUNT(*) AS n FROM ${team}_templates`);
    if (Number(templateCount.rows[0].n) === 0) return res.json({ applied: false });
    const marked = await db.execute({ sql: `INSERT OR IGNORE INTO ${team}_weeks (week_key) VALUES (?)`, args: [week_key] });
    if (only_if_new && marked.rowsAffected === 0) return res.json({ applied: false });
    await db.execute({
      sql: `INSERT OR IGNORE INTO ${team}_shifts (week_key, day_index, driver_id, start_time, end_time)
            SELECT ?, t.day_index, t.driver_id, t.start_time, t.end_time
            FROM ${team}_templates t
            JOIN drivers d ON d.id = t.driver_id
            WHERE d.${teamColumn} = 1
              AND t.driver_id NOT IN (SELECT driver_id FROM ${team}_shifts WHERE week_key = ?)${skipDaysClause(skip_days, 't.day_index')}`,
      args: [week_key, week_key],
    });
    res.json({ applied: true });
  });

  app.delete(`/api/${team}-shifts`, async (req, res) => {
    const { week_key, day_index, driver_id } = req.body;
    if (!week_key || day_index === undefined || !driver_id) {
      return res.status(400).json({ error: 'week_key, day_index en driver_id zijn verplicht' });
    }
    await db.execute({
      sql: `DELETE FROM ${team}_shifts WHERE week_key = ? AND day_index = ? AND driver_id = ?`,
      args: [week_key, day_index, driver_id],
    });
    res.status(204).send();
  });

  // Alle diensten van dit team in een week weghalen. De week blijft gemarkeerd, dus het standaardrooster
  // wordt niet vanzelf opnieuw ingevuld; daarvoor is de knop "Standaardrooster invullen".
  app.post(`/api/${team}-shifts/clear`, async (req, res) => {
    const { week_key } = req.body;
    if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
    const result = await db.execute({ sql: `DELETE FROM ${team}_shifts WHERE week_key = ?`, args: [week_key] });
    res.json({ deleted: result.rowsAffected });
  });

  // Vervangt de diensten van één persoon in een week door diens standaardrooster
  app.post(`/api/${team}-shifts/apply-template/:driverId`, async (req, res) => {
    const { week_key, skip_days } = req.body;
    if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
    const driverId = Number(req.params.driverId);
    await db.batch([
      { sql: `DELETE FROM ${team}_shifts WHERE week_key = ? AND driver_id = ?`, args: [week_key, driverId] },
      {
        sql: `INSERT INTO ${team}_shifts (week_key, day_index, driver_id, start_time, end_time)
              SELECT ?, day_index, driver_id, start_time, end_time FROM ${team}_templates WHERE driver_id = ?${skipDaysClause(skip_days, 'day_index')}`,
        args: [week_key, driverId],
      },
    ], 'write');
    res.json({ applied: true });
  });

  app.get(`/api/${team}-templates`, async (req, res) => {
    const result = await db.execute(`SELECT driver_id, day_index, start_time, end_time FROM ${team}_templates ORDER BY driver_id, day_index`);
    res.json(result.rows);
  });

  // Vervangt het hele standaardrooster van één persoon
  app.put(`/api/${team}-templates/:driverId`, async (req, res) => {
    const days = Array.isArray(req.body.days) ? req.body.days : null;
    if (!days) return res.status(400).json({ error: 'days is verplicht' });
    for (const d of days) {
      if (!(d.day_index >= 0 && d.day_index <= 4) || !TIME_PATTERN.test(d.start_time) || !TIME_PATTERN.test(d.end_time) || d.start_time >= d.end_time) {
        return res.status(400).json({ error: 'elke dag heeft een day_index (0-4) en geldige start_time en end_time nodig' });
      }
    }
    const driverId = Number(req.params.driverId);
    await db.batch([
      { sql: `DELETE FROM ${team}_templates WHERE driver_id = ?`, args: [driverId] },
      ...days.map(d => ({
        sql: `INSERT INTO ${team}_templates (driver_id, day_index, start_time, end_time) VALUES (?, ?, ?, ?)`,
        args: [driverId, d.day_index, d.start_time, d.end_time],
      })),
    ], 'write');
    res.json(days.map(d => ({ driver_id: driverId, day_index: d.day_index, start_time: d.start_time, end_time: d.end_time })));
  });
}

// Express 5 stuurt fouten uit async handlers hierheen; geef JSON terug i.p.v. een HTML-foutpagina
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'serverfout' });
});

initSchema()
  .then(async () => {
    const password = await db.execute("SELECT 1 FROM settings WHERE key = 'password_hash'");
    if (password.rows.length === 0) {
      console.warn('Let op: er is nog geen wachtwoord ingesteld, dus niemand kan inloggen. Stel het in met: npm run set-password');
    }
    app.listen(PORT, () => {
      console.log(`Server draait op http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Kon database niet initialiseren:', err);
    process.exit(1);
  });