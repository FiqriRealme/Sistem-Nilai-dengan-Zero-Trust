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

app.get('/health', (_req, res) => res.json({ service: 'service-nilai', status: 'ok' }));

// Service resource memverifikasi secret gateway dan tanda tangan JWT secara mandiri.
app.use((req, res, next) => {
  if (!secretsMatch(req.get('X-Gateway-Secret'), process.env.GATEWAY_SECRET || 'dev-gateway-secret-change-me')) {
    return res.status(403).json({ error: 'Gateway secret tidak valid' });
  }
  const match = (req.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Bearer token wajib disertakan' });
  try {
    req.principal = jwt.verify(match[1], process.env.JWT_SECRET || 'dev-only-change-this-secret-32-chars');
    if (!['mahasiswa', 'dosen'].includes(req.principal.role)) {
      return res.status(403).json({ error: 'Role tidak boleh mengakses Service Nilai' });
    }
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
});

// Mahasiswa hanya menerima baris nilainya; dosen hanya menerima kelas yang diampu.
app.get('/nilai', async (req, res) => {
  try {
    const query = req.principal.role === 'mahasiswa'
      ? [
          `SELECT g.id, c.id AS classId, c.kode AS kodeKelas, c.nama AS namaKelas,
                  g.nilai, g.final, g.updated_at AS updatedAt
           FROM grades g JOIN classes c ON c.id = g.class_id
           WHERE g.mahasiswa_id = ? ORDER BY c.kode`,
          [req.principal.sub]
        ]
      : [
          `SELECT g.id, c.id AS classId, c.kode AS kodeKelas, c.nama AS namaKelas,
                  u.nim_nip AS nim, u.nama AS namaMahasiswa, g.nilai, g.final, g.updated_at AS updatedAt
           FROM grades g JOIN classes c ON c.id = g.class_id
           JOIN users u ON u.id = g.mahasiswa_id WHERE c.dosen_id = ? ORDER BY c.kode, u.nim_nip`,
          [req.principal.sub]
        ];
    const [rows] = await db.execute(query[0], query[1]);
    return res.json({ data: rows });
  } catch (error) {
    console.error('Gagal membaca nilai:', error.message);
    return res.status(500).json({ error: 'Nilai tidak dapat dibaca' });
  }
});

// Resource mengulang cek dosen pengampu dan status final meskipun gateway sudah mengecek policy.
app.put('/nilai/:id', async (req, res) => {
  const nilai = Number(req.body?.nilai);
  if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
    return res.status(400).json({ error: 'Nilai harus berupa angka 0 sampai 100' });
  }
  try {
    const [result] = await db.execute(
      `UPDATE grades g JOIN classes c ON c.id = g.class_id
       SET g.nilai = ? WHERE g.id = ? AND c.dosen_id = ? AND g.final = FALSE`,
      [nilai, req.params.id, req.principal.sub]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Nilai tidak ditemukan, bukan kelas ampuan, atau sudah final' });
    return res.json({ message: 'Nilai berhasil diperbarui', id: Number(req.params.id), nilai });
  } catch (error) {
    console.error('Gagal memperbarui nilai:', error.message);
    return res.status(500).json({ error: 'Nilai tidak dapat diperbarui' });
  }
});

// Nilai dikunci lebih dulu; sinkronisasi dikirim ke transkrip lewat token service dari gateway.
app.post('/kelas/:id/finalisasi', async (req, res) => {
  const connection = await db.getConnection();
  let finalized = false;
  try {
    await connection.beginTransaction();
    const [[kelas]] = await connection.execute('SELECT id, kode, dosen_id FROM classes WHERE id = ?', [req.params.id]);
    if (!kelas || Number(kelas.dosen_id) !== Number(req.principal.sub)) {
      await connection.rollback();
      return res.status(404).json({ error: 'Kelas tidak ditemukan atau bukan kelas ampuan Anda' });
    }
    const [[counts]] = await connection.execute(
      'SELECT COUNT(*) AS total, SUM(nilai IS NULL) AS kosong FROM grades WHERE class_id = ?', [kelas.id]
    );
    if (!Number(counts.total) || Number(counts.kosong || 0)) {
      await connection.rollback();
      return res.status(409).json({ error: 'Isi nilai semua mahasiswa sebelum finalisasi' });
    }
    await connection.execute('UPDATE grades SET final = TRUE WHERE class_id = ?', [kelas.id]);
    await connection.commit();
    finalized = true;

    const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT || 3000}`;
    const tokenResponse = await fetch(`${gateway}/auth/service`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: process.env.SERVICE_CLIENT_ID || 'service-nilai',
        clientSecret: process.env.SERVICE_CLIENT_SECRET || 'dev-service-secret-change-me'
      })
    });
    if (!tokenResponse.ok) throw new Error('Gateway menolak kredensial Service Nilai');
    const { accessToken } = await tokenResponse.json();
    const syncResponse = await fetch(`${gateway}/transkrip/sinkron`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: kelas.id })
    });
    if (!syncResponse.ok) throw new Error('Service Transkrip menolak sinkronisasi');

    return res.json({ message: 'Nilai difinalisasi dan transkrip disinkronkan', classId: kelas.id, kode: kelas.kode });
  } catch (error) {
    if (finalized) {
      // Buka kembali nilai bila sinkron gagal agar dosen dapat mencoba finalisasi lagi.
      await db.execute('UPDATE grades SET final = FALSE WHERE class_id = ?', [req.params.id]).catch(() => {});
    } else {
      await connection.rollback().catch(() => {});
    }
    console.error('Finalisasi gagal:', error.message);
    return res.status(502).json({ error: 'Finalisasi atau sinkronisasi transkrip gagal; silakan coba lagi' });
  } finally {
    connection.release();
  }
});

app.all('*path', (_req, res) => res.status(404).json({ error: 'Endpoint nilai tidak ditemukan' }));

const port = Number(process.env.SERVICE_NILAI_PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`Service Nilai berjalan pada port ${port}`));
