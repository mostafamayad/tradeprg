const crypto = require('crypto');
const fs = require('fs');

function _loadKeyFromParts(parts) {
  const raw = Buffer.from(parts.join(''), 'base64');
  const b64 = raw.toString('base64');
  const lines = ['-----BEGIN PUBLIC KEY-----'];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.substring(i, i + 64));
  }
  lines.push('-----END PUBLIC KEY-----');
  return lines.join('\n');
}

const KEYS = {
  KEY_V1: {
    parts: [
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvva5dPqWKSjV2gBnFqFj',
      '5oBLoEtyUjgIu79cRjEcmvuocur+4eYw39tITy/XAC71SPfU0iHvpYpyIIfcKF+V',
      'aKNWI8cDEf7PoRV9tozJiWhdf17J6i8xEBOr4NfPUz9JWyiWBxHwj+Eq9I1CLFH3',
      'JtOUzrDUxWKT/pdJ3AgSm8iyYLxzxB4EgDg1/N6TR8q5YDnWzFfqWSkw9F6U1uZb',
      'Pf8n9EEMLRZSKgb+M2fdZ8jVpkCeq0h4zVFDLzBeY9HCiXgDlGjOG6XLu8qNl0le',
      'jkBqpjjK8AmPnr2yBbqHHy0ZCDDMUAZLZK6Gi9UG/cT22TjOtbAUcIOJOF0u1tiz',
      'KwIDAQAB'
    ]
  }
};

for (const k of Object.keys(KEYS)) {
  KEYS[k].pem = _loadKeyFromParts(KEYS[k].parts);
  const raw = Buffer.from(KEYS[k].parts.join(''), 'base64');
  KEYS[k].fingerprint = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

const KEY_IDS = Object.keys(KEYS);
const DEFAULT_KEY_ID = KEY_IDS[0];
const AES_KEY = crypto.createHash('sha256').update('TradeProLicenseV2AES256GCM').digest();
const SIG_ALGO = 'RSA-SHA256';
const SALT_LENGTH = 32;

function encrypt(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(payload, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(buffer) {
  if (buffer.length < 28) return null;
  const iv = buffer.slice(0, 12);
  const tag = buffer.slice(12, 28);
  const enc = buffer.slice(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch (e) {
    return null;
  }
}

function verifyWithKey(buffer, signature, keyId) {
  const key = KEYS[keyId];
  if (!key) return false;
  try {
    const verifier = crypto.createVerify(SIG_ALGO);
    verifier.update(buffer);
    return verifier.verify({ key: key.pem, saltLength: SALT_LENGTH }, signature);
  } catch (e) {
    return false;
  }
}

function parseLicenseBlob(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512) return null;
  const encrypted = buffer.slice(0, -256);
  const signature = buffer.slice(-256);

  let parsed = null;
  let usedKeyId = null;

  for (const keyId of KEY_IDS) {
    if (verifyWithKey(encrypted, signature, keyId)) {
      usedKeyId = keyId;
      break;
    }
  }

  if (!usedKeyId) return null;

  const decrypted = decrypt(encrypted);
  if (!decrypted) return null;

  try {
    parsed = JSON.parse(decrypted.toString('utf8'));
    parsed._verified_by_key = usedKeyId;
    return parsed;
  } catch (e) {
    return null;
  }
}

function getPublicKeyFingerprint(keyId) {
  const kid = keyId || DEFAULT_KEY_ID;
  const key = KEYS[kid];
  if (!key) return null;
  return key.fingerprint;
}

function getAvailableKeyIds() {
  return [...KEY_IDS];
}

function getDefaultKeyId() {
  return DEFAULT_KEY_ID;
}

function verifyRevocationList(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { valid: true, revoked: [] };
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!content.signature || !content.revoked_licenses || !Array.isArray(content.revoked_licenses)) {
      return { valid: false, revoked: [], error: 'Invalid revocation list format' };
    }
    const sig = Buffer.from(content.signature, 'base64');
    const payload = Buffer.from(JSON.stringify({ version: content.version, issued_at: content.issued_at, revoked_licenses: content.revoked_licenses }));
    let verified = false;
    for (const keyId of KEY_IDS) {
      if (verifyWithKey(payload, sig, keyId)) {
        verified = true;
        break;
      }
    }
    if (!verified) return { valid: false, revoked: [], error: 'Revocation list signature invalid' };
    return { valid: true, revoked: content.revoked_licenses, issuedAt: content.issued_at };
  } catch (e) {
    return { valid: false, revoked: [], error: e.message };
  }
}

module.exports = {
  encrypt,
  decrypt,
  verify: function(buffer, signature) {
    for (const keyId of KEY_IDS) {
      if (verifyWithKey(buffer, signature, keyId)) return true;
    }
    return false;
  },
  verifyWithKey,
  parseLicenseBlob,
  getPublicKeyFingerprint,
  getAvailableKeyIds,
  getDefaultKeyId,
  verifyRevocationList,
  KEYS
};
