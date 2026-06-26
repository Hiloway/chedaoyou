/**
 * message.cjs - 用户上报消息路由
 */
const express = require('express');
const { pool } = require('../config');

const router = express.Router();

// POST /api/message - 用户或维修方发送消息/上报（含图片、位置）
router.post('/api/message', async (req, res) => {
  try {
    const p = req.body;
    if (!p || (!p.text && !(p.photo_urls && p.photo_urls.length))) {
      return res.status(400).json({ message: 'text or photo_urls required' });
    }
    const photoStr = JSON.stringify(p.photo_urls || []);
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
    if (photoStr.length > MAX_PHOTO_BYTES) return res.status(413).json({ message: 'photo payload too large' });

    const sql = `INSERT INTO messages (road_id, type, name, contact, text, photo_urls, lat, lng, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      p.road_id || null, p.type || 'user', p.name || null, p.contact || null,
      p.text || null, photoStr, p.lat || null, p.lng || null, p.assigned_to || null,
    ];
    const [result] = await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM messages WHERE id = ?', [result.insertId]);
    return res.json({ ok: true, id: result.insertId, record: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error('POST /api/message error:', err && err.stack ? err.stack : err);
    if (err && err.code === 'ER_DATA_TOO_LONG') return res.status(413).json({ message: 'data too long' });
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/messages - 管理端获取消息列表，支持 road_id / ids / unread / reporter_id / name 过滤，含分页与计数
router.get('/api/messages', async (req, res) => {
  try {
    const roadId = req.query.road_id;
    const idsParam = req.query.ids;
    const unread = req.query.unread === '1' || req.query.unread === 'true';
    const reporterId = req.query.reporter_id;
    const reporterName = req.query.name;
    const countOnly = req.query.count === '1' || req.query.count === 'true';
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const offset = Number(req.query.offset) || 0;

    const conditions = [];
    const params = [];
    if (roadId) { conditions.push('m.road_id = ?'); params.push(String(roadId)); }
    if (idsParam) {
      const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        conditions.push(`m.road_id IN (${placeholders})`);
        params.push(...ids);
      }
    }
    if (unread) { conditions.push('m.is_read = 0'); }
    if (reporterId) { conditions.push('(m.contact = ? OR m.name = ?)'); params.push(String(reporterId), String(reporterId)); }
    if (reporterName) { conditions.push('(m.name = ? OR m.contact = ?)'); params.push(String(reporterName), String(reporterName)); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    if (countOnly) {
      const [countRows] = await pool.query(`SELECT COUNT(*) as cnt FROM messages m ${where}`, params);
      const cnt = Array.isArray(countRows) && countRows[0] ? countRows[0].cnt : 0;
      return res.json({ count: cnt });
    }

    const sql = `SELECT m.*, rc.road_name as road_name FROM messages m LEFT JOIN road_conditions rc ON rc.road_id = m.road_id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    const finalParams = params.concat([limit, offset]);
    try {
      const [rows] = await pool.query(sql, finalParams);
      return res.json(rows);
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : '';
      // 排序内存不足时退路：不排序
      if (msg.toLowerCase().includes('out of sort') || msg.toLowerCase().includes('sort memory')) {
        try {
          const fallbackSql = `SELECT m.*, rc.road_name as road_name FROM messages m LEFT JOIN road_conditions rc ON rc.road_id = m.road_id ${where} LIMIT ? OFFSET ?`;
          const [rows2] = await pool.query(fallbackSql, finalParams);
          return res.json(rows2);
        } catch (err2) {
          console.error('GET /api/messages fallback failed:', err2 && err2.stack ? err2.stack : err2);
          return res.status(500).json({ message: err2.message || 'server error' });
        }
      }
      console.error('GET /api/messages query failed:', err && err.stack ? err.stack : err);
      return res.status(500).json({ message: err.message || 'server error' });
    }
  } catch (err) {
    console.error('GET /api/messages error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/messages/batch - 批量读取消息（按 road_id）
router.post('/api/messages/batch', async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.json([]);
    const validIds = ids.map(s => String(s).trim()).filter(Boolean);
    if (validIds.length === 0) return res.json([]);
    const placeholders = validIds.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT * FROM messages WHERE road_id IN (${placeholders})`, validIds);
    return res.json(rows);
  } catch (err) {
    console.error('POST /api/messages/batch error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// PUT /api/message/:id/read - 标记消息为已读
router.put('/api/message/:id/read', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'id required' });
    await pool.query('UPDATE messages SET is_read = 1 WHERE id = ?', [id]);
    const [rows] = await pool.query('SELECT * FROM messages WHERE id = ?', [id]);
    return res.json({ ok: true, record: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error('PUT /api/message/:id/read error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// DELETE /api/message/:id - 删除单条消息
router.delete('/api/message/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'id required' });
    const [result] = await pool.query('DELETE FROM messages WHERE id = ?', [id]);
    const affected = (result && result.affectedRows) ? result.affectedRows : 0;
    return res.json({ ok: true, affected });
  } catch (err) {
    console.error('DELETE /api/message/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// DELETE /api/messages?read=1 - 批量删除已读消息
router.delete('/api/messages', async (req, res) => {
  try {
    const readOnly = req.query.read === '1' || req.query.read === 'true';
    if (readOnly) {
      const [result] = await pool.query('DELETE FROM messages WHERE is_read = 1');
      const affected = (result && result.affectedRows) ? result.affectedRows : 0;
      return res.json({ ok: true, affected });
    }
    return res.status(400).json({ message: 'no delete criteria provided' });
  } catch (err) {
    console.error('DELETE /api/messages error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

module.exports = router;
