const mysql = require('mysql2/promise');
(async () => {
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '170152cym',
      database: process.env.DB_NAME || 'road_conditions',
      waitForConnections: true,
      connectionLimit: 10,
    });
    const [rows] = await pool.query('SELECT * FROM road_conditions LIMIT 10');
    console.log('rows:', rows);
    process.exit(0);
  } catch (err) {
    console.error('db error:', err.message || err);
    process.exit(1);
  }
})();