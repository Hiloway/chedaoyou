const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '170152cym',
  database: process.env.DB_NAME || 'road_conditions',
  waitForConnections: true,
  connectionLimit: 10,
});

// POST /api/road-condition  - 插入或更新路况信息
app.post('/api/road-condition', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.road_id) return res.status(400).json({ message: 'road_id required' });

    const sql = `
      INSERT INTO road_conditions
      (road_id, condition, description, damage_type, severity, reporter_id, reporter_name, road_name, notes, attachment_urls, is_verified, verified_by, verified_at, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        condition = VALUES(condition),
        description = VALUES(description),
        damage_type = VALUES(damage_type),
        severity = VALUES(severity),
        reporter_id = VALUES(reporter_id),
        reporter_name = VALUES(reporter_name),
        road_name = VALUES(road_name),
        notes = VALUES(notes),
        attachment_urls = VALUES(attachment_urls),
        is_verified = VALUES(is_verified),
        verified_by = VALUES(verified_by),
        verified_at = VALUES(verified_at),
        last_updated = VALUES(last_updated);
    `;

    const params = [
      payload.road_id,
      payload.condition || null,
      payload.description || null,
      payload.damage_type || null,
      payload.severity || null,
      payload.reporter_id || null,
      payload.reporter_name || null,
      payload.road_name || null,
      payload.notes || null,
      JSON.stringify(payload.attachment_urls || []),
      payload.is_verified ? 1 : 0,
      payload.verified_by || null,
      payload.verified_at ? new Date(payload.verified_at).toISOString().slice(0, 19).replace('T', ' ') : null,
      new Date().toISOString().slice(0,10),
    ];

    const [result] = await pool.query(sql, params);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/road-condition/:roadId - 读取路况记录
app.get('/api/road-condition/:roadId', async (req, res) => {
  try {
    const roadId = req.params.roadId;
    const [rows] = await pool.query('SELECT * FROM road_conditions WHERE road_id = ?', [roadId]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API server started on http://localhost:${port}`));
