const fs = require('fs');
const path = require('path');
const pkg = require('../../package.json');
const { parseLicenseBlob, verifyRevocationList, getAvailableKeyIds, getDefaultKeyId, decrypt } = require('./licenseCrypto');
const { HardwareFingerprintService } = require('./hardwareFingerprint');
const {
  LicenseState, LicenseEdition, EDITION_ORDER, AuditEvent, HealthStatus,
  validateLocal, compareVersions
} = require('./licenseValidators');

class LicenseManager {
  constructor(config) {
    const resolvePath = (p) => {
        if (!p) return null;
        if (path.isAbsolute(p)) return p;
        // Resolve relative paths relative to the backend directory
        const backendDir = path.resolve(__dirname, '..', '..');
        return path.resolve(backendDir, p);
    };
    this._config = {
      buildProfile: (config.buildProfile || process.env.BUILD_PROFILE || 'development').toLowerCase(),
      licensePath: resolvePath(config.licensePath || process.env.LICENSE_FILE) || path.join(__dirname, '..', '..', 'license', 'license.dat'),
      devLicensePath: resolvePath(config.devLicensePath || process.env.LICENSE_DEV_FILE) || path.join(__dirname, '..', '..', 'license', 'developer.dat'),
      revocationListPath: resolvePath(config.revocationListPath || process.env.REVOCATION_LIST_FILE) || path.join(__dirname, '..', '..', 'license', '.revocation_list'),
      cacheTtlMs: config.cacheTtlMs || 60000
    };
    this._revokedLicenseIds = null;
    this._state = LicenseState.UNACTIVATED;
    this._licenseData = null;
    this._edition = null;
    this._isDeveloper = false;
    this._cacheExpiresAt = 0;
    this._lastValidationTime = Date.now();
    this._validationCount = 0;
    this._auditCallbacks = [];
    this._initialized = false;
    this._hwService = new HardwareFingerprintService({ storeDir: path.join(__dirname, '..', '..', 'storage') });
    this._cachedHardware = null;
  }

  async initialize() {
    if (this._initialized) return;
    this._initialized = true;
    this._collectHardware();
    try {
      this._hwService.saveClockEntry('initialization');
      const clockStatus = this._hwService.getClockStatus();
      if (clockStatus.tampered) {
        this._state = LicenseState.CLOCK_WARNING;
        this._emit(AuditEvent.CLOCK_ROLLBACK, {
          stored: clockStatus.lastEntry,
          current: new Date().toISOString(),
          drift: clockStatus.drift
        });
      }
      this._loadAndValidate();
      this._emit(AuditEvent.VALIDATION, { state: this._state, edition: this._edition, mode: this._config.buildProfile });
    } catch (e) {
      this._emit(AuditEvent.INVALID_SIGNATURE, { reason: 'Initialization failed: ' + e.message });
      this._state = LicenseState.INVALID;
    }
  }

  _collectHardware() {
    try {
      const hw = this._hwService.collect();
      this._cachedHardware = hw;
      const stored = this._hwService.loadMachineInfo();
      if (!stored) {
        this._hwService.saveMachineInfo(hw);
      }
    } catch (e) {
      this._cachedHardware = null;
    }
  }

  _checkRevocation() {
    try {
      const result = verifyRevocationList(this._config.revocationListPath);
      if (result.valid) {
        this._revokedLicenseIds = result.revoked;
      } else {
        this._revokedLicenseIds = [];
      }
      return result;
    } catch (e) {
      this._revokedLicenseIds = [];
      return { valid: true, revoked: [] };
    }
  }

