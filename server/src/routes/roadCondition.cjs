/**
 * roadCondition.cjs - 路况路由
 * 路径含单复数两种前缀，故内部使用完整路径，由 index.cjs 直接 app.use(router) 挂载
 */
const express = require('express');
const { pool } = require('../config');
const {
  normalizeText, normalizeCondition, normalizeWorkflowStatus, normalizeWorkflowAction,
  normalizeAttachmentForDb, toMysqlDateTimeOrNull, toMysqlDateOrNow,
} = require('../utils');
const { resolveTransition, deriveStatusFromCondition } = require('../workflow');

const router = express.Router();

// POST /api/road-condition - 插入或更新路况信息（含工作流流转）
router.post('/api/road-condition', async (req, res) => {
  let conn;
  try {
    const payload = req.body || {};
    if (!payload || !payload.road_id) return res.status(400).json({ message: 'road_id required' });

    const inputCondition = normalizeCondition(payload.condition);
    if (payload.condition !== undefined && payload.condition !== null && payload.condition !== '' && !inputCondition) {
      return res.status(400).json({ message: 'invalid condition' });
    }

    const workflowAction = normalizeWorkflowAction(payload.workflow_action);
    if (payload.workflow_action && !workflowAction) {
      return res.status(400).json({ message: 'invalid workflow_action' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [currentRows] = await conn.query('SELECT * FROM road_conditions WHERE road_id = ? FOR UPDATE', [payload.road_id]);
    const current = currentRows && currentRows[0] ? currentRows[0] : null;
    const currentStatus = normalizeWorkflowStatus(current?.workflow_status);

    const transition = resolveTransition({ currentStatus, action: workflowAction, condition: inputCondition });
    if (!transition.ok) {
      await conn.rollback();
      return res.status(409).json({
        message: transition.message || 'workflow transition rejected',
        code: transition.code || 'INVALID_TRANSITION',
        current_status: currentStatus,
      });
    }

    const finalCondition = transition.condition !== undefined ? transition.condition : inputCondition;
    const nextStatus = normalizeWorkflowStatus(transition.nextStatus) || currentStatus || deriveStatusFromCondition(finalCondition, currentStatus);
    const statusChanged = (currentStatus || null) !== (nextStatus || null);

    const merged = {
      road_id: payload.road_id,
      condition: finalCondition !== null && finalCondition !== undefined ? finalCondition : (current?.condition || null),
      workflow_status: nextStatus || null,
      workflow_updated_at: statusChanged ? toMysqlDateTimeOrNull(new Date()) : (current?.workflow_updated_at || null),
      description: payload.description !== undefined ? payload.description : (current?.description || null),
      damage_type: payload.damage_type !== undefined ? payload.damage_type : (current?.damage_type || null),
      severity: payload.severity !== undefined ? payload.severity : (current?.severity || null),
      reporter_id: payload.reporter_id !== undefined ? payload.reporter_id : (current?.reporter_id || null),
      reporter_name: payload.reporter_name !== undefined ? payload.reporter_name : (current?.reporter_name || null),
      road_name: payload.road_name !== undefined ? payload.road_name : (current?.road_name || null),
      notes: payload.notes !== undefined ? payload.notes : (current?.notes || null),
      attachment_urls: normalizeAttachmentForDb(payload.attachment_urls, current?.attachment_urls),
      is_verified: payload.is_verified !== undefined ? (payload.is_verified ? 1 : 0) : (current?.is_verified ? 1 : 0),
      verified_by: payload.verified_by !== undefined ? payload.verified_by : (current?.verified_by || null),
      verified_at: payload.verified_at !== undefined ? toMysqlDateTimeOrNull(payload.verified_at) : (current?.verified_at || null),
      last_updated: toMysqlDateOrNow(payload.last_updated),
    };

    if (!current) {
      const insertSql = `INSERT INTO road_conditions (road_id, \`condition\`, workflow_status, workflow_updated_at, description, damage_type, severity, reporter_id, reporter_name, road_name, notes, attachment_urls, is_verified, verified_by, verified_at, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      await conn.query(insertSql, [
        merged.road_id, merged.condition, merged.workflow_status, merged.workflow_updated_at,
        merged.description, merged.damage_type, merged.severity, merged.reporter_id, merged.reporter_name,
        merged.road_name, merged.notes, merged.attachment_urls, merged.is_verified, merged.verified_by,
        merged.verified_at, merged.last_updated,
      ]);
    } else {
      const updateSql = `UPDATE road_conditions SET \`condition\` = ?, workflow_status = ?, workflow_updated_at = ?, description = ?, damage_type = ?, severity = ?, reporter_id = ?, reporter_name = ?, road_name = ?, notes = ?, attachment_urls = ?, is_verified = ?, verified_by = ?, verified_at = ?, last_updated = ? WHERE road_id = ?`;
      await conn.query(updateSql, [
        merged.condition, merged.workflow_status, merged.workflow_updated_at, merged.description,
        merged.damage_type, merged.severity, merged.reporter_id, merged.reporter_name, merged.road_name,
        merged.notes, merged.attachment_urls, merged.is_verified, merged.verified_by, merged.verified_at,
        merged.last_updated, merged.road_id,
      ]);
    }

    if (workflowAction || statusChanged) {
      const actionName = workflowAction || 'auto_sync';
      const actorRole = normalizeText(payload.actor_role, 32);
      const actorName = normalizeText(payload.actor_name, 128) || normalizeText(payload.reporter_name, 128) || normalizeText(payload.verified_by, 128);
      const note = normalizeText(payload.workflow_note, 1024) || normalizeText(payload.description, 1024);
      await conn.query(
        'INSERT INTO road_condition_transitions (road_id, from_status, to_status, action, actor_role, actor_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [payload.road_id, currentStatus || null, nextStatus || null, actionName, actorRole, actorName, note]
      );
    }

    await conn.commit();

    const [rows] = await pool.query('SELECT * FROM road_conditions WHERE road_id = ?', [payload.road_id]);
    const record = rows && rows[0] ? rows[0] : null;
    return res.json({
      ok: true,
      record,
      workflow: { action: workflowAction, previous_status: currentStatus, current_status: record?.workflow_status || nextStatus || null },
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { /* ignore */ }
    }
    console.error('POST /api/road-condition error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error', code: err.code || null });
  } finally {
    if (conn) conn.release();
  }
});

// GET /api/road-condition/:roadId - 读取单条路况记录
router.get('/api/road-condition/:roadId', async (req, res) => {
  try {
    const roadId = req.params.roadId;
    const [rows] = await pool.query('SELECT * FROM road_conditions WHERE road_id = ?', [roadId]);
    if (!rows || rows.length === 0) return res.status(404).json({ message: 'not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/road-condition/:roadId error:', err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/road-condition/:roadId/transitions - 状态流转历史
router.get('/api/road-condition/:roadId/transitions', async (req, res) => {
  try {
    const roadId = req.params.roadId;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    if (!roadId) return res.status(400).json({ message: 'roadId required' });
    const [rows] = await pool.query(
      'SELECT * FROM road_condition_transitions WHERE road_id = ? ORDER BY created_at DESC LIMIT ?',
      [roadId, limit]
    );
    return res.json(rows || []);
  } catch (err) {
    console.error('GET /api/road-condition/:roadId/transitions error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/road-conditions?ids=id1,id2,... - 批量读取（GET）
router.get('/api/road-conditions', async (req, res) => {
  try {
    const idsParam = req.query.ids;
    if (!idsParam) return res.status(400).json({ message: 'ids query param is required' });
    const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json([]);
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT * FROM road_conditions WHERE road_id IN (${placeholders})`, ids);
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/road-conditions error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/road-conditions/batch - 批量读取（POST，避免 URL 过长）
router.post('/api/road-conditions/batch', async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.json([]);
    const validIds = ids.map(s => String(s).trim()).filter(Boolean);
    if (validIds.length === 0) return res.json([]);
    const placeholders = validIds.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT * FROM road_conditions WHERE road_id IN (${placeholders})`, validIds);
    return res.json(rows);
  } catch (err) {
    console.error('POST /api/road-conditions/batch error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

module.exports = router;
