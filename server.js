require('dotenv').config();
const express = require('express');
const { db, initSchema } = require('./db');
const app = express();
const PORT = 3000;

app.use(express.json());
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
  try {
    const result = await db.execute({
      sql: 'INSERT INTO drivers (name, is_driver, is_warehouse) VALUES (?, ?, ?)',
      args: [name, is_driver, is_warehouse],
    });
    res.status(201).json({ id: Number(result.lastInsertRowid), name, is_driver, is_warehouse });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'naam bestaat al' });
    }
    throw err;
  }
});

// Teamlidmaatschap aanpassen (chauffeur en/of magazijn)
app.patch('/api/drivers/:id', async (req, res) => {
  const existingResult = await db.execute({ sql: 'SELECT * FROM drivers WHERE id = ?', args: [req.params.id] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'persoon niet gevonden' });

  const is_driver = req.body.is_driver !== undefined ? (req.body.is_driver ? 1 : 0) : existing.is_driver;
  const is_warehouse = req.body.is_warehouse !== undefined ? (req.body.is_warehouse ? 1 : 0) : existing.is_warehouse;
  await db.execute({
    sql: 'UPDATE drivers SET is_driver = ?, is_warehouse = ? WHERE id = ?',
    args: [is_driver, is_warehouse, req.params.id],
  });
  res.json({ id: Number(req.params.id), name: existing.name, is_driver, is_warehouse });
});

app.delete('/api/drivers/:id', async (req, res) => {
  // Expliciet verwijderen: ON DELETE CASCADE werkt alleen als foreign_keys aan staat op de verbinding
  await db.execute({ sql: 'DELETE FROM warehouse_shifts WHERE driver_id = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM warehouse_templates WHERE driver_id = ?', args: [req.params.id] });
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
  const finalType = type === 'unavailable' ? 'unavailable' : 'vacation';
  const result = await db.execute({
    sql: 'INSERT INTO vacations (driver_id, start_date, end_date, type) VALUES (?, ?, ?, ?)',
    args: [driver_id, start_date, end_date, finalType],
  });
  res.status(201).json({ id: Number(result.lastInsertRowid), driver_id, start_date, end_date, type: finalType });
});

app.delete('/api/vacations/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM vacations WHERE id = ?', args: [req.params.id] });
  res.status(204).send();
});

app.get('/api/routes', async (req, res) => {
  const { week_key } = req.query;
  if (!week_key) {
    return res.status(400).json({ error: 'week_key is verplicht (bijv. ?week_key=2026-09-15)' });
  }
  const result = await db.execute({
    sql: `
      SELECT routes.id, routes.day_index, routes.code,
             drivers.id AS driver_id, drivers.name AS driver_name
      FROM routes
      LEFT JOIN drivers ON drivers.id = routes.driver_id
      WHERE routes.week_key = ?
      ORDER BY routes.day_index, routes.id
    `,
    args: [week_key],
  });
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
  const { code, driver_id } = req.body;
  const existingResult = await db.execute({ sql: 'SELECT * FROM routes WHERE id = ?', args: [req.params.id] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'route niet gevonden' });

  const newCode = code !== undefined ? code : existing.code;
  const newDriverId = driver_id !== undefined ? driver_id : existing.driver_id;

  await db.execute({
    sql: 'UPDATE routes SET code = ?, driver_id = ? WHERE id = ?',
    args: [newCode, newDriverId, req.params.id],
  });
  res.json({ id: Number(req.params.id), week_key: existing.week_key, day_index: existing.day_index, code: newCode, driver_id: newDriverId });
});

app.delete('/api/routes/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM routes WHERE id = ?', args: [req.params.id] });
  res.status(204).send();
});

app.get('/api/warehouse-shifts', async (req, res) => {
  const { week_key } = req.query;
  if (!week_key) {
    return res.status(400).json({ error: 'week_key is verplicht (bijv. ?week_key=2026-09-15)' });
  }
  const result = await db.execute({
    sql: 'SELECT id, day_index, driver_id, start_time, end_time FROM warehouse_shifts WHERE week_key = ?',
    args: [week_key],
  });
  res.json(result.rows);
});

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Dienst aanmaken of de tijden van een bestaande dienst aanpassen
app.post('/api/warehouse-shifts', async (req, res) => {
  const { week_key, day_index, driver_id, start_time, end_time } = req.body;
  if (!week_key || day_index === undefined || !driver_id) {
    return res.status(400).json({ error: 'week_key, day_index en driver_id zijn verplicht' });
  }
  if (!TIME_PATTERN.test(start_time) || !TIME_PATTERN.test(end_time) || start_time >= end_time) {
    return res.status(400).json({ error: 'geldige start_time en end_time (HH:MM, start vóór eind) zijn verplicht' });
  }
  await db.execute({
    sql: `INSERT INTO warehouse_shifts (week_key, day_index, driver_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (week_key, day_index, driver_id) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time`,
    args: [week_key, day_index, driver_id, start_time, end_time],
  });
  res.status(201).json({ week_key, day_index, driver_id, start_time, end_time });
});

