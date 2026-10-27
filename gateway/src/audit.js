const db = require('./db');

// Catat keputusan di gateway; kegagalan audit tidak membocorkan detail ke klien.
async function writeAudit({ subject, endpoint, deviceId, result, reason }) {
  try {
    await db.execute(
      'INSERT INTO audit_logs (subject, endpoint, device_id, result, reason) VALUES (?, ?, ?, ?, ?)',
      [String(subject || 'unknown').slice(0, 120), String(endpoint || '').slice(0, 255), deviceId || null, result, String(reason || '').slice(0, 255)]
    );
  } catch (error) {
    console.error('Gagal menulis audit log:', error.message);
  }
}

module.exports = { writeAudit };
