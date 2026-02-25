import mysql from 'mysql2/promise';

export const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '170152cym',
  database: process.env.DB_NAME || 'road_conditions',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export const testConnection = async () => {
  try {
    const connection = await db.getConnection();
    console.log('✅ MySQL连接成功');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL连接失败:', error.message);
    console.log('请检查以下信息：');
    console.log('1. MySQL服务是否启动');
    console.log('2. 用户名密码是否正确');
    console.log('3. 数据库是否存在');
    return false;
  }
};

export default db;