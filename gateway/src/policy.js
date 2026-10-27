const db = require('./db');

function withinAccessWindow() {
  const now = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.TIME_ZONE || 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  const start = process.env.ACCESS_WINDOW_START || '07:00';
  const end = process.env.ACCESS_WINDOW_END || '21:00';
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

// PE memeriksa role dan atribut pemilik dari database sebelum gateway meneruskan permintaan.
async function evaluate({ method, path, principal }) {
  const userId = Number(principal.sub);
  const role = principal.role;

  if (role === 'service') {
    return method === 'POST' && path === '/transkrip/sinkron' && principal.clientId === (process.env.SERVICE_CLIENT_ID || 'service-nilai')
      ? { allow: true, reason: 'Token service valid untuk sinkronisasi transkrip' }
      : { allow: false, reason: 'Token service hanya boleh sinkronisasi transkrip' };
  }

  if (method === 'GET' && path === '/nilai' && ['mahasiswa', 'dosen'].includes(role)) {
    return { allow: true, reason: `Role ${role} boleh melihat nilai; service akan membatasi baris sesuai kepemilikan` };
  }

  const gradeMatch = path.match(/^\/nilai\/(\d+)$/);
  if (method === 'PUT' && gradeMatch && role === 'dosen') {
    if (!withinAccessWindow()) return { allow: false, reason: 'Perubahan nilai di luar jam akses' };
    const [[grade]] = await db.execute(
      'SELECT g.final, c.dosen_id FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?', [gradeMatch[1]]
    );
    if (!grade) return { allow: false, reason: 'Nilai tidak ditemukan' };
    if (Number(grade.dosen_id) !== userId) return { allow: false, reason: 'Dosen bukan pengampu kelas nilai ini' };
    if (Boolean(grade.final)) return { allow: false, reason: 'Nilai sudah difinalisasi' };
    return { allow: true, reason: 'Dosen pengampu, nilai belum final, dan jam akses valid' };
  }

  const finalMatch = path.match(/^\/kelas\/(\d+)\/finalisasi$/);
  if (method === 'POST' && finalMatch && role === 'dosen') {
    if (!withinAccessWindow()) return { allow: false, reason: 'Finalisasi di luar jam akses' };
    const [[kelas]] = await db.execute('SELECT dosen_id FROM classes WHERE id = ?', [finalMatch[1]]);
    if (!kelas) return { allow: false, reason: 'Kelas tidak ditemukan' };
    if (Number(kelas.dosen_id) !== userId) return { allow: false, reason: 'Dosen bukan pengampu kelas ini' };
    return { allow: true, reason: 'Dosen pengampu dan jam akses valid' };
  }

  const transcriptMatch = path.match(/^\/transkrip\/([^/]+)$/);
  if (method === 'GET' && transcriptMatch && (role === 'mahasiswa' || role === 'admin')) {
    if (role === 'admin') return { allow: true, reason: 'Admin boleh melihat semua transkrip' };
    const [[user]] = await db.execute('SELECT nim_nip FROM users WHERE id = ?', [userId]);
    if (user && user.nim_nip === decodeURIComponent(transcriptMatch[1])) {
      return { allow: true, reason: 'Mahasiswa hanya meminta transkrip miliknya' };
    }
    return { allow: false, reason: 'Mahasiswa hanya boleh melihat transkrip sendiri' };
  }

  return { allow: false, reason: 'Role tidak diizinkan untuk endpoint ini' };
}

module.exports = { evaluate, withinAccessWindow };
