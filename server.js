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
  try {
    const result = await db.execute({
      sql: 'INSERT INTO drivers (name) VALUES (?)',
      args: [name],
    });
    res.status(201).json({ id: Number(result.lastInsertRowid), name });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'naam bestaat al' });
    }
    throw err;
  }
});

app.delete('/api/drivers/:id', async (req, res) => {
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