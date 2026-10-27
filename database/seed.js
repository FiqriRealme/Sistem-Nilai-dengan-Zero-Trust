require('dotenv').config();

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

// Data akun ini khusus untuk demonstrasi lokal; semua akun memakai password demo yang sama.
const users = [
  { nim: 'ADM001', nama: 'Mr. Irony', email: 'admin@zero-trust.local', role: 'admin', device: 'DEV-ADMIN-001' },
  { nim: '198701012026011001', nama: 'Imut Rizman', email: 'dosen1@zero-trust.local', role: 'dosen', device: 'DEV-DOSEN-001' },
  { nim: '198802022026011002', nama: 'Mas Gatot Mendut-Mendut', email: 'dosen2@zero-trust.local', role: 'dosen', device: 'DEV-DOSEN-002' },
  { nim: '247006111051', nama: 'Fiqri Mochamad Fadilah', email: 'mahasiswa1@zero-trust.local', role: 'mahasiswa', device: 'DEV-MHS-001' },
  { nim: '247006111069', nama: 'King Nasir Rongawi', email: 'mahasiswa2@zero-trust.local', role: 'mahasiswa', device: 'DEV-MHS-002' },
  { nim: '247006111666', nama: 'Rusdi Asli Ngawi', email: 'mahasiswa3@zero-trust.local', role: 'mahasiswa', device: 'DEV-MHS-003' }
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zero_trust_nilai'
  });

  try {
    const passwordHash = await bcrypt.hash('Demo123!', 12);
    const userIds = {};
    for (const user of users) {
      await db.execute(
        `INSERT INTO users (nim_nip, nama, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE nim_nip = VALUES(nim_nip), nama = VALUES(nama), email = VALUES(email), password_hash = VALUES(password_hash), role = VALUES(role)`,
        [user.nim, user.nama, user.email, passwordHash, user.role]
      );
      const [[row]] = await db.execute('SELECT id FROM users WHERE nim_nip = ?', [user.nim]);
      userIds[user.nim] = row.id;
      await db.execute(
        `INSERT INTO devices (user_id, device_id, deskripsi, active)
         VALUES (?, ?, 'Perangkat demo', TRUE)
         ON DUPLICATE KEY UPDATE deskripsi = VALUES(deskripsi), active = TRUE`,
        [row.id, user.device]
      );
    }

    const classes = [
      { kode: 'IF101-A', nama: 'Informatika A', dosen: users[1].nim },
      { kode: 'IF101-B', nama: 'Informatika B', dosen: users[2].nim }
    ];
    const classIds = {};
    for (const kelas of classes) {
      await db.execute(
        `INSERT INTO classes (kode, nama, dosen_id) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE nama = VALUES(nama), dosen_id = VALUES(dosen_id)`,
        [kelas.kode, kelas.nama, userIds[kelas.dosen]]
      );
      const [[row]] = await db.execute('SELECT id FROM classes WHERE kode = ?', [kelas.kode]);
      classIds[kelas.kode] = row.id;
    }

    const enrollments = [
      ['IF101-A', '247006111051'], ['IF101-A', '247006111069'],
      ['IF101-B', '247006111069'], ['IF101-B', '247006111666']
    ];
    for (const [kode, nim] of enrollments) {
      const classId = classIds[kode];
      const studentId = userIds[nim];
      await db.execute('INSERT IGNORE INTO enrollments (class_id, mahasiswa_id) VALUES (?, ?)', [classId, studentId]);
      await db.execute(
        'INSERT IGNORE INTO grades (class_id, mahasiswa_id, nilai, final) VALUES (?, ?, NULL, FALSE)',
        [classId, studentId]
      );
    }

    console.log('Seed berhasil dibuat. Akun demo: password Demo123!');
    console.log('Admin: Mr. Irony (admin@zero-trust.local)');
    console.log('Dosen: Imut Rizman (NIP 198701012026011001), Mas Gatot Mendut-Mendut (NIP 198802022026011002)');
    console.log('Mahasiswa: Fiqri Mochamad Fadilah (247006111051), King Nasir Rongawi (247006111069), Rusdi Asli Ngawi (247006111666)');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('Seed gagal:', error.message);
  process.exitCode = 1;
});
