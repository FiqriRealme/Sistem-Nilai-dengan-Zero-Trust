require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./db');
const app = express();
app.disable('x-powered-by');
app.use(express.json());

function secretsMatch(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(String(received));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.get('/health', (_req, res) => res.json({ service: 'service-transkrip', status: 'ok' }));

// Service Transkrip menolak akses langsung dan memverifikasi JWT yang diteruskan gateway.
app.use(async (req, res, next) => {
  if (!secretsMatch(req.get('X-Gateway-Secret'), process.env.GATEWAY_SECRET || 'dev-gateway-secret-change-me')) {
    return res.status(403).json({ error: 'Gateway secret tidak valid' });
  }
  const match = (req.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Bearer token wajib disertakan' });
  try {
    req.principal = jwt.verify(match[1], process.env.JWT_SECRET || 'dev-only-change-this-secret-32-chars');
    const isSync = req.method === 'POST' && req.path === '/transkrip/sinkron';
    if (isSync) {
      if (req.principal.role !== 'service' || req.principal.sub !== 'service-nilai') {
        return res.status(403).json({ error: 'Sinkronisasi hanya boleh dilakukan Service Nilai' });
      }
    } else if (req.principal.role !== 'mahasiswa' && req.principal.role !== 'admin') {
      return res.status(403).json({ error: 'Role tidak boleh mengakses Service Transkrip' });
    } else if (req.method === 'GET' && req.path.startsWith('/transkrip/')) {
      if (req.principal.role === 'mahasiswa') {
        const [[user]] = await db.execute('SELECT nim_nip FROM users WHERE id = ?', [req.principal.sub]);
        if (!user || user.nim_nip !== decodeURIComponent(req.path.slice('/transkrip/'.length))) {
          return res.status(403).json({ error: 'Mahasiswa hanya boleh melihat transkrip sendiri' });
        }
      }
    }
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
});

// Sinkron hanya menerima nilai final; upsert membuat pengulangan permintaan aman.
app.post('/transkrip/sinkron', async (req, res) => {
  const classId = Number(req.body?.classId);
  if (!Number.isInteger(classId) || classId <= 0) return res.status(400).json({ error: 'classId tidak valid' });
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[count]] = await connection.execute(
      'SELECT COUNT(*) AS total, SUM(final = FALSE OR nilai IS NULL) AS belumSiap FROM grades WHERE class_id = ?', [classId]
    );
    if (!Number(count.total) || Number(count.belumSiap || 0)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Kelas belum memiliki seluruh nilai final' });
    }
    const [result] = await connection.execute(
      `INSERT INTO transcripts (class_id, mahasiswa_id, nilai)
       SELECT class_id, mahasiswa_id, nilai FROM grades WHERE class_id = ? AND final = TRUE
       ON DUPLICATE KEY UPDATE nilai = VALUES(nilai), finalized_at = CURRENT_TIMESTAMP`,
      [classId]
    );
    await connection.commit();
    return res.json({ message: 'Transkrip berhasil disinkronkan', classId, affectedRows: result.affectedRows });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('Sinkronisasi transkrip gagal:', error.message);
    return res.status(500).json({ error: 'Transkrip tidak dapat disinkronkan' });
  } finally {
    if (connection) connection.release();
  }
});

// Admin boleh membaca semua; gateway dan service membatasi mahasiswa ke NIM sendiri.
app.get('/transkrip/:nim', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.nim_nip AS nim, u.nama AS namaMahasiswa, c.kode AS kodeKelas,
              c.nama AS namaKelas, t.nilai, t.finalized_at AS finalizedAt
       FROM transcripts t JOIN users u ON u.id = t.mahasiswa_id
       JOIN classes c ON c.id = t.class_id WHERE u.nim_nip = ? ORDER BY c.kode`,
      [decodeURIComponent(req.params.nim)]
    );
    return res.json({ nim: req.params.nim, data: rows });
  } catch (error) {
    console.error('Gagal membaca transkrip:', error.message);
    return res.status(500).json({ error: 'Transkrip tidak dapat dibaca' });
  }
});

app.all('*path', (_req, res) => res.status(404).json({ error: 'Endpoint transkrip tidak ditemukan' }));

const port = Number(process.env.SERVICE_TRANSKRIP_PORT || 3002);
app.listen(port, '127.0.0.1', () => console.log(`Service Transkrip berjalan pada port ${port}`));
