require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const crypto = require('node:crypto');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const db = require('./db');
const policy = require('./policy');
const { writeAudit } = require('./audit');
const { JWT_SECRET, createAccessToken, createServiceToken, createRefreshToken, hashToken } = require('./tokens');
const jwt = require('jsonwebtoken');

const app = express();
app.disable('x-powered-by');
// Hanya endpoint autentikasi yang perlu membaca JSON; body bisnis diteruskan utuh ke service.
app.use('/auth', express.json());

function secretsMatch(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(String(received));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function isRegisteredDevice(userId, deviceId) {
  if (!deviceId) return false;
  const [[device]] = await db.execute(
    'SELECT id FROM devices WHERE user_id = ? AND device_id = ? AND active = TRUE', [userId, deviceId]
  );
  return Boolean(device);
}

app.get('/health', (_req, res) => res.json({ service: 'gateway', status: 'ok' }));

// Login hanya menerbitkan token jika kredensial dan device terdaftar cocok.
app.post('/auth/login', async (req, res) => {
  const deviceId = req.get('X-Device-ID');
  const email = String(req.body?.email || '').trim().toLowerCase();
  try {
    const [[user]] = await db.execute('SELECT id, nim_nip, nama, email, password_hash, role FROM users WHERE email = ?', [email]);
    if (!user || !(await require('bcryptjs').compare(String(req.body?.password || ''), user.password_hash))) {
      await writeAudit({ subject: email || 'unknown', endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Kredensial tidak valid' });
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    if (!(await isRegisteredDevice(user.id, deviceId))) {
      await writeAudit({ subject: user.id, endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Device tidak terdaftar' });
      return res.status(403).json({ error: 'Device tidak terdaftar untuk akun ini' });
    }

    const refreshToken = createRefreshToken();
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))',
      [user.id, hashToken(refreshToken)]
    );
    await writeAudit({ subject: user.id, endpoint: req.originalUrl, deviceId, result: 'allow', reason: 'Login berhasil' });
    return res.json({
      accessToken: createAccessToken(user), refreshToken, tokenType: 'Bearer', expiresIn: 600,
      user: { id: user.id, nimNip: user.nim_nip, nama: user.nama, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Login gagal:', error.message);
    return res.status(503).json({ error: 'Layanan autentikasi tidak tersedia' });
  }
});

// Refresh token sekali pakai lalu diputar agar token lama tidak dapat digunakan ulang.
app.post('/auth/refresh', async (req, res) => {
  const token = String(req.body?.refreshToken || '');
  const deviceId = req.get('X-Device-ID');
  try {
    const [[session]] = await db.execute(
      `SELECT rt.id, rt.user_id, u.role FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > UTC_TIMESTAMP()`, [hashToken(token)]
    );
    if (!session || !(await isRegisteredDevice(session.user_id, deviceId))) {
      await writeAudit({ subject: session?.user_id || 'unknown', endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Refresh token atau device tidak valid' });
      return res.status(401).json({ error: 'Refresh token atau device tidak valid' });
    }
    const nextRefreshToken = createRefreshToken();
    await db.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND revoked_at IS NULL', [session.id]);
    await db.execute(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY))',
      [session.user_id, hashToken(nextRefreshToken)]
    );
    await writeAudit({ subject: session.user_id, endpoint: req.originalUrl, deviceId, result: 'allow', reason: 'Refresh token diputar' });
    return res.json({ accessToken: createAccessToken({ id: session.user_id, role: session.role }), refreshToken: nextRefreshToken, tokenType: 'Bearer', expiresIn: 600 });
  } catch (error) {
    console.error('Refresh gagal:', error.message);
    return res.status(503).json({ error: 'Layanan autentikasi tidak tersedia' });
  }
});

// Logout mencabut refresh token pada database, sehingga sesi tidak bisa diperpanjang lagi.
app.post('/auth/logout', async (req, res) => {
  const token = String(req.body?.refreshToken || '');
  const deviceId = req.get('X-Device-ID');
  try {
    const [[session]] = await db.execute(
      `SELECT rt.id, rt.user_id FROM refresh_tokens rt WHERE rt.token_hash = ?
       AND rt.revoked_at IS NULL AND rt.expires_at > UTC_TIMESTAMP()`, [hashToken(token)]
    );
    if (!session || !(await isRegisteredDevice(session.user_id, deviceId))) {
      await writeAudit({ subject: session?.user_id || 'unknown', endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Refresh token atau device tidak valid' });
      return res.status(401).json({ error: 'Refresh token atau device tidak valid' });
    }
    await db.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [session.id]);
    await writeAudit({ subject: session.user_id, endpoint: req.originalUrl, deviceId, result: 'allow', reason: 'Logout berhasil; refresh token dicabut' });
    return res.json({ message: 'Logout berhasil' });
  } catch (error) {
    console.error('Logout gagal:', error.message);
    return res.status(503).json({ error: 'Layanan autentikasi tidak tersedia' });
  }
});

// Kredensial client service hanya diberikan kepada Service Nilai untuk panggilan antar-service.
app.post('/auth/service', async (req, res) => {
  const validId = secretsMatch(req.body?.clientId, process.env.SERVICE_CLIENT_ID || 'service-nilai');
  const validSecret = secretsMatch(req.body?.clientSecret, process.env.SERVICE_CLIENT_SECRET || 'dev-service-secret-change-me');
  if (!validId || !validSecret) {
    await writeAudit({ subject: req.body?.clientId || 'unknown', endpoint: req.originalUrl, result: 'deny', reason: 'Kredensial service tidak valid' });
    return res.status(401).json({ error: 'Kredensial service tidak valid' });
  }
  await writeAudit({ subject: 'service-nilai', endpoint: req.originalUrl, result: 'allow', reason: 'Token service diterbitkan' });
  return res.json({ accessToken: createServiceToken(), tokenType: 'Bearer', expiresIn: 300 });
});

// Semua rute bisnis diverifikasi JWT, device, lalu keputusan PE sebelum diteruskan.
app.use(async (req, res, next) => {
  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    await writeAudit({ subject: 'unknown', endpoint: req.originalUrl, deviceId: req.get('X-Device-ID'), result: 'deny', reason: 'Bearer token tidak ada' });
    return res.status(401).json({ error: 'Bearer token wajib disertakan' });
  }

  let principal;
  try {
    principal = jwt.verify(match[1], JWT_SECRET);
  } catch (error) {
    await writeAudit({ subject: 'unknown', endpoint: req.originalUrl, deviceId: req.get('X-Device-ID'), result: 'deny', reason: 'JWT tidak valid atau kedaluwarsa' });
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }

  const deviceId = req.get('X-Device-ID');
  if (principal.role !== 'service') {
    try {
      const [[user]] = await db.execute('SELECT role FROM users WHERE id = ?', [principal.sub]);
      if (!user || user.role !== principal.role) {
        await writeAudit({ subject: principal.sub, endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Akun tidak ditemukan atau role berubah' });
        return res.status(403).json({ error: 'Akun tidak aktif atau role tidak valid' });
      }
      if (!(await isRegisteredDevice(principal.sub, deviceId))) {
        await writeAudit({ subject: principal.sub, endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Device tidak terdaftar' });
        return res.status(403).json({ error: 'Device tidak terdaftar untuk akun ini' });
      }
    } catch (error) {
      console.error('Verifikasi konteks gagal:', error.message);
      return res.status(503).json({ error: 'Layanan kebijakan tidak tersedia' });
    }
  }

  try {
    const decision = await policy.evaluate({ method: req.method, path: req.path, principal });
    await writeAudit({ subject: principal.sub, endpoint: req.originalUrl, deviceId, result: decision.allow ? 'allow' : 'deny', reason: decision.reason });
    if (!decision.allow) return res.status(403).json({ error: 'Akses ditolak', reason: decision.reason });
    req.principal = principal;
    return next();
  } catch (error) {
    console.error('Policy Engine gagal:', error.message);
    await writeAudit({ subject: principal.sub, endpoint: req.originalUrl, deviceId, result: 'deny', reason: 'Policy Engine gagal membaca data' });
    return res.status(503).json({ error: 'Policy Engine tidak tersedia' });
  }
});

app.use(createProxyMiddleware({
  pathFilter: (pathname) => pathname.startsWith('/nilai') || pathname.startsWith('/kelas') || pathname.startsWith('/transkrip'),
  router: (req) => req.path.startsWith('/transkrip')
    ? `http://127.0.0.1:${process.env.SERVICE_TRANSKRIP_PORT || 3002}`
    : `http://127.0.0.1:${process.env.SERVICE_NILAI_PORT || 3001}`,
  changeOrigin: true,
  // Atur header di opsi proxy agar selalu terpasang pada GET maupun request berbodi.
  headers: { 'X-Gateway-Secret': process.env.GATEWAY_SECRET || 'dev-gateway-secret-change-me' },
  on: {
    error: (_error, _req, res) => {
      if (!res.headersSent) res.status(502).json({ error: 'Service tujuan tidak tersedia' });
    }
  }
}));

app.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

const port = Number(process.env.GATEWAY_PORT || 3000);
app.listen(port, () => console.log(`Gateway berjalan pada port ${port}`));
