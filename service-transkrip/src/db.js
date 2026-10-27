const mysql = require('mysql2/promise');

// Service Transkrip juga memverifikasi izin terhadap data yang dibacanya.
module.exports = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zero_trust_nilai',
  waitForConnections: true,
  connectionLimit: 10
});
