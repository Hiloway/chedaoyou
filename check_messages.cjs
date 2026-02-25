const mysql = require('mysql2/promise');

async function checkMessages() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '170152cym',
    database: process.env.DB_NAME || 'road_conditions',
  });

  try {
    const [rows] = await pool.query('SELECT * FROM messages ORDER BY id DESC LIMIT 5');
    console.log('Recent messages:', rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}

checkMessages();