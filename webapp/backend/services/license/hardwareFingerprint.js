const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PWRSHELL_TIMEOUT = 5000;

const PWRSHELL_COMMANDS = {
  machineGuid: 'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID"',
  motherboard: 'powershell -NoProfile -Command "Get-CimInstance Win32_BaseBoard | ForEach-Object { $_.Manufacturer+\' \'+$_.Product }"',
  cpu: 'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name"',
  cpuCores: 'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty NumberOfCores"',
  cpuThreads: 'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty NumberOfLogicalProcessors"',
  diskModel: 'powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty Model"',
  diskSerial: 'powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty SerialNumber"',
  diskSize: 'powershell -NoProfile -Command "Get-CimInstance Win32_DiskDrive | Select-Object -First 1 -ExpandProperty Size"',
  bios: 'powershell -NoProfile -Command "Get-CimInstance Win32_BIOS | ForEach-Object { $_.Manufacturer+\' \'+$_.SMBIOSBIOSVersion }"',
  biosSerial: 'powershell -NoProfile -Command "Get-CimInstance Win32_BIOS | Select-Object -First 1 -ExpandProperty SerialNumber"',
  osVersion: 'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
  osInstallDate: 'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).InstallDate"',
  systemSku: 'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty SystemSKUNumber"',
  systemManufacturer: 'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Manufacturer"',
  systemModel: 'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model"',
  macAddress: 'powershell -NoProfile -Command "Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true } | Select-Object -First 1 -ExpandProperty MACAddress"',
  registryMachineGuid: 'powershell -NoProfile -Command "Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\' -Name MachineGuid | Select-Object -ExpandProperty MachineGuid"'
};

const HW_WEIGHTS_V2 = {
  machineGuid: 0.25,
  motherboard: 0.20,
  cpu: 0.15,
  diskSerial: 0.15,
  bios: 0.10,
  macAddress: 0.10,
  systemSku: 0.05
};

function safeExec(command) {
  try {
    const result = execSync(command, { encoding: 'utf8', timeout: PWRSHELL_TIMEOUT });
    const trimmed = result.trim().split(/\r?\n/).filter(l => l.trim() && !l.startsWith('-'))[0];
    return trimmed || null;
  } catch {
    return null;
  }
}

