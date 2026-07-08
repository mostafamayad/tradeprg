/**
 * AnalyticsCache — in-memory TTL cache for BI endpoints.
 *
 * Reduces redundant SQL queries by caching API responses.
 * TTLs vary by data type (30s for KPIs, 60s for reports, 0s for live data).
 * Auto-cleanup every 60s removes expired entries.
 *
 * Usage:
 *   const cache = require('./analyticsCache');
 *   cache.get('my-key')        // returns cached value or null
 *   cache.set('my-key', val, 30000)  // cache for 30s
 *   cache.stats()              // { size, hits, misses, hitRate }
 *   cache.clear()              // flush all
 */
class AnalyticsCache {
    constructor() {
        this._store = new Map();
        this._hits = 0;
        this._misses = 0;
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
        if (this._cleanupInterval.unref) this._cleanupInterval.unref();
    }

    /** @param {string} key */
    get(key) {
        const entry = this._store.get(key);
        if (!entry) { this._misses++; return null; }
        if (Date.now() > entry.expiresAt) {
            this._store.delete(key);
            this._misses++;
            return null;
        }
        this._hits++;
        return entry.value;
    }

    /**
     * @param {string} key
     * @param {*} value - Serialized response object
     * @param {number} ttlMs - Time-to-live in milliseconds
     */
    set(key, value, ttlMs) {
        this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this._store) {
            if (now > entry.expiresAt) this._store.delete(key);
        }
    }

    /** @returns {{size: number, hits: number, misses: number, hitRate: string}} */
    stats() {
        const total = this._hits + this._misses;
        return {
            size: this._store.size,
            hits: this._hits,
            misses: this._misses,
            hitRate: total > 0 ? (this._hits / total * 100).toFixed(1) + '%' : '0%'
        };
    }

    clear() { this._store.clear(); }
}

module.exports = new AnalyticsCache();
