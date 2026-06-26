/**
 * account.cjs - 账号相关路由
 * 包含：注册/登录/me、账号资料查看与更新、改密、密码重置、管理员初始化、维修方列表
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, JWT_SECRET, JWT_EXPIRES } = require('../config');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/register - 注册新账号（公共注册不允许创建 admin）
router.post('/api/register', async (req, res) => {
  try {
    const { username, password, role, profile } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    if (String(role) === 'admin') return res.status(403).json({ message: 'admin creation not allowed via register' });

    const [exists] = await pool.query('SELECT id FROM accounts WHERE username = ?', [String(username)]);
    if (Array.isArray(exists) && exists.length > 0) return res.status(409).json({ message: 'username exists' });

    const hash = await bcrypt.hash(String(password), 10);
    const [result] = await pool.query('INSERT INTO accounts (username, password_hash, role) VALUES (?, ?, ?)', [String(username), hash, String(role || 'user')]);
    const accountId = result && result.insertId ? result.insertId : null;

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

// POST /api/login - 登录，签发 JWT
router.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
    const [rows] = await pool.query('SELECT * FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(401).json({ message: 'invalid username or password' });
    const ok = await bcrypt.compare(String(password), acc.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'invalid username or password' });

    const account = { id: acc.id, username: acc.username, role: acc.role, created_at: acc.created_at };
    account.profile = await loadProfile(pool, acc.id, acc.role);

    const token = jwt.sign({ id: acc.id, role: acc.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    return res.json({ ok: true, account, token, expiresIn: JWT_EXPIRES });
  } catch (err) {
    console.error('POST /api/login error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/me - 当前 token 对应账户
router.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const uid = Number(req.user && req.user.id);
    if (!uid) return res.status(401).json({ message: 'invalid token' });
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [uid]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    acc.profile = await loadProfile(pool, uid, acc.role);
    return res.json({ ok: true, account: acc });
  } catch (err) {
    console.error('GET /api/me error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// GET /api/account/:id - 查看账号与 profile
router.get('/api/account/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'id required' });
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [id]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    acc.profile = await loadProfile(pool, id, acc.role);
    return res.json(acc);
  } catch (err) {
    console.error('GET /api/account/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// PUT /api/account/:id - 更新账号基本信息与 profile（不支持改 role）
router.put('/api/account/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (!id) return res.status(400).json({ message: 'id required' });

    if (body.username) {
      const [ex] = await pool.query('SELECT id FROM accounts WHERE username = ? AND id != ?', [String(body.username), id]);
      if (Array.isArray(ex) && ex.length > 0) return res.status(409).json({ message: 'username exists' });
      await pool.query('UPDATE accounts SET username = ? WHERE id = ?', [String(body.username), id]);
    }

    const [accRows] = await pool.query('SELECT role FROM accounts WHERE id = ?', [id]);
    const acc = accRows && accRows[0] ? accRows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });

    const profile = body.profile || {};
    if (acc.role === 'maintainer') {
      await upsertProfile(pool, 'maintainers', 'account_id', id, {
        organization: profile.organization, contact_person: profile.contact_person,
        phone: profile.phone, license_no: profile.license_no, service_area: profile.service_area,
      });
    } else if (acc.role === 'user') {
      await upsertProfile(pool, 'users', 'account_id', id, {
        full_name: profile.full_name, contact_phone: profile.contact_phone,
        email: profile.email, address: profile.address, metadata: JSON.stringify(profile.metadata || {}),
      });
    } else if (acc.role === 'admin') {
      await upsertProfile(pool, 'admins', 'account_id', id, {
        full_name: profile.full_name, contact_phone: profile.contact_phone,
        email: profile.email, organization: profile.organization,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/account/:id error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/account/:id/password - 修改密码（需提供 old_password）
router.post('/api/account/:id/password', async (req, res) => {
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

// POST /api/password-reset - 请求重置密码（返回 token，开发/测试用）
router.post('/api/password-reset', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ message: 'username required' });
    const [rows] = await pool.query('SELECT id FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 小时
    await pool.query('UPDATE accounts SET reset_token = ?, reset_expires = ? WHERE id = ?', [token, expires, acc.id]);
    return res.json({ ok: true, token, expires });
  } catch (err) {
    console.error('POST /api/password-reset error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/password-reset/simple - 简单重置密码（旧密码 + 手机号验证）
router.post('/api/password-reset/simple', async (req, res) => {
  try {
    const { username, old_password, phone, new_password } = req.body || {};
    if (!username || !old_password || !phone || !new_password) return res.status(400).json({ message: 'username, old_password, phone and new_password required' });
    const [rows] = await pool.query('SELECT id, password_hash, role FROM accounts WHERE username = ?', [String(username)]);
    const acc = rows && rows[0] ? rows[0] : null;
    if (!acc) return res.status(404).json({ message: 'not found' });
    const ok = await bcrypt.compare(String(old_password), acc.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'invalid username or password' });

    const profilePhone = await loadProfilePhone(pool, acc.id, acc.role);
    const normalizePhone = s => s ? String(s).replace(/\D/g, '') : '';
    if (normalizePhone(profilePhone) !== normalizePhone(phone)) return res.status(400).json({ message: 'phone mismatch' });

    const hash = await bcrypt.hash(String(new_password), 10);
    await pool.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, acc.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/password-reset/simple error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'server error' });
  }
});

// POST /api/password-reset/confirm - 使用 token 设置新密码
router.post('/api/password-reset/confirm', async (req, res) => {
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

// POST /api/admin/init - 初始化管理员账号（仅允许首次）
router.post('/api/admin/init', async (req, res) => {
  try {
    const { username, password, profile } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'username and password required' });
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

// GET /api/maintainers - 维修方列表（管理员指派用）
router.get('/api/maintainers', async (req, res) => {
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

// ---------- 辅助函数 ----------

// 按 role 加载 profile（解析 user.metadata JSON）
async function loadProfile(pool, accountId, role) {
  if (role === 'maintainer') {
    const [r] = await pool.query('SELECT * FROM maintainers WHERE account_id = ?', [accountId]);
    return r && r[0] ? r[0] : null;
  }
  if (role === 'user') {
    const [r] = await pool.query('SELECT * FROM users WHERE account_id = ?', [accountId]);
    const u = r && r[0] ? r[0] : null;
    if (u && u.metadata) { try { u.metadata = JSON.parse(u.metadata); } catch (e) { /* keep */ } }
    return u;
  }
  if (role === 'admin') {
    const [r] = await pool.query('SELECT * FROM admins WHERE account_id = ?', [accountId]);
    return r && r[0] ? r[0] : null;
  }
  return null;
}

