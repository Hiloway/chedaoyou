const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

console.log('Starting API server...');
const app = express();
app.use(cors());
// 简单请求日志（调试网络/路由问题）
app.use((req, res, next) => {
  try {
    console.log('[REQ]', req.method, req.url);
  } catch (e) { /* ignore */ }
  next();
});
// 增加 body size 限制以支持基于 dataURL 的图片上报（注意：生产环境应使用文件上传/对象存储）
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '170152cym',
  database: process.env.DB_NAME || 'road_conditions',
  waitForConnections: true,
  connectionLimit: 10,
});

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-change';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// 确保表存在（启动时自动建表，便于开发测试）
const createTableSql = '\nCREATE TABLE IF NOT EXISTS `road_conditions` (\n  road_id VARCHAR(191) NOT NULL,\n  `condition` VARCHAR(32) DEFAULT NULL,\n  description TEXT DEFAULT NULL,\n  damage_type VARCHAR(128) DEFAULT NULL,\n  severity VARCHAR(64) DEFAULT NULL,\n  reporter_id VARCHAR(128) DEFAULT NULL,\n  reporter_name VARCHAR(128) DEFAULT NULL,\n  road_name VARCHAR(255) DEFAULT NULL,\n  notes TEXT DEFAULT NULL,\n  attachment_urls JSON DEFAULT NULL,\n  is_verified TINYINT(1) DEFAULT 0,\n  verified_by VARCHAR(128) DEFAULT NULL,\n  verified_at DATETIME DEFAULT NULL,\n  last_updated DATE DEFAULT NULL,\n  PRIMARY KEY (road_id)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n';

pool.query(createTableSql).then(() => console.log('Ensured road_conditions table exists')).catch(err => console.error('Create table failed:', err));

// 确保 repair_reports 表存在
const createReportTable = '\nCREATE TABLE IF NOT EXISTS `repair_reports` (\n  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,\n  `road_id` VARCHAR(191) NOT NULL,\n  `title` VARCHAR(512) DEFAULT NULL,\n  `start_stake` VARCHAR(64) DEFAULT NULL,\n  `end_stake` VARCHAR(64) DEFAULT NULL,\n  `background` TEXT DEFAULT NULL,\n  `detection` TEXT DEFAULT NULL,\n  `core_plan` TEXT DEFAULT NULL,\n  `materials` TEXT DEFAULT NULL,\n  `budget` TEXT DEFAULT NULL,\n  `schedule` TEXT DEFAULT NULL,\n  `conclusion` TEXT DEFAULT NULL,\n  `organization` VARCHAR(255) DEFAULT NULL,\n  `report_date` DATE DEFAULT NULL,\n  `contact` VARCHAR(255) DEFAULT NULL,\n  `attachment_urls` JSON DEFAULT NULL,\n  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\n';

pool.query(createReportTable).then(() => console.log('Ensured repair_reports table exists')).catch(err => console.error('Create repair_reports table failed:', err));