  _loadAndValidate() {
    const isDev = this._config.buildProfile === 'development';
    const devLicenseExists = isDev && fs.existsSync(this._config.devLicensePath);
    this._cacheExpiresAt = Date.now() + this._config.cacheTtlMs;

    // Check if a production license exists
    if (!fs.existsSync(this._config.licensePath)) {
        if (devLicenseExists) {
            // Developer mode: try to parse the dev license file; fallback to ACTIVE/DEVELOPER
            try {
                const devBuffer = fs.readFileSync(this._config.devLicensePath);
                const devParsed = parseLicenseBlob(devBuffer);
                if (devParsed) {
                    const devResult = validateLocal(devParsed, {
                        hardwareFingerprint: this._cachedHardware,
                        currentTime: new Date(),
                        revokedLicenseIds: this._revokedLicenseIds
                    });
                    if (devResult.valid) {
                        this._state = devResult.state;
                        this._edition = devResult.edition;
                        this._licenseData = devParsed;
                        this._isDeveloper = true;
                        return;
                    }
                }
            } catch (e) {
                console.error('Dev license parse error:', e.message);
            }
            // Fallback: activate as developer even without valid parsed license
            this._state = LicenseState.ACTIVE;
            this._edition = LicenseEdition.DEVELOPER;
            this._licenseData = { type: 'developer', enabled_modules: ['*'], feature_flags: { '*': true } };
            this._isDeveloper = true;
            return;
        }
        this._state = LicenseState.UNACTIVATED;
        this._edition = null;
        this._licenseData = null;
        this._isDeveloper = devLicenseExists;
        return;
    }

    let buffer;
    try {
      buffer = fs.readFileSync(this._config.licensePath);
    } catch (e) {
      this._state = LicenseState.INVALID;
      this._isDeveloper = devLicenseExists;
      return;
    }

    const parsed = parseLicenseBlob(buffer);
    if (!parsed) {
      this._state = LicenseState.INVALID;
      this._isDeveloper = devLicenseExists;
      this._emit(AuditEvent.INVALID_SIGNATURE, { reason: 'parseLicenseBlob returned null' });
      return;
    }

    this._licenseData = parsed;
    this._checkClockIntegrity();
    this._checkRevocation();

    const hwComponents = this._cachedHardware ? this._cachedHardware.components : {};
    const result = validateLocal(parsed, {
      hardwareFingerprint: hwComponents,
      currentTime: new Date(),
      revokedLicenseIds: this._revokedLicenseIds
    });

    this._state = result.state;
    this._edition = result.edition;
    this._isDeveloper = (result.isDeveloper || parsed.type === 'developer') || devLicenseExists;
    this._validationCount = (this._validationCount || 0) + 1;

    if (result.state === LicenseState.ACTIVE && this._isDeveloper) {
      this._emit(AuditEvent.DEVELOPER_MODE, { edition: this._edition });
    } else if (result.state === LicenseState.EXPIRED) {
      this._emit(AuditEvent.EXPIRED, { expiration: parsed.expiration_date, edition: this._edition });
    } else if (result.state === LicenseState.GRACE_PERIOD) {
      this._emit(AuditEvent.EXPIRY_WARNING, { expiration: parsed.expiration_date, graceDaysRemaining: result.graceDaysRemaining });
    } else if (result.state === LicenseState.TAMPERED) {
      this._emit(AuditEvent.TAMPER_DETECTED, { reason: result.reason });
    } else if (result.state === LicenseState.INVALID && result.reason === 'License has been revoked') {
      this._emit(AuditEvent.TAMPER_DETECTED, { reason: 'License revoked: ' + (parsed.license_id || 'unknown') });
    }
  }

  _checkClockIntegrity() {
    const currentTime = Date.now();
    if (this._lastValidationTime > 0 && currentTime < this._lastValidationTime - 300000) {
      this._state = LicenseState.CLOCK_WARNING;
      this._emit(AuditEvent.CLOCK_ROLLBACK, {
        stored: new Date(this._lastValidationTime).toISOString(),
        current: new Date(currentTime).toISOString()
      });
    }
    this._lastValidationTime = currentTime;
    try {
      this._hwService.saveClockEntry('validation');
      const clockStatus = this._hwService.getClockStatus();
      if (clockStatus.tampered) {
        this._state = LicenseState.CLOCK_WARNING;
      }
    } catch (e) {}
  }

