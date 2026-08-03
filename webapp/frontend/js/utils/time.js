// ============================================================
// TradePro ERP - Internet Time Sync (Africa/Cairo)
// ============================================================

window.TimeSync = {
    offsetMs: 0,
    timezone: 'Africa/Cairo',
    synced: false,
    _clockTimer: null,
    _syncTimer: null,

    now() {
        return new Date(Date.now() + this.offsetMs);
    },

    todayISO() {
        const d = this.now();
        const local = d.toLocaleDateString('sv-SE', { timeZone: this.timezone });
        return local;
    },

    async sync(force = false) {
        try {
            const res = await fetch('/api/time' + (force ? '?force=1' : ''));
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Time sync failed');

            const networkMs = Number(data.unixtime) * 1000;
            if (Number.isFinite(networkMs)) {
                this.offsetMs = networkMs - Date.now();
            }
            if (data.timezone) this.timezone = data.timezone;
            this.synced = !!data.synced || !data.fallback;
        } catch (err) {
            console.warn('[TimeSync] Failed, using local clock:', err.message);
        }
    },

    renderHeader() {
        const dateEl = document.getElementById('header-date-text');
        const timeEl = document.getElementById('header-time-text');
        if (!dateEl && !timeEl) return;

        const now = this.now();
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('ar-EG', {
                timeZone: this.timezone,
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        }
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('ar-EG', {
                timeZone: this.timezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }
    },

    startClock() {
        this.renderHeader();
        if (this._clockTimer) clearInterval(this._clockTimer);
        this._clockTimer = setInterval(() => this.renderHeader(), 1000);
    },

    startAutoSync(intervalMs = 30 * 60 * 1000) {
        if (this._syncTimer) clearInterval(this._syncTimer);
        this._syncTimer = setInterval(() => this.sync(true), intervalMs);
    },

    async init() {
        await this.sync(true);
        this.startClock();
        this.startAutoSync();
    }
};

window.getAppNow = function getAppNow() {
    return window.TimeSync ? window.TimeSync.now() : new Date();
};

window.getAppToday = function getAppToday() {
    if (window.TimeSync) return window.TimeSync.todayISO();
    return new Date().toISOString().slice(0, 10);
};

window.formatLogDateTime = function formatLogDateTime(createdAt) {
    if (!createdAt) return '-';

    const tz = 'Africa/Cairo';
    const opts = {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };

    // New format: UTC ISO from server
    if (createdAt.includes('T')) {
        const dt = new Date(createdAt);
        if (!Number.isNaN(dt.getTime())) {
            return dt.toLocaleString('ar-EG', opts);
        }
    }

    // Legacy: "YYYY-MM-DD HH:mm:ss" saved as server local (often UTC+3) — convert to Cairo
    const legacy = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})/);
    if (legacy) {
        const normalized = `${legacy[1]}-${legacy[2]}-${legacy[3]}T${legacy[4]}:${legacy[5]}:${legacy[6]}+03:00`;
        const dt = new Date(normalized);
        if (!Number.isNaN(dt.getTime())) {
            return dt.toLocaleString('ar-EG', opts);
        }
    }

    return createdAt;
};