// 确保 messages 表存在（用户上报与消息盒子使用）
const createMessagesTable = `
CREATE TABLE IF NOT EXISTS \`messages\` (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  road_id VARCHAR(191) DEFAULT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'user',
  name VARCHAR(255) DEFAULT NULL,
  contact VARCHAR(255) DEFAULT NULL,
  text TEXT DEFAULT NULL,
  photo_urls JSON DEFAULT NULL,
  lat DOUBLE DEFAULT NULL,
  lng DOUBLE DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

pool.query(createMessagesTable).then(async () => {
  console.log('Ensured messages table exists');
  // 尝试创建加速查询的索引，若已存在则捕获错误并忽略
  try {
    await pool.query('ALTER TABLE messages ADD INDEX idx_is_read_created_at (is_read, created_at)');
    console.log('Created index idx_is_read_created_at');
  } catch (err) { /* 如果索引已存在或发生错误，忽略以防止启动失败 */ }
  try {
    await pool.query('ALTER TABLE messages ADD INDEX idx_created_at (created_at)');
    console.log('Created index idx_created_at');
  } catch (err) { /* ignore */ }
  try {
    await pool.query('ALTER TABLE messages ADD INDEX idx_road_id (road_id)');
    console.log('Created index idx_road_id');
  } catch (err) { /* ignore */ }
  // 添加 assigned_to 字段用于指派维修任务
  try {
    await pool.query('ALTER TABLE messages ADD COLUMN assigned_to VARCHAR(128) DEFAULT NULL');
    console.log('Added assigned_to column to messages');
  } catch (err) { /* ignore if already exists */ }
  try {
    await pool.query('ALTER TABLE messages ADD INDEX idx_assigned_to (assigned_to)');
    console.log('Created index idx_assigned_to');
  } catch (err) { /* ignore */ }

  // 创建用户与账号表（accounts + profiles），便于支持数据管理员 / 维修方 / 用户 角色
  try {
    const createAccounts = `
      CREATE TABLE IF NOT EXISTS \`accounts\` (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(128) NOT NULL UNIQUE,
        password_hash VARCHAR(255) DEFAULT NULL,
        role ENUM('admin','maintainer','user') NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createAccounts);
    console.log('Ensured accounts table exists');
    // 增加密码重置字段（如果尚未存在）
    try {
      await pool.query('ALTER TABLE accounts ADD COLUMN reset_token VARCHAR(255) DEFAULT NULL');
    } catch (err) { /* ignore */ }
    try {
      await pool.query('ALTER TABLE accounts ADD COLUMN reset_expires DATETIME DEFAULT NULL');
    } catch (err) { /* ignore */ }
  } catch (err) {
    console.error('Create accounts table failed:', err && err.stack ? err.stack : err);
  }

  try {
    const createMaintainers = `
      CREATE TABLE IF NOT EXISTS \`maintainers\` (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id BIGINT NOT NULL,
        organization VARCHAR(255) DEFAULT NULL,
        contact_person VARCHAR(255) DEFAULT NULL,
        phone VARCHAR(64) DEFAULT NULL,
        license_no VARCHAR(128) DEFAULT NULL,
        service_area TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createMaintainers);
    console.log('Ensured maintainers table exists');
  } catch (err) {
    console.error('Create maintainers table failed:', err && err.stack ? err.stack : err);
  }

  // 管理员 profile 表：用于存放管理员的扩展信息（如真实姓名、联系方式、机构等）
  try {
    const createAdmins = `
      CREATE TABLE IF NOT EXISTS \`admins\` (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id BIGINT NOT NULL,
        full_name VARCHAR(255) DEFAULT NULL,
        contact_phone VARCHAR(64) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        organization VARCHAR(255) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createAdmins);
    console.log('Ensured admins table exists');
  } catch (err) {
    console.error('Create admins table failed:', err && err.stack ? err.stack : err);
  }

  try {
    const createUsers = `
      CREATE TABLE IF NOT EXISTS \`users\` (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        account_id BIGINT NOT NULL,
        full_name VARCHAR(255) DEFAULT NULL,
        contact_phone VARCHAR(64) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        metadata JSON DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createUsers);
    console.log('Ensured users table exists');
  } catch (err) {
    console.error('Create users table failed:', err && err.stack ? err.stack : err);
  }

}).catch(err => console.error('Create messages table failed:', err));

// POST /api/road-condition  - 插入或更新路况信息
app.post('/api/road-condition', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.road_id) return res.status(400).json({ message: 'road_id required' });

    const sql = '\n      INSERT INTO `road_conditions`\n      (`road_id`, `condition`, `description`, `damage_type`, `severity`, `reporter_id`, `reporter_name`, `road_name`, `notes`, `attachment_urls`, `is_verified`, `verified_by`, `verified_at`, `last_updated`)\n      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n      ON DUPLICATE KEY UPDATE\n        `condition` = COALESCE(VALUES(`condition`), `condition`),\n        `description` = COALESCE(VALUES(`description`), `description`),\n        `damage_type` = COALESCE(VALUES(`damage_type`), `damage_type`),\n        `severity` = COALESCE(VALUES(`severity`), `severity`),\n        `reporter_id` = COALESCE(VALUES(`reporter_id`), `reporter_id`),\n        `reporter_name` = COALESCE(VALUES(`reporter_name`), `reporter_name`),\n        `road_name` = COALESCE(VALUES(`road_name`), `road_name`),\n        `notes` = COALESCE(VALUES(`notes`), `notes`),\n        `attachment_urls` = COALESCE(VALUES(`attachment_urls`), `attachment_urls`),\n        `is_verified` = COALESCE(VALUES(`is_verified`), `is_verified`),\n        `verified_by` = COALESCE(VALUES(`verified_by`), `verified_by`),\n        `verified_at` = COALESCE(VALUES(`verified_at`), `verified_at`);\n    ';

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
      payload.last_updated ? new Date(payload.last_updated) : new Date(),
    ];

    console.log('POST payload:', payload);
    const [result] = await pool.query(sql, params);
    // 返回保存后的完整记录，便于前端直接使用
    const [rows] = await pool.query('SELECT * FROM road_conditions WHERE road_id = ?', [payload.road_id]);
    const record = rows && rows[0] ? rows[0] : null;
    console.log('Saved record:', record);
    return res.json({ ok: true, result, record });
  } catch (err) {
    console.error('POST /api/road-condition error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error', code: err.code || null });
  }
});

// GET /api/road-condition/:roadId - 读取单条路况记录
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

// GET /api/road-conditions?ids=id1,id2,...  - 批量读取多条路况记录，用于前端合并持久化数据
app.get('/api/road-conditions', async (req, res) => {
  try {
    const idsParam = req.query.ids;
    if (!idsParam) return res.status(400).json({ message: 'ids query param is required' });
    const ids = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json([]);
    // 使用占位符构建 IN 查询
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(`SELECT * FROM road_conditions WHERE road_id IN (${placeholders})`, ids);
    return res.json(rows);
  } catch (err) {
    console.error('GET /api/road-conditions error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/road-conditions/batch - 批量读取多条路况记录（避免 GET URL 过长）
app.post('/api/road-conditions/batch', async (req, res) => {
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

// POST /api/repair-report - 提交道路维修报告
app.post('/api/repair-report', async (req, res) => {
  try {
    const p = req.body;
    if (!p || !p.road_id) return res.status(400).json({ message: 'road_id required' });
    const sql = `INSERT INTO repair_reports (road_id, title, start_stake, end_stake, background, detection, core_plan, materials, budget, schedule, conclusion, organization, report_date, contact, attachment_urls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      p.road_id,
      p.title || null,
      p.start_stake || null,
      p.end_stake || null,
      p.background || null,
      p.detection || null,
      p.core_plan || null,
      p.materials || null,
      p.budget || null,
      p.schedule || null,
      p.conclusion || null,
      p.organization || null,
      p.date || null,
      p.contact || null,
      JSON.stringify(p.attachment_urls || []),
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
app.get('/api/repair-reports', async (req, res) => {
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

// POST /api/message - 用户或维修方发送消息/上报（含图片、位置等）
app.post('/api/message', async (req, res) => {
  try {
    const p = req.body;
    console.log('POST /api/message payload:', p);
    if (!p || (!p.text && !(p.photo_urls && p.photo_urls.length))) return res.status(400).json({ message: 'text or photo_urls required' });
    // 简单防护：限制 photo_urls 的总 payload 大小，避免写入超大数据到 DB
    const photoStr = JSON.stringify(p.photo_urls || []);
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
    if (photoStr.length > MAX_PHOTO_BYTES) return res.status(413).json({ message: 'photo payload too large' });

    const sql = `INSERT INTO messages (road_id, type, name, contact, text, photo_urls, lat, lng, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      p.road_id || null,
      p.type || 'user',
      p.name || null,
      p.contact || null,
      p.text || null,
      photoStr,
      p.lat || null,
      p.lng || null,
      p.assigned_to || null,
    ];
    const [result] = await pool.query(sql, params);
    console.log('Inserted message id:', result.insertId);
    const [rows] = await pool.query('SELECT * FROM messages WHERE id = ?', [result.insertId]);
    console.log('Inserted message record:', rows && rows[0] ? rows[0] : null);
    return res.json({ ok: true, id: result.insertId, record: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error('POST /api/message error:', err && err.stack ? err.stack : err);
    if (err && err.code === 'ER_DATA_TOO_LONG') return res.status(413).json({ message: 'data too long' });
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/messages - 管理端获取消息列表，支持按 road_id 与 unread 过滤。返回同时包含 road_name（如果有）。
// 说明：为避免对大量数据排序导致 MySQL 报错（Out of sort memory），添加了分页参数与 count 查询支持。
app.get('/api/messages', async (req, res) => {
  try {
    const roadId = req.query.road_id;
    const idsParam = req.query.ids;
    const unread = req.query.unread === '1' || req.query.unread === 'true';
    // 新增：支持按上报人过滤（reporter_id/ name）
    const reporterId = req.query.reporter_id;
    const reporterName = req.query.name;
    // 分页与计数支持
    const countOnly = req.query.count === '1' || req.query.count === 'true';
    const limit = Math.min(Number(req.query.limit) || 500, 2000); // 最大限制 2000
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

    // 如果请求只需要计数，返回 COUNT，避免排序开销
    if (countOnly) {
      const [countRows] = await pool.query(`SELECT COUNT(*) as cnt FROM messages m ${where}`, params);
      const cnt = Array.isArray(countRows) && countRows[0] ? countRows[0].cnt : 0;
      // 移除频繁的 console.log 避免刷屏
      // console.log('GET /api/messages count query:', req.query, 'count:', cnt);
      return res.json({ count: cnt });
    }

    // 使用 LEFT JOIN 从 road_conditions 拉取 road_name（若存在），并使用 LIMIT 避免大排序
    const sql = `SELECT m.*, rc.road_name as road_name FROM messages m LEFT JOIN road_conditions rc ON rc.road_id = m.road_id ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`;
    const finalParams = params.concat([limit, offset]);
    // 首次尝试使用 ORDER BY（性能较好，当可用索引时）
    console.log('Executing messages SQL:', sql, 'params:', finalParams);
    try {
      const [rows] = await pool.query(sql, finalParams);
      console.log('GET /api/messages query:', req.query, 'returned:', rows.length, 'limit:', limit, 'offset:', offset);
      return res.json(rows);
    } catch (err) {
      console.error('GET /api/messages primary query failed:', err && err.stack ? err.stack : err);
      const msg = (err && err.message) ? String(err.message) : '';
      // 如果是排序内存不足的错误，尝试不排序的退路查询以保证返回结果
      if (msg.toLowerCase().includes('out of sort') || msg.toLowerCase().includes('sort memory')) {
        try {
          const fallbackSql = `SELECT m.*, rc.road_name as road_name FROM messages m LEFT JOIN road_conditions rc ON rc.road_id = m.road_id ${where} LIMIT ? OFFSET ?`;
          console.log('Fallback messages SQL (no ORDER BY):', fallbackSql, 'params:', finalParams);
          const [rows2] = await pool.query(fallbackSql, finalParams);
          console.log('GET /api/messages fallback returned:', rows2.length);
          return res.json(rows2);
        } catch (err2) {
          console.error('GET /api/messages fallback also failed:', err2 && err2.stack ? err2.stack : err2);
          return res.status(500).json({ message: err2.message || 'server error' });
        }
      }
      return res.status(500).json({ message: err.message || 'server error' });
    }
  } catch (err) {
    console.error('GET /api/messages error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/messages/batch - 批量读取多条消息记录（避免 GET URL 过长）
app.post('/api/messages/batch', async (req, res) => {
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
app.put('/api/message/:id/read', async (req, res) => {
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

// DELETE /api/message/:id - 删除单条消息（根据 id）
app.delete('/api/message/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'id required' });
    const [result] = await pool.query('DELETE FROM messages WHERE id = ?', [id]);
    // mysql2 returns result as an object with affectedRows
    const affected = (result && result.affectedRows) ? result.affectedRows : 0;
    console.log('DELETE /api/message/:id deleted', id, 'affected:', affected);
    return res.json({ ok: true, affected });
  } catch (err) {
    console.error('DELETE /api/message/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// DELETE /api/messages - 批量删除消息，目前支持按 read=1 删除已读消息
app.delete('/api/messages', async (req, res) => {
  try {
    const readOnly = req.query.read === '1' || req.query.read === 'true';
    if (readOnly) {
      const [result] = await pool.query('DELETE FROM messages WHERE is_read = 1');
      const affected = (result && result.affectedRows) ? result.affectedRows : 0;
      console.log('DELETE /api/messages?read=1 affected:', affected);
      return res.json({ ok: true, affected });
    }
    return res.status(400).json({ message: 'no delete criteria provided' });
  } catch (err) {
    console.error('DELETE /api/messages error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/maintainers - 获取所有维修方列表（用于管理员指派维修任务）
app.get('/api/maintainers', async (req, res) => {
  try {
    const sql = `
      SELECT a.id, a.username, m.organization, m.contact_person, m.phone, m.service_area
      FROM accounts a
      LEFT JOIN maintainers m ON a.id = m.account_id
      WHERE a.role = 'maintainer'
      ORDER BY a.username
    `;
    const [rows] = await pool.query(sql);
    return res.json(rows || []);
  } catch (err) {
    console.error('GET /api/maintainers error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// POST /api/register - 注册新账号（含可选 profile）
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, role, profile } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    // 公共注册不允许创建 admin 账户（请使用 /api/admin/init 来初始化管理员）
    if (String(role) === 'admin') return res.status(403).json({ message: 'admin creation not allowed via register' });
    // 检查用户名是否已存在
    const [exists] = await pool.query('SELECT id FROM accounts WHERE username = ?', [String(username)]);
    if (Array.isArray(exists) && exists.length > 0) return res.status(409).json({ message: 'username exists' });
    const hash = await bcrypt.hash(String(password), 10);
    const [result] = await pool.query('INSERT INTO accounts (username, password_hash, role) VALUES (?, ?, ?)', [String(username), hash, String(role || 'user')]);
    const accountId = result && result.insertId ? result.insertId : null;
    // 根据角色创建 profile
    if (String(role) === 'maintainer') {
      const m = profile || {};
      await pool.query('INSERT INTO maintainers (account_id, organization, contact_person, phone, license_no, service_area) VALUES (?, ?, ?, ?, ?, ?)', [accountId, m.organization || null, m.contact_person || null, m.phone || null, m.license_no || null, m.service_area || null]);
    } else if (String(role) === 'user') {
      const u = profile || {};
      await pool.query('INSERT INTO users (account_id, full_name, contact_phone, email, address, metadata) VALUES (?, ?, ?, ?, ?, ?)', [accountId, u.full_name || null, u.contact_phone || null, u.email || null, u.address || null, JSON.stringify(u.metadata || {})]);
    } else if (String(role) === 'admin') {
      const a = profile || {};
      await pool.query('INSERT INTO admins (account_id, full_name, contact_phone, email, organization) VALUES (?, ?, ?, ?, ?)', [accountId, a.full_name || null, a.contact_phone || null, a.email || null, a.organization || null]);
    }
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [accountId]);
    return res.json({ ok: true, account: rows && rows[0] ? rows[0] : null });
  } catch (err) {
    console.error('POST /api/register error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/login - 简单登录（返回账户信息，不实现 session/token）
app.post('/api/login', async (req, res) => {
  // debug log to inspect incoming login attempts
  try {
    console.log('[POST /api/login] body:', req.body);
  } catch (e) { /* ignore logging errors */ }
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    const [rows] = await pool.query('SELECT * FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(401).json({ message: 'invalid username or password' });
    const ok = await bcrypt.compare(String(password), acc.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'invalid username or password' });
    // 返回不含密码哈希的账户信息
    const account = { id: acc.id, username: acc.username, role: acc.role, created_at: acc.created_at };
    // 加载 profile
    if (acc.role === 'maintainer') {
      const [mrows] = await pool.query('SELECT * FROM maintainers WHERE account_id = ?', [acc.id]);
      account.profile = mrows && mrows[0] ? mrows[0] : null;
    } else if (acc.role === 'user') {
      const [urows] = await pool.query('SELECT * FROM users WHERE account_id = ?', [acc.id]);
      let u = urows && urows[0] ? urows[0] : null;
      if (u && u.metadata) {
        try { u.metadata = JSON.parse(u.metadata); } catch(e) { /* keep as-is */ }
      }
      account.profile = u;
    } else if (acc.role === 'admin') {
      const [arows] = await pool.query('SELECT * FROM admins WHERE account_id = ?', [acc.id]);
      account.profile = arows && arows[0] ? arows[0] : null;
    }
    // 签发 JWT
    const token = jwt.sign({ id: acc.id, role: acc.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return res.json({ ok: true, account, token, expiresIn: JWT_EXPIRES });
  } catch (err) {
    console.error('POST /api/login error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/password-reset - 请求重置密码（返回 token，用于开发/测试环境）
app.post('/api/password-reset', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ message: 'username required' });
    const [rows] = await pool.query('SELECT id FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 小时
    await pool.query('UPDATE accounts SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, acc.id]);
    // 在真实系统应通过邮件发送 token；为便于开发，这里直接返回 token
    return res.json({ ok: true, token, expires });
  } catch (err) {
    console.error('POST /api/password-reset error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/password-reset/simple - 简单重置密码
app.post('/api/password-reset/simple', async (req, res) => {
  try {
    const { username, old_password, phone, new_password } = req.body || {};
    if (!username || !old_password || !phone || !new_password) return res.status(400).json({ message: 'username, old_password, phone and new_password required' });
    const [rows] = await pool.query('SELECT id, password_hash, role FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    const ok = await bcrypt.compare(String(old_password), acc.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'invalid username or password' });
    // load profile phone according to role
    let profilePhone = null;
    if (acc.role === 'maintainer') {
      const [mrows] = await pool.query('SELECT phone FROM maintainers WHERE account_id = ?', [acc.id]);
      profilePhone = mrows && mrows[0] ? mrows[0].phone : null;
    } else if (acc.role === 'user') {
      const [urows] = await pool.query('SELECT contact_phone FROM users WHERE account_id = ?', [acc.id]);
      profilePhone = urows && urows[0] ? urows[0].contact_phone : null;
    } else if (acc.role === 'admin') {
      const [arows] = await pool.query('SELECT contact_phone FROM admins WHERE account_id = ?', [acc.id]);
      profilePhone = arows && arows[0] ? arows[0].contact_phone : null;
    }
    // Normalize numbers and compare
    const normalize = s => s ? String(s).replace(/\D/g, '') : '';
    if (normalize(profilePhone) !== normalize(phone)) return res.status(400).json({ message: 'phone mismatch' });
    const hash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, acc.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/password-reset/simple error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/admin/init - 初始化管理员账号
app.post('/api/admin/init', async (req, res) => {
  try {
    const { username, password, profile } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    // 检查是否已有 admin
    const [cntRows] = await pool.query("SELECT COUNT(*) as cnt FROM accounts WHERE role = 'admin'");
    const cnt = cntRows && cntRows[0] ? cntRows[0].cnt : 0;
    if (cnt > 0) return res.status(403).json({ message: 'admin already exists' });
    const hash = await bcrypt.hash(String(password), 10);
    const [result] = await pool.query('INSERT INTO accounts (username, password_hash, role) VALUES (?, ?, ?)', [String(username), hash, 'admin']);
    const accountId = result && result.insertId ? result.insertId : null;
    const a = profile || {};
    await pool.query('INSERT INTO admins (account_id, full_name, contact_phone, email, organization) VALUES (?, ?, ?, ?, ?)', [accountId, a.full_name || null, a.contact_phone || null, a.email || null, a.organization || null]);
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [accountId]);
    const acc = rows && rows[0] ? rows[0] : null;
    const token = jwt.sign({ id: acc.id, role: acc.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return res.json({ ok: true, account: acc, token, expiresIn: JWT_EXPIRES });
  } catch (err) {
    console.error('POST /api/admin/init error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/password-reset/confirm - 使用 token 设置新密码
app.post('/api/password-reset/confirm', async (req, res) => {
  try {
    const { username, token, new_password } = req.body || {};
    if (!username || !token || !new_password) return res.status(400).json({ message: 'username, token and new_password required' });
    const [rows] = await pool.query('SELECT id, reset_expires FROM accounts WHERE username = ? AND reset_token = ?', [String(username), String(token)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(400).json({ message: 'invalid token' });
    if (!acc.reset_expires || new Date(acc.reset_expires) < new Date()) return res.status(400).json({ message: 'token expired' });
    const hash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE accounts SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?', [hash, acc.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/password-reset/confirm error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// 验证 JWT 的中间件
function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ message: 'token required' });
  const parts = String(auth).split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ message: 'invalid auth header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'invalid token' });
  }
}

// GET /api/account/:id - 查看账号与 profile
app.get('/api/account/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'id required' });
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [id]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    if (acc.role === 'maintainer') {
      const [m] = await pool.query('SELECT * FROM maintainers WHERE account_id = ?', [id]);
      acc.profile = m && m[0] ? m[0] : null;
    } else if (acc.role === 'user') {
      const [u] = await pool.query('SELECT * FROM users WHERE account_id = ?', [id]);
      const uu = u && u[0] ? u[0] : null;
      if (uu && uu.metadata) {
        try { uu.metadata = JSON.parse(uu.metadata); } catch (e) { /* ignore */ }
      }
      acc.profile = uu;
    } else if (acc.role === 'admin') {
      const [a] = await pool.query('SELECT * FROM admins WHERE account_id = ?', [id]);
      acc.profile = a && a[0] ? a[0] : null;
    }
    return res.json(acc);
  } catch (err) {
    console.error('GET /api/account/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/me - 返回当前 token 对应的账户信息
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const uid = Number(req.user && req.user.id);
    if (!uid) return res.status(401).json({ message: 'invalid token' });
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [uid]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    if (acc.role === 'maintainer') {
      const [m] = await pool.query('SELECT * FROM maintainers WHERE account_id = ?', [uid]);
      acc.profile = m && m[0] ? m[0] : null;
    } else if (acc.role === 'user') {
      const [u] = await pool.query('SELECT * FROM users WHERE account_id = ?', [uid]);
      const uu = u && u[0] ? u[0] : null;
      if (uu && uu.metadata) {
        try { uu.metadata = JSON.parse(uu.metadata); } catch (e) { /* ignore */ }
      }
      acc.profile = uu;
    } else if (acc.role === 'admin') {
      const [a] = await pool.query('SELECT * FROM admins WHERE account_id = ?', [uid]);
      acc.profile = a && a[0] ? a[0] : null;
    }
    return res.json({ ok: true, account: acc });
  } catch (err) {
    console.error('GET /api/me error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// PUT /api/account/:id - 更新账号基本信息与 profile（不支持改 role）
app.put('/api/account/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (!id) return res.status(400).json({ message: 'id required' });
    if (body.username) {
      // 检查是否冲突
      const [ex] = await pool.query('SELECT id FROM accounts WHERE username = ? AND id != ?', [String(body.username), id]);
      if (Array.isArray(ex) && ex.length > 0) return res.status(409).json({ message: 'username exists' });
      await pool.query('UPDATE accounts SET username = ? WHERE id = ?', [String(body.username), id]);
    }
    // 根据角色更新 profile
    const [accRows] = await pool.query('SELECT role FROM accounts WHERE id = ?', [id]);
    const acc = accRows && accRows[0] ? accRows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    if (acc.role === 'maintainer') {
      const m = body.profile || {};
      const [exists] = await pool.query('SELECT id FROM maintainers WHERE account_id = ?', [id]);
      if (Array.isArray(exists) && exists.length > 0) {
        await pool.query('UPDATE maintainers SET organization = ?, contact_person = ?, phone = ?, license_no = ?, service_area = ? WHERE account_id = ?', [m.organization || null, m.contact_person || null, m.phone || null, m.license_no || null, m.service_area || null, id]);
      } else {
        await pool.query('INSERT INTO maintainers (account_id, organization, contact_person, phone, license_no, service_area) VALUES (?, ?, ?, ?, ?, ?)', [id, m.organization || null, m.contact_person || null, m.phone || null, m.license_no || null, m.service_area || null]);
      }
    } else if (acc.role === 'user') {
      const u = body.profile || {};
      const [exists] = await pool.query('SELECT id FROM users WHERE account_id = ?', [id]);
      if (Array.isArray(exists) && exists.length > 0) {
        await pool.query('UPDATE users SET full_name = ?, contact_phone = ?, email = ?, address = ?, metadata = ? WHERE account_id = ?', [u.full_name || null, u.contact_phone || null, u.email || null, u.address || null, JSON.stringify(u.metadata || {}), id]);
      } else {
        await pool.query('INSERT INTO users (account_id, full_name, contact_phone, email, address, metadata) VALUES (?, ?, ?, ?, ?, ?)', [id, u.full_name || null, u.contact_phone || null, u.email || null, u.address || null, JSON.stringify(u.metadata || {})]);
      }
    } else if (acc.role === 'admin') {
      const a = body.profile || {};
      const [exists] = await pool.query('SELECT id FROM admins WHERE account_id = ?', [id]);
      if (Array.isArray(exists) && exists.length > 0) {
        await pool.query('UPDATE admins SET full_name = ?, contact_phone = ?, email = ?, organization = ? WHERE account_id = ?', [a.full_name || null, a.contact_phone || null, a.email || null, a.organization || null, id]);
      } else {
        await pool.query('INSERT INTO admins (account_id, full_name, contact_phone, email, organization) VALUES (?, ?, ?, ?, ?)', [id, a.full_name || null, a.contact_phone || null, a.email || null, a.organization || null]);
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/account/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/account/:id/password - 修改密码（需要提供 old_password）
app.post('/api/account/:id/password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { old_password, new_password } = req.body || {};
    if (!id || !old_password || !new_password) return res.status(400).json({ message: 'id, old_password and new_password required' });
    const [rows] = await pool.query('SELECT password_hash FROM accounts WHERE id = ?', [id]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    const ok = await bcrypt.compare(String(old_password), acc.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'old password incorrect' });
    const hash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/account/:id/password error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

const port = process.env.PORT || 4000;

// 全局错误处理器（记录未被捕获的 express 错误）
app.use((err, req, res, next) => {
  try {
    console.error('UNCAUGHT ERROR in express:', err && err.stack ? err.stack : err);
  } catch (e) { console.error('Error logging failure', e); }
  // 仍然返回 500
  try { res.status(500).json({ message: 'server error' }); } catch (e) { /* ignore */ }
});

app.listen(port, () => console.log(`API server started on http://localhost:${port}`));