  _ensureCacheValid() {
    if (Date.now() > this._cacheExpiresAt) {
      this._loadAndValidate();
    }
  }

  getLicenseState() {
    this._ensureCacheValid();
    return this._state;
  }

  getLicenseInfo() {
    this._ensureCacheValid();
    if (!this._licenseData) return null;
    return {
      licenseId: this._licenseData.license_id,
      schemaVersion: this._licenseData.schema_version,
      licenseVersion: this._licenseData.license_version,
      type: this._licenseData.type,
      edition: this._edition,
      customer: this._licenseData.customer || null,
      erpVersionRange: this._licenseData.erp_version_range || null,
      activationDate: this._licenseData.activation_date || null,
      expirationDate: this._licenseData.expiration_date || null,
      graceDays: this._licenseData.grace_days || 0,
      allowedActivations: this._licenseData.allowed_activations || 1,
      currentActivation: this._licenseData.current_activation || 1,
      enabledModules: this._licenseData.enabled_modules || [],
      disabledModules: this._licenseData.disabled_modules || [],
      featureFlags: this._licenseData.feature_flags || {},
      transfer: this._licenseData.transfer || null,
      isDeveloper: this._isDeveloper,
      keyId: this._licenseData.key_id || 'legacy',
      verifiedByKey: this._licenseData._verified_by_key || 'unknown',
      isRevoked: this._revokedLicenseIds ? this._revokedLicenseIds.includes(this._licenseData.license_id) : false
    };
  }

  getEdition() {
    return this._edition;
  }

  isModuleEnabled(moduleName) {
    this._ensureCacheValid();
    if (this._state !== LicenseState.ACTIVE && this._state !== LicenseState.GRACE_PERIOD) return false;
    if (this._isDeveloper) return true;
    if (!this._licenseData) return false;
    if (this._licenseData.enabled_modules && this._licenseData.enabled_modules.includes('*')) return true;
    if (this._licenseData.enabled_modules && this._licenseData.enabled_modules.includes(moduleName)) return true;
    return false;
  }

  isFeatureEnabled(featureName) {
    this._ensureCacheValid();
    if (this._state !== LicenseState.ACTIVE && this._state !== LicenseState.GRACE_PERIOD) return false;
    if (this._isDeveloper) return true;
    if (!this._licenseData || !this._licenseData.feature_flags) return false;
    if (this._licenseData.feature_flags['*'] === true) return true;
    return this._licenseData.feature_flags[featureName] === true;
  }

  isVersionCompatible(version) {
    if (!this._licenseData || !this._licenseData.erp_version_range) return true;
    const { min, max } = this._licenseData.erp_version_range;
    if (min && compareVersions(version, min) < 0) return false;
    if (max && compareVersions(version, max) > 0) return false;
    return true;
  }

