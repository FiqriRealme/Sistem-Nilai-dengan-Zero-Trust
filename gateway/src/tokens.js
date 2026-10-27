const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret-32-chars';

function createAccessToken(user) {
  return jwt.sign({ role: user.role }, JWT_SECRET, { subject: String(user.id), expiresIn: '10m' });
}

function createServiceToken() {
  return jwt.sign({ role: 'service', clientId: process.env.SERVICE_CLIENT_ID || 'service-nilai' }, JWT_SECRET, {
    subject: 'service-nilai', expiresIn: '5m'
  });
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { JWT_SECRET, createAccessToken, createServiceToken, createRefreshToken, hashToken };
