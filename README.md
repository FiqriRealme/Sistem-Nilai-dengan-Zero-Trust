# Identitas

Nama  : Fiqri Mochamad Fadilah
NPM   : 247006111051
Kelas : B

# Sistem Nilai dengan Zero Trust

Proyek tugas praktikum Keamanan Informasi. API gateway berjalan pada port 3000, Service Nilai pada 3001, dan Service Transkrip pada 3002. Sistem menyediakan login, token, verifikasi device, policy gateway, gateway secret, audit keputusan, pengelolaan nilai, finalisasi kelas, serta sinkronisasi dan pembacaan transkrip.

## Prasyarat

- Node.js 18 atau lebih baru dan npm
- MySQL/MariaDB lokal, misalnya melalui XAMPP

## Menyiapkan proyek

1. Jalankan MySQL dari XAMPP Control Panel.
2. Jalankan `npm install` dari folder utama proyek.
3. Salin `.env.example` menjadi `.env`, lalu isi rahasia dan pengaturan database lokal.
4. Jalankan `database/schema.sql` melalui tab SQL phpMyAdmin.
5. Isi data awal menggunakan `npm run seed`.
6. Jalankan semua aplikasi dengan `npm run dev`.

Gateway dan service menyediakan `GET /health` pada port masing-masing. Contoh pemeriksaan:

```sh
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## Akun dan perangkat demo

Setelah menjalankan seed, semua akun demo memakai password `Demo123!`.

| Role dan nama | NIM/NIP | Email | Device ID |
|---|---|---|---|
| Admin — Mr. Irony | `ADM001` | `admin@zero-trust.local` | `DEV-ADMIN-001` |
| Dosen — Imut Rizman | `198701012026011001` | `dosen1@zero-trust.local` | `DEV-DOSEN-001` |
| Dosen — Mas Gatot Mendut-Mendut | `198802022026011002` | `dosen2@zero-trust.local` | `DEV-DOSEN-002` |
| Mahasiswa — Fiqri Mochamad Fadilah | `247006111051` | `mahasiswa1@zero-trust.local` | `DEV-MHS-001` |
| Mahasiswa — King Nasir Rongawi | `247006111069` | `mahasiswa2@zero-trust.local` | `DEV-MHS-002` |
| Mahasiswa — Rusdi Asli Ngawi | `247006111666` | `mahasiswa3@zero-trust.local` | `DEV-MHS-003` |

Seed dapat dijalankan ulang untuk memastikan akun, perangkat, kelas, dan peserta kelas demo tersedia.

## Mencoba autentikasi

Jalankan semua aplikasi dengan `npm run dev`, lalu dari PowerShell minta token mahasiswa. Device ID harus sama dengan yang dibuat oleh seed:

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/login `
  -Headers @{'X-Device-ID'='DEV-MHS-001'} `
  -ContentType 'application/json' `
  -Body '{"email":"mahasiswa1@zero-trust.local","password":"Demo123!"}'
$login.user
```

Login mengembalikan access token yang berlaku 10 menit dan refresh token yang berlaku 1 hari. Refresh token tersimpan sebagai hash di database, diputar saat refresh, dan dicabut saat logout. Endpoint bisnis memerlukan `Authorization: Bearer <accessToken>` dan `X-Device-ID`. Token service diminta lewat `POST /auth/service` menggunakan `clientId` dan `clientSecret` dari `.env`.

Setiap keputusan akses gateway ditulis ke tabel `audit_logs`. Akses langsung ke endpoint bisnis service dibatasi: service mendengarkan pada localhost dan memverifikasi `X-Gateway-Secret` serta tanda tangan dan masa berlaku JWT.

## Endpoint bisnis

Semua endpoint berikut harus dipanggil melalui port 3000 dengan `Authorization: Bearer <accessToken>` dan `X-Device-ID`, kecuali autentikasi.

| Method dan path | Hak akses |
|---|---|
| `GET /nilai` | Mahasiswa melihat nilainya; dosen melihat nilai kelas yang diampu |
| `PUT /nilai/:id` | Dosen pengampu mengubah nilai belum final, pukul 07.00–21.00 |
| `POST /kelas/:id/finalisasi` | Dosen pengampu memfinalisasi kelas, pukul 07.00–21.00 |
| `GET /transkrip/:nim` | Mahasiswa melihat miliknya; admin melihat semua |
| `POST /transkrip/sinkron` | Khusus token service dari Service Nilai |

## Demo mengubah dan memfinalisasi nilai

Login sebagai dosen pengampu, ambil daftar nilai, isi nilai yang masih kosong, lalu finalisasi salah satu kelasnya. Contoh berikut memakai dosen pertama:

```powershell
$dosen = Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/login `
  -Headers @{'X-Device-ID'='DEV-DOSEN-001'} `
  -ContentType 'application/json' `
  -Body '{"email":"dosen1@zero-trust.local","password":"Demo123!"}'
$h = @{Authorization="Bearer $($dosen.accessToken)"; 'X-Device-ID'='DEV-DOSEN-001'}
$nilai = Invoke-RestMethod -Method Get -Uri http://localhost:3000/nilai -Headers $h
$nilai.data
foreach ($baris in $nilai.data) {
  if ($null -eq $baris.nilai) {
    Invoke-RestMethod -Method Put -Uri "http://localhost:3000/nilai/$($baris.id)" `
      -Headers $h -ContentType 'application/json' -Body '{"nilai":85}'
  }
}
$kelasId = $nilai.data[0].classId
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/kelas/$kelasId/finalisasi" -Headers $h
```

Finalisasi meminta token service ke gateway dan mengirim nilai final ke Service Transkrip. Fiqri Mochamad Fadilah dapat membaca transkripnya melalui `GET /transkrip/247006111051` dengan token dan device ID mahasiswa yang sesuai. Pastikan waktu lokal berada pada rentang akses sebelum menguji perubahan atau finalisasi.