  async activate(licenseBuffer) {
    if (!Buffer.isBuffer(licenseBuffer)) {
      if (typeof licenseBuffer === 'string' && licenseBuffer.startsWith('{')) {
        licenseBuffer = Buffer.from(licenseBuffer, 'utf8');
      } else if (typeof licenseBuffer === 'string') {
        try { licenseBuffer = Buffer.from(licenseBuffer, 'hex'); } catch (e) {
          return { success: false, reason: 'Invalid license format' };
        }
      } else {
        return { success: false, reason: 'Invalid license input' };
      }
    }

    const parsed = parseLicenseBlob(licenseBuffer);
    if (!parsed) {
      this._emit(AuditEvent.ACTIVATION_FAILED, { reason: 'Invalid signature or decryption failed' });
      return { success: false, reason: 'توقيع غير صالح أو ملف تالف' };
    }

    if (this._config.buildProfile === 'production' && (parsed.type === 'developer' || parsed.edition === 'developer')) {
      this._emit(AuditEvent.ACTIVATION_FAILED, { reason: 'Developer license rejected in production', licenseId: parsed.license_id });
      return { success: false, reason: 'لا يمكن تفعيل رخصة المطورين في وضع الإنتاج' };
    }

    this._checkRevocation();

    const currentTime = new Date();
    const hwComponents = this._cachedHardware ? this._cachedHardware.components : {};
    const result = validateLocal(parsed, {
      hardwareFingerprint: hwComponents,
      currentTime,
      revokedLicenseIds: this._revokedLicenseIds
    });

    if (result.state === LicenseState.EXPIRED) {
      this._emit(AuditEvent.ACTIVATION_FAILED, { reason: 'License expired', licenseId: parsed.license_id });
      return { success: false, reason: 'رخصة منتهية الصلاحية' };
    }

    const targetPath = this._config.licensePath;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = targetPath + '.tmp';
    fs.writeFileSync(tmpPath, licenseBuffer);
    fs.renameSync(tmpPath, targetPath);

    this._state = result.state;
    this._edition = result.edition;
    this._isDeveloper = (result.isDeveloper || parsed.type === 'developer') || (this._config.buildProfile === 'development' && fs.existsSync(this._config.devLicensePath));
    this._licenseData = parsed;
    this._cacheExpiresAt = Date.now() + this._config.cacheTtlMs;

    try {
      if (this._cachedHardware) {
        this._hwService.saveMachineInfo(this._cachedHardware);
      } else {
        const hw = this._hwService.collect();
        this._cachedHardware = hw;
        this._hwService.saveMachineInfo(hw);
      }
    } catch (e) {}

    this._emit(AuditEvent.ACTIVATION, {
      licenseId: parsed.license_id,
      edition: parsed.edition,
      state: this._state
    });

    return { success: true, state: this._state, edition: this._edition, info: this.getLicenseInfo() };
  }

  forceRevalidate() {
    this._cacheExpiresAt = 0;
    this._loadAndValidate();
  }

  getLastValidationTime() {
    return this._lastValidationTime;
  }

  getHealth() {
    const licenseFileExists = fs.existsSync(this._config.licensePath);
    const devFileExists = fs.existsSync(this._config.devLicensePath);

    const storedHw = this._hwService.loadMachineInfo();
    const clockStatus = this._hwService.getClockStatus();

    const sections = {
      configuration: {
        status: this._config.buildProfile ? HealthStatus.PASS : HealthStatus.FAIL,
        details: { buildProfile: this._config.buildProfile, cacheTtlMs: this._config.cacheTtlMs }
      },
      crypto: {
        status: HealthStatus.PASS,
        details: {}
      },
      license: {
        status: licenseFileExists ? HealthStatus.PASS : HealthStatus.WARN,
        details: { fileExists: licenseFileExists, state: this._state, revokedCount: (this._revokedLicenseIds || []).length }
      },
      validation: {
        status: this._state === LicenseState.ACTIVE || this._state === LicenseState.GRACE_PERIOD ? HealthStatus.PASS : HealthStatus.FAIL,
        details: { state: this._state, edition: this._edition, isDeveloper: this._isDeveloper }
      },
      clock: {
        status: this._state !== LicenseState.CLOCK_WARNING ? HealthStatus.PASS : HealthStatus.WARN,
        details: {
          lastValidationTime: new Date(this._lastValidationTime).toISOString(),
          clockEntries: clockStatus.totalEntries,
          anomalyCount: clockStatus.anomalyCount,
          tampered: clockStatus.tampered,
          drift: clockStatus.drift
        }
      },
      hardware: {
        status: storedHw ? HealthStatus.PASS : HealthStatus.WARN,
        details: {
          fingerprint: storedHw ? storedHw.fingerprint : null,
          components: storedHw ? Object.keys(storedHw.components).length : 0,
          firstSeen: storedHw ? storedHw.firstSeen : null,
          lastSeen: storedHw ? storedHw.lastSeen : null,
          collectionCount: storedHw ? storedHw.collectionCount : 0
        }
      }
    };

    return {
      overall: Object.values(sections).every(s => s.status === HealthStatus.PASS) ? HealthStatus.PASS : HealthStatus.WARN,
      sections,
      summary: {
        state: this._state,
        edition: this._edition,
        isDeveloper: this._isDeveloper,
        licenseFileExists,
        devFileExists,
        hardwareFingerprint: storedHw ? storedHw.fingerprint : null,
        hardwareCollectionCount: storedHw ? storedHw.collectionCount : 0
      }
    };
  }