// Standaardrooster invullen voor iedereen in het magazijnteam die die week nog geen diensten heeft.
// Met only_if_new gebeurt dat alleen de eerste keer dat de week wordt geopend.
app.post('/api/warehouse-shifts/apply-template', async (req, res) => {
  const { week_key, only_if_new } = req.body;
  if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
  // Zonder standaardroosters niets markeren, anders krijgt deze week later nooit meer het standaardrooster
  const templateCount = await db.execute('SELECT COUNT(*) AS n FROM warehouse_templates');
  if (Number(templateCount.rows[0].n) === 0) return res.json({ applied: false });
  const marked = await db.execute({ sql: 'INSERT OR IGNORE INTO warehouse_weeks (week_key) VALUES (?)', args: [week_key] });
  if (only_if_new && marked.rowsAffected === 0) return res.json({ applied: false });
  await db.execute({
    sql: `INSERT OR IGNORE INTO warehouse_shifts (week_key, day_index, driver_id, start_time, end_time)
          SELECT ?, t.day_index, t.driver_id, t.start_time, t.end_time
          FROM warehouse_templates t
          JOIN drivers d ON d.id = t.driver_id
          WHERE d.is_warehouse = 1
            AND t.driver_id NOT IN (SELECT driver_id FROM warehouse_shifts WHERE week_key = ?)`,
    args: [week_key, week_key],
  });
  res.json({ applied: true });
});

app.delete('/api/warehouse-shifts', async (req, res) => {
  const { week_key, day_index, driver_id } = req.body;
  if (!week_key || day_index === undefined || !driver_id) {
    return res.status(400).json({ error: 'week_key, day_index en driver_id zijn verplicht' });
  }
  await db.execute({
    sql: 'DELETE FROM warehouse_shifts WHERE week_key = ? AND day_index = ? AND driver_id = ?',
    args: [week_key, day_index, driver_id],
  });
  res.status(204).send();
});

// Vervangt de diensten van één persoon in een week door diens standaardrooster
app.post('/api/warehouse-shifts/apply-template/:driverId', async (req, res) => {
  const { week_key } = req.body;
  if (!week_key) return res.status(400).json({ error: 'week_key is verplicht' });
  const driverId = Number(req.params.driverId);
  await db.batch([
    { sql: 'DELETE FROM warehouse_shifts WHERE week_key = ? AND driver_id = ?', args: [week_key, driverId] },
    {
      sql: `INSERT INTO warehouse_shifts (week_key, day_index, driver_id, start_time, end_time)
            SELECT ?, day_index, driver_id, start_time, end_time FROM warehouse_templates WHERE driver_id = ?`,
      args: [week_key, driverId],
    },
  ], 'write');
  res.json({ applied: true });
});

app.get('/api/warehouse-templates', async (req, res) => {
  const result = await db.execute('SELECT driver_id, day_index, start_time, end_time FROM warehouse_templates ORDER BY driver_id, day_index');
  res.json(result.rows);
});

// Vervangt het hele standaardrooster van één persoon
app.put('/api/warehouse-templates/:driverId', async (req, res) => {
  const days = Array.isArray(req.body.days) ? req.body.days : null;
  if (!days) return res.status(400).json({ error: 'days is verplicht' });
  for (const d of days) {
    if (!(d.day_index >= 0 && d.day_index <= 4) || !TIME_PATTERN.test(d.start_time) || !TIME_PATTERN.test(d.end_time) || d.start_time >= d.end_time) {
      return res.status(400).json({ error: 'elke dag heeft een day_index (0-4) en geldige start_time en end_time nodig' });
    }
  }
  const driverId = Number(req.params.driverId);
  await db.batch([
    { sql: 'DELETE FROM warehouse_templates WHERE driver_id = ?', args: [driverId] },
    ...days.map(d => ({
      sql: 'INSERT INTO warehouse_templates (driver_id, day_index, start_time, end_time) VALUES (?, ?, ?, ?)',
      args: [driverId, d.day_index, d.start_time, d.end_time],
    })),
  ], 'write');
  res.json(days.map(d => ({ driver_id: driverId, day_index: d.day_index, start_time: d.start_time, end_time: d.end_time })));
});

// Express 5 stuurt fouten uit async handlers hierheen; geef JSON terug i.p.v. een HTML-foutpagina
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'serverfout' });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server draait op http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Kon database niet initialiseren:', err);
    process.exit(1);
  });