// 通用 upsert：存在则更新，否则插入
async function upsertProfile(pool, table, keyField, id, fields) {
  const [exists] = await pool.query(`SELECT id FROM ${table} WHERE ${keyField} = ?`, [id]);
  const cols = Object.keys(fields);
  const vals = cols.map(c => fields[c] === undefined ? null : fields[c]);
  if (Array.isArray(exists) && exists.length > 0) {
    const setClause = cols.map(c => `\`${c}\` = ?`).join(', ');
    await pool.query(`UPDATE ${table} SET ${setClause} WHERE ${keyField} = ?`, [...vals, id]);
  } else {
    const placeholders = cols.map(() => '?').join(', ');
    await pool.query(`INSERT INTO ${table} (${keyField}, ${cols.map(c => `\`${c}\``).join(', ')}) VALUES (?, ${placeholders})`, [id, ...vals]);
  }
}

// 按 role 读取 profile 中的联系电话
async function loadProfilePhone(pool, accountId, role) {
  let table = null, col = null;
  if (role === 'maintainer') { table = 'maintainers'; col = 'phone'; }
  else if (role === 'user') { table = 'users'; col = 'contact_phone'; }
  else if (role === 'admin') { table = 'admins'; col = 'contact_phone'; }
  if (!table) return null;
  const [r] = await pool.query(`SELECT ${col} AS phone FROM ${table} WHERE account_id = ?`, [accountId]);
  return r && r[0] ? r[0].phone : null;
}

module.exports = router;