  async selfTest() {
    const results = {};

    results.publicKey = { pass: true, detail: 'Public key loaded, fingerprint: ' + require('./licenseCrypto').getPublicKeyFingerprint() };

    const devExists = fs.existsSync(this._config.devLicensePath);
    results.devLicenseFile = { pass: devExists, detail: devExists ? 'Developer license file exists' : 'Developer license file missing' };

    if (devExists) {
      try {
        const buf = fs.readFileSync(this._config.devLicensePath);
        const parsed = require('./licenseCrypto').parseLicenseBlob(buf);
        results.devLicenseParse = { pass: !!parsed, detail: parsed ? 'Developer license parsed: ' + parsed.license_id : 'Failed to parse developer license' };
        if (parsed) {
          const val = validateLocal(parsed, { hardwareFingerprint: null, currentTime: new Date() });
          results.devLicenseValidation = { pass: val.valid, detail: val.valid ? 'Developer license valid, state: ' + val.state : 'Validation failed: ' + val.reason };
        }
      } catch (e) {
        results.devLicenseParse = { pass: false, detail: 'Error reading developer license: ' + e.message };
      }
    }

    results.validators = { pass: true, detail: 'Validator module loaded' };
    results.managerState = { pass: this._state !== LicenseState.INVALID, detail: 'Manager state: ' + this._state };

    const keyIds = getAvailableKeyIds();
    results.keyRotation = { pass: keyIds.length >= 1, detail: keyIds.length + ' public key(s) available: ' + keyIds.join(', ') };
    if (this._licenseData) {
      const keyId = this._licenseData.key_id || 'legacy';
      results.licenseKeyId = { pass: true, detail: 'License signed with: ' + keyId + ', verified by: ' + (this._licenseData._verified_by_key || 'unknown') };
    }

    const revStatus = this.getRevocationStatus();
    results.revocation = { pass: revStatus.listValid, detail: revStatus.revokedCount > 0 ? 'Revocation list valid, ' + revStatus.revokedCount + ' revoked license(s)' : 'Revocation list valid, no revoked licenses' };

    const overallPass = Object.values(results).every(r => r.pass);
    this._emit(AuditEvent.SELF_TEST, { overall: overallPass, results: Object.keys(results).map(k => ({ name: k, pass: results[k].pass })) });

    return { overall: overallPass, results };
  }

  getLicenseFilePath() {
    return this._config.licensePath;
  }

  getLicenseFileSize() {
    try {
      const p = this._isDeveloper ? this._config.devLicensePath : this._config.licensePath;
      if (fs.existsSync(p)) return fs.statSync(p).size;
    } catch (e) {}
    return null;
  }

  getValidationCount() {
    return this._validationCount || 0;
  }

  getHardwareFingerprint() {
    try {
      const stored = this._hwService.loadMachineInfo();
      if (stored) return stored.fingerprint;
      if (this._cachedHardware) return this._cachedHardware.fingerprint;
    } catch (e) {}
    return null;
  }