function generateFingerprint(components) {
  const sorted = {};
  Object.keys(components).sort().forEach(k => { sorted[k] = components[k]; });
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

class HardwareFingerprintService {
  constructor(options = {}) {
    const baseDir = options.storeDir || path.join(__dirname, '..', '..', 'storage');
    this.storePath = options.storePath || path.join(baseDir, '.machine_info');
    this.clockPath = options.clockPath || path.join(baseDir, '.clock_store');
  }

  collect() {
    const components = {
      machineGuid: this._getMachineGuid(),
      motherboard: this._getMotherboard(),
      cpu: this._getCpu(),
      cpuCores: this._getCpuCores(),
      cpuThreads: this._getCpuThreads(),
      diskModel: this._getDiskModel(),
      diskSerial: this._getDiskSerial(),
      diskSize: this._getDiskSize(),
      bios: this._getBios(),
      biosSerial: this._getBiosSerial(),
      macAddress: this._getMacAddress(),
      systemSku: this._getSystemSku(),
      systemManufacturer: this._getSystemManufacturer(),
      systemModel: this._getSystemModel(),
      osVersion: this._getOsVersion(),
      osInstallDate: this._getOsInstallDate(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    };

    const cleaned = {};
    for (const [key, value] of Object.entries(components)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = String(value).trim();
      }
    }

    return {
      fingerprint: generateFingerprint(cleaned),
      components: cleaned,
      collectedAt: new Date().toISOString(),
      componentCount: Object.keys(cleaned).length
    };
  }

  collectSummary() {
    const data = this.collect();
    return {
      computerName: data.components.hostname || os.hostname(),
      platform: data.components.platform || os.platform(),
      release: os.release(),
      arch: data.components.arch || os.arch(),
      cpu: data.components.cpu || '-',
      machineGuid: data.components.machineGuid || '-',
      motherboard: data.components.motherboard || '-',
      diskModel: data.components.diskModel || '-',
      diskSerial: data.components.diskSerial || '-',
      bios: data.components.bios || '-',
      osVersion: data.components.osVersion || (os.platform() + ' ' + os.release()),
      osBits: data.components.arch || os.arch(),
      macAddress: data.components.macAddress || '-',
      systemManufacturer: data.components.systemManufacturer || '-',
      systemModel: data.components.systemModel || '-',
      systemSku: data.components.systemSku || '-',
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      fingerprint: data.fingerprint,
      hardwareFingerprint: data.fingerprint,
      confidenceScore: null,
      componentCount: data.componentCount,
      collectedAt: data.collectedAt
    };
  }

  _getMachineGuid() {
    const reg = safeExec(PWRSHELL_COMMANDS.registryMachineGuid);
    if (reg) return reg;
    return safeExec(PWRSHELL_COMMANDS.machineGuid);
  }

  _getMotherboard() { return safeExec(PWRSHELL_COMMANDS.motherboard); }

  _getCpu() { return safeExec(PWRSHELL_COMMANDS.cpu); }

  _getCpuCores() {
    const val = safeExec(PWRSHELL_COMMANDS.cpuCores);
    return val ? parseInt(val, 10) : null;
  }

  _getCpuThreads() {
    const val = safeExec(PWRSHELL_COMMANDS.cpuThreads);
    return val ? parseInt(val, 10) : null;
  }

  _getDiskModel() { return safeExec(PWRSHELL_COMMANDS.diskModel); }

  _getDiskSerial() { return safeExec(PWRSHELL_COMMANDS.diskSerial); }

  _getDiskSize() { return safeExec(PWRSHELL_COMMANDS.diskSize); }

  _getBios() { return safeExec(PWRSHELL_COMMANDS.bios); }

  _getBiosSerial() { return safeExec(PWRSHELL_COMMANDS.biosSerial); }

  _getMacAddress() { return safeExec(PWRSHELL_COMMANDS.macAddress); }

  _getSystemSku() { return safeExec(PWRSHELL_COMMANDS.systemSku); }

  _getSystemManufacturer() { return safeExec(PWRSHELL_COMMANDS.systemManufacturer); }

  _getSystemModel() { return safeExec(PWRSHELL_COMMANDS.systemModel); }

  _getOsVersion() {
    const ver = safeExec(PWRSHELL_COMMANDS.osVersion);
    return ver || (os.platform() + ' ' + os.release());
  }

  _getOsInstallDate() { return safeExec(PWRSHELL_COMMANDS.osInstallDate); }

  _ensureDir() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _writeAtomic(filePath, data) {
    this._ensureDir();
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  _readJSON(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {}
    return null;
  }

  loadMachineInfo() {
    return this._readJSON(this.storePath);
  }

  saveMachineInfo(collection) {
    const existing = this.loadMachineInfo();
    const record = {
      firstSeen: (existing && existing.firstSeen) || collection.collectedAt,
      lastSeen: collection.collectedAt,
      fingerprint: collection.fingerprint,
      components: collection.components,
      componentCount: collection.componentCount,
      collectionCount: (existing && existing.collectionCount || 0) + 1
    };
    this._writeAtomic(this.storePath, record);
    return record;
  }

  detectHardwareChanges() {
    const current = this.collect();
    const stored = this.loadMachineInfo();

    if (!stored) {
      return { changed: false, isFirstCollection: true, confidence: null, current, stored: null };
    }

    const confidence = this.computeConfidence(current.components, stored.components);

    return {
      changed: confidence < 0.7,
      confidence,
      isFirstCollection: false,
      fingerprintMatch: current.fingerprint === stored.fingerprint,
      currentFingerprint: current.fingerprint,
      storedFingerprint: stored.fingerprint,
      current,
      stored
    };
  }

  computeConfidence(currentComponents, storedComponents) {
    if (!storedComponents || !currentComponents) return 0;

    let score = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(HW_WEIGHTS_V2)) {
      const cur = currentComponents[key];
      const st = storedComponents[key];
      if (cur && st && cur.toLowerCase() === st.toLowerCase()) {
        score += weight;
      }
      totalWeight += weight;
    }

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  loadClockStore() {
    return this._readJSON(this.clockPath);
  }

  saveClockEntry(reason) {
    const existing = this.loadClockStore() || { entries: [], lastVerified: null, anomalyCount: 0 };

    const entry = {
      time: new Date().toISOString(),
      timestamp: Date.now(),
      reason,
      systemUptime: os.uptime()
    };

    existing.entries.push(entry);
    if (existing.entries.length > 100) {
      existing.entries = existing.entries.slice(-100);
    }
    existing.lastVerified = entry.time;
    this._writeAtomic(this.clockPath, existing);
    return existing;
  }

  detectClockTampering() {
    const store = this.loadClockStore();
    if (!store || !store.entries || store.entries.length < 2) {
      return { tampered: false, reason: 'insufficient_data', entries: (store && store.entries) || [] };
    }

    const entries = store.entries;
    const last = entries[entries.length - 1];
    const prev = entries[entries.length - 2];

    const timeDiff = last.timestamp - prev.timestamp;
    const realTimeDiff = Date.now() - prev.timestamp;
    const drift = Math.abs(timeDiff - realTimeDiff);
    const tampered = drift > 300000;

    if (tampered) {
      store.anomalyCount = (store.anomalyCount || 0) + 1;
      this._writeAtomic(this.clockPath, store);
    }

    return {
      tampered,
      drift,
      anomalyCount: store.anomalyCount || 0,
      lastEntry: last.time,
      previousEntry: prev.time,
      expectedDiff: realTimeDiff,
      actualDiff: timeDiff
    };
  }

  getClockStatus() {
    const store = this.loadClockStore();
    const tamper = this.detectClockTampering();

    return {
      lastVerified: store ? store.lastVerified : null,
      totalEntries: store ? store.entries.length : 0,
      anomalyCount: tamper.anomalyCount,
      tampered: tamper.tampered,
      drift: tamper.drift || 0,
      isFirstEntry: !store || store.entries.length < 2
    };
  }

  getFingerprintComponents() {
    return Object.keys(HW_WEIGHTS_V2);
  }

  getWeights() {
    return { ...HW_WEIGHTS_V2 };
  }
}

module.exports = { HardwareFingerprintService, HW_WEIGHTS_V2, generateFingerprint, PWRSHELL_COMMANDS };
