CREATE DATABASE IF NOT EXISTS zero_trust_nilai
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zero_trust_nilai;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nim_nip VARCHAR(30) NOT NULL UNIQUE,
  nama VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('mahasiswa', 'dosen', 'admin') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  deskripsi VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_user_device (user_id, device_id),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(30) NOT NULL UNIQUE,
  nama VARCHAR(120) NOT NULL,
  dosen_id BIGINT UNSIGNED NOT NULL,
  CONSTRAINT fk_classes_dosen FOREIGN KEY (dosen_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  class_id BIGINT UNSIGNED NOT NULL,
  mahasiswa_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (class_id, mahasiswa_id),
  CONSTRAINT fk_enrollments_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_enrollments_student FOREIGN KEY (mahasiswa_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS grades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id BIGINT UNSIGNED NOT NULL,
  mahasiswa_id BIGINT UNSIGNED NOT NULL,
  nilai DECIMAL(5,2) NULL,
  final BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_class_student (class_id, mahasiswa_id),
  CONSTRAINT fk_grades_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_grades_student FOREIGN KEY (mahasiswa_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transcripts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id BIGINT UNSIGNED NOT NULL,
  mahasiswa_id BIGINT UNSIGNED NOT NULL,
  nilai DECIMAL(5,2) NOT NULL,
  finalized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_transcript_class_student (class_id, mahasiswa_id),
  CONSTRAINT fk_transcripts_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_transcripts_student FOREIGN KEY (mahasiswa_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subject VARCHAR(120) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  device_id VARCHAR(100) NULL,
  result ENUM('allow', 'deny') NOT NULL,
  reason VARCHAR(255) NOT NULL
);