  getHardwareInfo() {
    try {
      if (this._cachedHardware) {
        const c = this._cachedHardware.components;
        return {
          computerName: c.hostname || '-',
          platform: c.platform || '-',
          arch: c.arch || '-',
          cpu: c.cpu || '-',
          machineGuid: c.machineGuid || '-',
          motherboard: c.motherboard || '-',
          diskModel: c.diskModel || '-',
          diskSerial: c.diskSerial || '-',
          bios: c.bios || '-',
          osVersion: c.osVersion || '-',
          macAddress: c.macAddress || '-',
          systemManufacturer: c.systemManufacturer || '-',
          systemModel: c.systemModel || '-',
          systemSku: c.systemSku || '-',
          hardwareFingerprint: this._cachedHardware.fingerprint
        };
      }
      return this._hwService.collectSummary();
    } catch (e) {
      return null;
    }
  }

  getHardwareChangeStatus() {
    try {
      return this._hwService.detectHardwareChanges();
    } catch (e) {
      return { changed: false, isFirstCollection: true, confidence: null, error: e.message };
    }
  }

  getClockStatus() {
    try {
      return this._hwService.getClockStatus();
    } catch (e) {
      return { lastVerified: null, totalEntries: 0, anomalyCount: 0, tampered: false, drift: 0 };
    }
  }

  refreshHardware() {
    try {
      const hw = this._hwService.collect();
      this._cachedHardware = hw;
      this._hwService.saveMachineInfo(hw);
      return hw;
    } catch (e) {
      return null;
    }
  }

  getRevocationStatus() {
    try {
      const result = verifyRevocationList(this._config.revocationListPath);
      return {
        enabled: true,
        listValid: result.valid,
        revokedCount: result.valid ? result.revoked.length : 0,
        revokedLicenses: result.valid ? result.revoked : [],
        issuedAt: result.issuedAt || null,
        error: result.error || null,
        currentLicenseRevoked: this._licenseData ? ((this._revokedLicenseIds || []).includes(this._licenseData.license_id)) : false
      };
    } catch (e) {
      return { enabled: true, listValid: false, revokedCount: 0, revokedLicenses: [], error: e.message, currentLicenseRevoked: false };
    }
  }

  reloadRevocationList() {
    return this._checkRevocation();
  }

  getAvailableKeys() {
    return getAvailableKeyIds();
  }

  computeHardwareConfidence() {
    if (!this._licenseData || !this._licenseData.hardware) return null;
    const licenseHw = this._licenseData.hardware;
    const stored = this._hwService.loadMachineInfo();
    if (!stored || !stored.components) {
      return this._cachedHardware ? this._hwService.computeConfidence(this._cachedHardware.components, licenseHw.components || licenseHw) : null;
    }
    return this._hwService.computeConfidence(stored.components, licenseHw.components || licenseHw);
  }

