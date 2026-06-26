/**
 * index.cjs - Express 入口
 * 仅负责 app 装配、中间件挂载、路由注册与服务启动
 * 所有业务逻辑已拆分到 server/src/ 下
 * .env 加载由 src/config.cjs 内置加载器完成，无需 dotenv 依赖
 */
const express = require('express');
const cors = require('cors');
const { PORT, pool } = require('./src/config');
const { ensureSchema } = require('./src/schema');

const app = express();

// ---------- 中间件 ----------
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- 路由（按模块拆分） ----------
app.use(require('./src/routes/roadCondition'));
app.use(require('./src/routes/repairReport'));
app.use(require('./src/routes/message'));
app.use(require('./src/routes/account'));
app.use(require('./src/routes/ai'));

// ---------- 健康检查 ----------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---------- 404 兜底 ----------
app.use((req, res) => res.status(404).json({ message: 'not found' }));

// ---------- 启动 ----------
async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`[server] 车道优后端已启动: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[server] 启动失败:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

// 数据库连接测试
pool.getConnection()
  .then(conn => { console.log('✅ MySQL 连接成功'); conn.release(); })
  .catch(err => {
    console.error('❌ MySQL 连接失败:', err.message);
    console.log('请检查：1. MySQL 服务是否启动  2. .env.local 中 DB_* 配置是否正确  3. 数据库是否存在');
  });

start();

module.exports = app;
