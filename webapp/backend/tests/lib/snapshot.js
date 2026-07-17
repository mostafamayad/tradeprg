/**
 * Dynamic field masking for baseline snapshot comparisons.
 * Fields listed here will be compared by type only, not by value.
 */
const VOLATILE_FIELDS = new Set([
    'id', 'rep_code', 'invoice_no', 'collection_no', 'return_no',
    'created_at', 'updated_at', 'modified_at', 'last_invoice_date',
    'password_hash', 'token', 'entry_no',
    'owner_code', 'machine_fingerprint', 'hardware_fingerprint',
    '_sort'
]);

/**
 * Check if a field name is volatile (values change between runs).
 */
function isVolatile(field) {
    return VOLATILE_FIELDS.has(field);
}

/**
 * Mask volatile fields in an object, replacing values with type markers.
 * { id: 15, name: 'test' } → { id: '<number>', name: 'test' }
 */
function maskVolatile(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(maskVolatile);
    if (typeof obj !== 'object') return obj;

    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isVolatile(key)) {
            if (value === null) masked[key] = null;
            else if (Array.isArray(value)) masked[key] = '<array>';
            else masked[key] = `<${typeof value}>`;
        } else if (typeof value === 'object' && value !== null) {
            masked[key] = maskVolatile(value);
        } else {
            masked[key] = value;
        }
    }
    return masked;
}

/**
 * Extract the JSON structure (keys and types) from an object.
 * Used for structural comparison independent of values.
 */
function extractStructure(obj, depth = 0) {
    if (depth > 10) return '<max-depth>';
    if (obj === null) return null;
    if (Array.isArray(obj)) {
        if (obj.length === 0) return [];
        return [extractStructure(obj[0], depth + 1)];
    }
    if (typeof obj !== 'object') return typeof obj;

    const struct = {};
    for (const [key, value] of Object.entries(obj)) {
        struct[key] = extractStructure(value, depth + 1);
    }
    return struct;
}

/**
 * Assert that the actual structure matches the expected structure.
 * Volatile fields are checked by type only.
 */
function assertStructure(actual, expected, path = '', errors = []) {
    if (actual === null && expected === null) return;
    if (actual === null || expected === null) {
        errors.push(`${path}: expected ${expected === null ? 'null' : 'non-null'}, got ${actual === null ? 'null' : 'non-null'}`);
        return;
    }

    if (Array.isArray(expected) && Array.isArray(actual)) {
        if (expected.length > 0 && actual.length > 0) {
            assertStructure(actual[0], expected[0], `${path}[0]`, errors);
        }
        return;
    }

    if (typeof expected !== 'object' || typeof actual !== 'object') {
        const actualType = typeof actual;
        const expectedType = typeof expected;
        if (actualType !== expectedType) {
            errors.push(`${path}: expected type ${expectedType}, got ${actualType}`);
        }
        return;
    }

    const expectedKeys = new Set(Object.keys(expected));
    const actualKeys = new Set(Object.keys(actual));

    // Check for missing keys
    for (const key of expectedKeys) {
        if (!actualKeys.has(key) && !isVolatile(key)) {
            errors.push(`${path}.${key}: missing from actual response`);
        }
    }

    // Check for extra keys
    for (const key of actualKeys) {
        if (!expectedKeys.has(key)) {
            errors.push(`${path}.${key}: unexpected key in actual response`);
        }
    }

    // Recursively compare
    for (const key of expectedKeys) {
        if (!actualKeys.has(key)) continue;
        const childPath = path ? `${path}.${key}` : key;
        if (isVolatile(key)) {
            // Volatile fields: compare type only
            const actualType = Array.isArray(actual[key]) ? 'array' : typeof actual[key];
            const expectedType = Array.isArray(expected[key]) ? 'array' : typeof expected[key];
            if (actualType !== expectedType) {
                errors.push(`${childPath}: volatile field type mismatch — expected ${expectedType}, got ${actualType}`);
            }
        } else {
            assertStructure(actual[key], expected[key], childPath, errors);
        }
    }
}

module.exports = { maskVolatile, extractStructure, assertStructure, isVolatile };