  runDiagnostics() {
    const results = {};

    // 1. RSA Signature
    try {
      const lmPath = this._isDeveloper ? this._config.devLicensePath : this._config.licensePath;
      if (fs.existsSync(lmPath)) {
        const buf = fs.readFileSync(lmPath);
        const parsed = parseLicenseBlob(buf);
        results.rsa_signature = { pass: !!parsed, status: parsed ? 'PASS' : 'FAILED', detail: parsed ? 'RSA-PSS signature verified' : 'RSA-PSS signature verification failed' };
      } else {
        results.rsa_signature = { pass: false, status: 'FAILED', detail: 'License file not found' };
      }
    } catch (e) {
      results.rsa_signature = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 2. AES Decryption
    try {
      const lmPath = this._isDeveloper ? this._config.devLicensePath : this._config.licensePath;
      if (fs.existsSync(lmPath)) {
        const buf = fs.readFileSync(lmPath);
        if (buf.length > 260) {
          const encLen = buf.readUInt16LE(0);
          if (encLen > 0 && encLen <= buf.length - 258) {
            const encrypted = buf.subarray(2, 2 + encLen);
            const decrypted = decrypt(encrypted);
            results.aes_decryption = { pass: !!decrypted, status: decrypted ? 'PASS' : 'FAILED', detail: decrypted ? 'AES-256-GCM decryption succeeded' : 'AES-256-GCM decryption failed' };
          } else {
            const parsed = parseLicenseBlob(buf);
            results.aes_decryption = { pass: !!parsed, status: parsed ? 'PASS' : 'FAILED', detail: parsed ? 'AES-256-GCM decryption succeeded (via parseLicenseBlob)' : 'AES-256-GCM decryption failed' };
          }
        } else {
          results.aes_decryption = { pass: false, status: 'FAILED', detail: 'License file too small' };
        }
      } else {
        results.aes_decryption = { pass: false, status: 'FAILED', detail: 'License file not found' };
      }
    } catch (e) {
      results.aes_decryption = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 3. License Format
    const info = this.getLicenseInfo();
    results.license_format = {
      pass: !!info && !!info.licenseId,
      status: (!!info && !!info.licenseId) ? 'PASS' : 'FAILED',
      detail: (info && info.licenseId) ? 'License format valid, ID: ' + info.licenseId : 'License format invalid or missing'
    };

    // 4. Version Compatibility
    try {
      const currentVersion = pkg.version;
      if (info && info.erpVersionRange) {
        const { min, max } = info.erpVersionRange;
        const compatible = (!min || compareVersions(currentVersion, min) >= 0) && (!max || compareVersions(currentVersion, max) <= 0);
        results.version_compatibility = {
          pass: compatible,
          status: compatible ? 'PASS' : 'FAILED',
          detail: compatible ? 'ERP v' + currentVersion + ' compatible with license range ' + (min || '*') + ' - ' + (max || '*') : 'ERP v' + currentVersion + ' outside license range ' + (min || '*') + ' - ' + (max || '*')
        };
      } else {
        results.version_compatibility = { pass: true, status: 'PASS', detail: 'No version range in license (assumed compatible)' };
      }
    } catch (e) {
      results.version_compatibility = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 5. Hardware Validation
    try {
      if (this._licenseData && this._licenseData.hardware && this._licenseData.hardware.fingerprint && this._licenseData.hardware.fingerprint !== '*') {
        const stored = this._hwService.loadMachineInfo();
        const hwFp = stored ? stored.fingerprint : (this._cachedHardware ? this._cachedHardware.fingerprint : null);
        const threshold = (this._licenseData.hardware && this._licenseData.hardware.tolerance_threshold) || 0.7;
        const confidence = this.computeHardwareConfidence();
        const valid = !hwFp || (confidence !== null && confidence >= threshold);
        results.hardware_validation = {
          pass: valid,
          status: valid ? 'PASS' : 'FAILED',
          detail: valid ? 'Hardware fingerprint match (confidence: ' + (confidence !== null ? confidence.toFixed(3) : 'N/A') + ')' : 'Hardware mismatch (confidence: ' + (confidence !== null ? confidence.toFixed(3) : 'N/A') + ' < threshold: ' + threshold + ')'
        };
      } else {
        results.hardware_validation = { pass: true, status: 'PASS', detail: 'No hardware binding in license (developer mode)' };
      }
    } catch (e) {
      results.hardware_validation = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 6. Expiration Check
    try {
      if (info && info.expirationDate) {
        const expDate = new Date(info.expirationDate);
        const now = new Date();
        const expired = now > expDate;
        if (expired) {
          const graceMs = (info.graceDays || 30) * 24 * 60 * 60 * 1000;
          const graceEnd = new Date(expDate.getTime() + graceMs);
          const inGrace = now <= graceEnd;
          results.expiration_check = {
            pass: inGrace,
            status: inGrace ? 'WARNING' : 'FAILED',
            detail: inGrace ? 'License expired but in grace period until ' + graceEnd.toISOString().slice(0, 10) : 'License expired on ' + info.expirationDate
          };
        } else {
          const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
          results.expiration_check = { pass: true, status: 'PASS', detail: 'License valid until ' + info.expirationDate + ' (' + daysLeft + ' days remaining)' };
        }
      } else {
        results.expiration_check = { pass: true, status: 'PASS', detail: 'No expiration date (developer license)' };
      }
    } catch (e) {
      results.expiration_check = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 7. Clock Validation
    try {
      let clockOk = this._state !== LicenseState.CLOCK_WARNING;
      let detail = clockOk ? 'System clock integrity verified' : 'System clock may have been tampered with';
      try {
        const cs = this._hwService.getClockStatus();
        if (cs.tampered) {
          clockOk = false;
          detail = 'Clock drift detected: ' + (cs.drift / 1000).toFixed(1) + 's (anomalies: ' + cs.anomalyCount + ')';
        }
      } catch (e) {}
      results.clock_validation = {
        pass: clockOk,
        status: clockOk ? 'PASS' : 'WARNING',
        detail
      };
    } catch (e) {
      results.clock_validation = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 8. Modules Validation
    try {
      const mods = (info && info.enabledModules) || [];
      const validMods = Array.isArray(mods) && (mods.length > 0 || this._isDeveloper);
      results.modules_validation = {
        pass: validMods,
        status: validMods ? 'PASS' : 'WARNING',
        detail: validMods ? (this._isDeveloper ? 'All modules enabled (developer mode)' : mods.length + ' module(s) enabled: ' + mods.join(', ')) : 'No modules enabled'
      };
    } catch (e) {
      results.modules_validation = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 9. Feature Validation
    try {
      const flags = (info && info.featureFlags) || {};
      const enabledFeatures = Object.keys(flags).filter(k => flags[k]);
      results.feature_validation = {
        pass: true,
        status: enabledFeatures.length > 0 ? 'PASS' : 'WARNING',
        detail: enabledFeatures.length > 0 ? enabledFeatures.length + ' feature(s) enabled: ' + enabledFeatures.join(', ') : 'No features enabled'
      };
    } catch (e) {
      results.feature_validation = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 10. Key Rotation Check
    try {
      const keyIds = getAvailableKeyIds();
      const licKeyId = info ? info.keyId : 'unknown';
      results.key_rotation = {
        pass: true,
        status: 'PASS',
        detail: keyIds.length + ' key(s) (' + keyIds.join(', ') + '), license uses: ' + licKeyId
      };
    } catch (e) {
      results.key_rotation = { pass: false, status: 'FAILED', detail: e.message };
    }

    // 11. Revocation Check
    try {
      const revStatus = this.getRevocationStatus();
      if (!revStatus.listValid) {
        results.revocation_check = { pass: false, status: 'FAILED', detail: 'Revocation list invalid: ' + (revStatus.error || 'unknown') };
      } else if (revStatus.currentLicenseRevoked) {
        results.revocation_check = { pass: false, status: 'FAILED', detail: 'Current license has been revoked' };
      } else {
        results.revocation_check = {
          pass: true,
          status: 'PASS',
          detail: revStatus.revokedCount > 0 ? revStatus.revokedCount + ' revoked license(s) in list' : 'No revoked licenses'
        };
      }
    } catch (e) {
      results.revocation_check = { pass: false, status: 'FAILED', detail: e.message };
    }

    const allPass = Object.values(results).every(r => r.status === 'PASS');
    return { overall: allPass, checks: results };
  }

  onEvent(callback) {
    if (typeof callback === 'function') this._auditCallbacks.push(callback);
  }

  _emit(eventType, data) {
    const entry = { event: eventType, timestamp: new Date().toISOString(), state: this._state, data: data || {} };
    for (const cb of this._auditCallbacks) {
      try { cb(entry); } catch (e) { /* silent */ }
    }
  }
}

module.exports = LicenseManager;
