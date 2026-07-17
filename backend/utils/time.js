const TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Cairo';
const CAIRO_OFFSET_HOURS = 2; // Egypt permanent UTC+2 (no DST since 2023)

let offsetMs = 0;
let lastSyncAt = 0;

function formatLocalDateTime(date) {
    return date.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace('T', ' ');
}

function toUtcIso(date) {
    return date.toISOString();
}

function getNow() {
    return new Date(Date.now() + offsetMs);
}

function getSnapshot() {
    const now = getNow();
    return {
        datetime: now.toISOString(),
        local: formatLocalDateTime(now),
        unixtime: Math.floor(now.getTime() / 1000),
        timezone: TIMEZONE,
        synced: lastSyncAt > 0,
        synced_at: lastSyncAt ? new Date(lastSyncAt).toISOString() : null
    };
}

function parseCairoDateTimeToUnix(dateTimeStr) {
    const m = String(dateTimeStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Math.floor(
        Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - CAIRO_OFFSET_HOURS, +m[5], +m[6]) / 1000
    );
}

async function fetchUnixTime(url, parser) {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Time API status ${response.status}`);
    const data = await response.json();
    const unixtime = parser(data);
    if (!Number.isFinite(unixtime)) throw new Error('Invalid unixtime from API');
    return unixtime;
}

async function fetchHttpDateUnixTime() {
    const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
    });
    const dateHeader = response.headers.get('date');
    if (!dateHeader) throw new Error('Missing Date header');
    const unixtime = Math.floor(new Date(dateHeader).getTime() / 1000);
    if (!Number.isFinite(unixtime)) throw new Error('Invalid Date header');
    return unixtime;
}

async function fetchInternetUnixTime() {
    const sources = [
        {
            url: `https://worldtimeapi.org/api/timezone/${TIMEZONE}`,
            parser: (data) => Number(data.unixtime)
        },
        {
            url: `https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(TIMEZONE)}`,
            parser: (data) => parseCairoDateTimeToUnix(data.dateTime)
        },
        {
            url: '__http_date__',
            parser: async () => fetchHttpDateUnixTime()
        }
    ];

    let lastError = null;
    for (const source of sources) {
        try {
            if (source.url === '__http_date__') {
                return await fetchHttpDateUnixTime();
            }
            return await fetchUnixTime(source.url, source.parser);
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('All time sources failed');
}

async function syncTime(force = false) {
    const stale = Date.now() - lastSyncAt > 30 * 60 * 1000;
    if (!force && lastSyncAt && !stale) {
        return getSnapshot();
    }

    try {
        const unixtime = await fetchInternetUnixTime();
        offsetMs = unixtime * 1000 - Date.now();
        lastSyncAt = Date.now();
        console.log(`[TIME] Synced with internet (${TIMEZONE}), offset ${offsetMs}ms`);
    } catch (err) {
        if (!lastSyncAt) {
            offsetMs = 0;
            console.warn('[TIME] Internet sync failed, using server clock:', err.message);
        } else {
            console.warn('[TIME] Re-sync failed, keeping previous offset:', err.message);
        }
    }

    return getSnapshot();
}

module.exports = {
    TIMEZONE,
    CAIRO_OFFSET_HOURS,
    syncTime,
    getNow,
    getSnapshot,
    formatLocalDateTime,
    toUtcIso
};
