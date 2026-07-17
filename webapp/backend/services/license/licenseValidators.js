const LicenseState = Object.freeze({
  ACTIVE: 'ACTIVE',
  GRACE_PERIOD: 'GRACE_PERIOD',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
  TAMPERED: 'TAMPERED',
  UNACTIVATED: 'UNACTIVATED',
  CLOCK_WARNING: 'CLOCK_WARNING'
});

const LicenseEdition = Object.freeze({
  STARTER: 'starter',
  STANDARD: 'standard',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
  DEVELOPER: 'developer',
  EDUCATION: 'education',
  GOVERNMENT: 'government'
});

const EDITION_ORDER = Object.freeze({
  [LicenseEdition.STARTER]: 0,
  [LicenseEdition.STANDARD]: 1,
  [LicenseEdition.PROFESSIONAL]: 2,
  [LicenseEdition.ENTERPRISE]: 3,
  [LicenseEdition.DEVELOPER]: 99,
  [LicenseEdition.EDUCATION]: 4,
  [LicenseEdition.GOVERNMENT]: 5
});

const AuditEvent = Object.freeze({
  ACTIVATION: 'LICENSE_ACTIVATION',
  UPGRADE: 'LICENSE_UPGRADE',
  VALIDATION: 'LICENSE_VALIDATION',
  EXPIRY_WARNING: 'LICENSE_EXPIRY_WARNING',
  EXPIRED: 'LICENSE_EXPIRED',
  TAMPER_DETECTED: 'LICENSE_TAMPER_DETECTED',
  HARDWARE_MISMATCH: 'LICENSE_HARDWARE_MISMATCH',
  INVALID_SIGNATURE: 'LICENSE_INVALID_SIGNATURE',
  DEVELOPER_MODE: 'LICENSE_DEVELOPER_MODE',
  SELF_TEST: 'LICENSE_SELF_TEST',
  TRANSFER: 'LICENSE_TRANSFER',
  RECOVERY: 'LICENSE_RECOVERY',
  CLOCK_ROLLBACK: 'LICENSE_CLOCK_ROLLBACK',
  ACTIVATION_FAILED: 'LICENSE_ACTIVATION_FAILED'
});

const HealthStatus = Object.freeze({
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL'
});

function validateLocal(licenseData, { hardwareFingerprint, currentTime, revokedLicenseIds }) {
  const result = { valid: false, state: LicenseState.INVALID, reason: null, isDeveloper: false };

  if (!licenseData || typeof licenseData !== 'object') {
    return { ...result, reason: 'Invalid license data format' };
  }

  if (licenseData.type === 'developer') {
    return { valid: true, state: LicenseState.ACTIVE, edition: LicenseEdition.DEVELOPER, isDeveloper: true, graceDaysRemaining: null };
  }

  if (revokedLicenseIds && Array.isArray(revokedLicenseIds) && revokedLicenseIds.includes(licenseData.license_id)) {
    return { ...result, state: LicenseState.INVALID, reason: 'License has been revoked' };
  }

  const minVer = licenseData.erp_version_range && licenseData.erp_version_range.min;
  const maxVer = licenseData.erp_version_range && licenseData.erp_version_range.max;
  if (minVer && maxVer) {
    try {
      const pkg = require('../../package.json');
      const currentVersion = pkg.version;
      if (compareVersions(currentVersion, minVer) < 0 || compareVersions(currentVersion, maxVer) > 0) {
        return { ...result, reason: `ERP version ${currentVersion} outside range [${minVer}, ${maxVer}]` };
      }
    } catch (e) {}
  }

  if (licenseData.expiration_date) {
    const expDate = new Date(licenseData.expiration_date);
    const graceMs = (licenseData.grace_days || 30) * 24 * 60 * 60 * 1000;
    const graceEnd = new Date(expDate.getTime() + graceMs);

    if (currentTime > graceEnd) {
      return { ...result, state: LicenseState.EXPIRED, reason: 'License expired on ' + licenseData.expiration_date };
    }
    if (currentTime > expDate) {
      const remainingMs = graceEnd.getTime() - currentTime.getTime();
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      return { valid: true, state: LicenseState.GRACE_PERIOD, edition: licenseData.edition, isDeveloper: false, graceDaysRemaining: remainingDays, reason: 'Grace period: ' + remainingDays + ' days remaining' };
    }
  }

  if (hardwareFingerprint && licenseData.hardware && licenseData.hardware.tolerance_threshold > 0 && licenseData.hardware.fingerprint !== '*') {
    const threshold = licenseData.hardware.tolerance_threshold || 0.7;
    let confidence;
    if (licenseData.hardware.components && typeof licenseData.hardware.components === 'object' && Object.keys(licenseData.hardware.components).length > 0) {
      confidence = computeConfidence(hardwareFingerprint, licenseData.hardware);
    } else {
      const { generateFingerprint } = require('./hardwareFingerprint');
      const currentFp = generateFingerprint(hardwareFingerprint);
      confidence = currentFp === licenseData.hardware.fingerprint ? 1.0 : 0.0;
    }
    if (confidence < threshold) {
      return { ...result, state: LicenseState.TAMPERED, reason: 'Hardware confidence ' + confidence.toFixed(2) + ' < threshold ' + threshold };
    }
  }

  return { valid: true, state: LicenseState.ACTIVE, edition: licenseData.edition, isDeveloper: false, graceDaysRemaining: null };
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

const HW_WEIGHTS = {
  machineGuid: 0.25,
  motherboard: 0.20,
  cpu: 0.15,
  diskSerial: 0.15,
  bios: 0.10,
  macAddress: 0.10,
  systemSku: 0.05
};

function computeConfidence(currentHw, licenseHw) {
  let confidence = 0;
  const currentComponents = (currentHw && currentHw.components) || currentHw || {};
  const licenseComponents = (licenseHw && licenseHw.components) || licenseHw || {};
  for (const [key, weight] of Object.entries(HW_WEIGHTS)) {
    if (currentComponents[key] && licenseComponents[key] && String(currentComponents[key]).toLowerCase() === String(licenseComponents[key]).toLowerCase()) {
      confidence += weight;
    }
  }
  return confidence;
}

module.exports = {
  LicenseState,
  LicenseEdition,
  EDITION_ORDER,
  AuditEvent,
  HealthStatus,
  validateLocal,
  compareVersions,
  HW_WEIGHTS,
  computeConfidence
};
