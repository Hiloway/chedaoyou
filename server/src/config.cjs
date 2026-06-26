/**
 * config.cjs - 集中管理后端配置
 * 数据库、JWT、端口等全部从这里读取，移除硬编码密码默认值
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// 简易 .env / .env.local 加载器（避免引入 dotenv 依赖）
// 支持的文件（按优先级）：.env.local > .env，均位于项目根目录
(function loadEnv() {
  const root = path.resolve(__dirname, '..', '..');
  const files = ['.env.local', '.env'];
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // 去掉首尾成对引号
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
    break; // 只加载第一个找到的
  }
})();

// 启动时校验关键配置，避免运行时才报错
const required = ['DB_PASSWORD', 'JWT_SECRET'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[config] 警告：以下环境变量未设置：${missing.join(', ')}。请在 .env.local 或环境变量中配置。`);
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'road_conditions',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// 连接池单例
const pool = mysql.createPool(dbConfig);

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-change';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const PORT = process.env.PORT || 4000;

// AI 服务配置（后端代理使用，不暴露到前端）
const AI_CONFIG = {
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  qwen: {
    apiKey: process.env.QWEN_API_KEY || '',
    baseURL: process.env.QWEN_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-vl-plus',
  },
};

module.exports = { pool, dbConfig, JWT_SECRET, JWT_EXPIRES, PORT, AI_CONFIG };
