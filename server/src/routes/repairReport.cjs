/**
 * repairReport.cjs - 维修报告路由
 */
const express = require('express');
const { pool } = require('../config');

const router = express.Router();

// POST /api/repair-report - 提交道路维修报告
router.post('/api/repair-report', async (req, res) => {
  try {
    const p = req.body;
    if (!p || !p.road_id) return res.status(400).json({ message: 'road_id required' });
    const sql = `INSERT INTO repair_reports (road_id, title, start_stake, end_stake, background, detection, core_plan, materials, budget, schedule, conclusion, organization, report_date, contact, attachment_urls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      p.road_id, p.title || null, p.start_stake || null, p.end_stake || null,
      p.background || null, p.detection || null, p.core_plan || null, p.materials || null,
      p.budget || null, p.schedule || null, p.conclusion || null, p.organization || null,
      p.date || null, p.contact || null, JSON.stringify(p.attachment_urls || []),
    ];
    const [result] = await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM repair_reports WHERE id = ?', [result.insertId]);
    return res.json({ ok: true, id: result.insertId, record: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error('POST /api/repair-report error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/repair-reports?road_id=... - 按路段读取维修报告列表
router.get('/api/repair-reports', async (req, res) => {
  try {
    const roadId = req.query.road_id;
    if (!roadId) return res.status(400).json({ message: 'road_id required' });
    const [rows] = await pool.query('SELECT * FROM repair_reports WHERE road_id = ? ORDER BY created_at DESC', [String(roadId)]);
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/repair-reports error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

module.exports = router;
