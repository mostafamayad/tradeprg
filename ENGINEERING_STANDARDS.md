# TradePro ERP — Engineering Standards

> **Version:** 1.4.0
> **Last Updated:** 2026-07-01
> **Status:** Living Standard — every architectural change increments the version.
>
> Internal engineering specification. This is a living document that every ERP module
> must follow. Updates require team review.

---

## 1. API Contract

### 1.1 Standard Success Response

Every successful API response MUST use this envelope:

```json
{
  "success": true,
  "data": [ ... ]
}
```

- `data` MUST be present (array or object).
- Additional top-level keys (e.g. `pagination`, `message`, `id`) are permitted beside `success` and `data`.

### 1.2 Standard Error Response

Every error response MUST use this envelope:

```json
{
  "success": false,
  "message": "وصف الخطأ بالعربية"
}
```

- `message` MUST be in Arabic for user-facing errors.
- Do NOT include `data` in error responses.

### 1.3 HTTP Status Code Usage

| Code | Usage |
|------|-------|
| `200` | Successful read / write |
| `201` | Resource created (POST) |
| `400` | Validation error (missing field, out of range, etc.) |
| `401` | Missing or invalid authentication token |
| `403` | Authenticated but insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict (duplicate unique value) |
| `500` | Unexpected server error (never leak details) |

### 1.4 Pagination Format

Request:

```
GET /api/.../manage?page=2&limit=25
```

Response:

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 2,
    "limit": 25,
    "total": 187,
    "pages": 8
  }
}
```

- `page` defaults to 1 when absent.
- `limit` defaults to 0 (no pagination, return all) when absent.
- When `limit` is 0 or absent, the `pagination` block MUST be omitted.
- `limit` is clamped to `[1, 200]` when provided.
- Invalid or negative `limit` values (including 0) are treated as "no pagination."
- The `pagination` block MUST be present whenever `limit > 0`.

### 1.5 Search / Filter / Sort Conventions

Search:

```
?q=<term>
```

- Searches across `rep_code`, `rep_name`, `phone` (or equivalent fields per module).
- Uses `LIKE %term%` with parameterized binding.
- The term is user-supplied; MUST be parameterized, never interpolated raw.

Filters:

```
?status=1
?region=القاهرة
```

- Each filter is a dedicated query parameter.
- Filters use equality comparison (`=`), not `LIKE`, unless explicitly required.

Sort:

```
?sort=rep_name&order=ASC
```

- `order` defaults to `ASC`; accept only `ASC` or `DESC`.
- `sort` value MUST be validated against a **column whitelist** (see §2.7).
- Invalid `sort` values MUST fall back to the default sort column.

Combined:

```
GET /api/.../manage?q=أحمد&status=1&region=القاهرة&sort=target_amount&order=DESC&page=1&limit=25
```

### 1.6 Validation Response Format

```json
{
  "success": false,
  "message": "اسم الحقل مطلوب | يجب أن يكون 0 أو أكثر | نسبة العمولة يجب أن تكون بين 0 و 100"
}
```

- Only the **first** validation error is returned as `message`.
- Validation errors return HTTP `400`.
- Validation MUST occur **before** any database operation.

---

## 2. Backend Standards

### 2.1 Route Ordering

Routes in each module file MUST be declared in this order to prevent Express from
treating a named segment (e.g. `manage`) as an `:id` parameter:

1. **Static collection routes** — `GET /manage`, `GET /active`, etc.
2. **Collection route** — `GET /`
3. **Resource routes** — `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
4. **Action routes** — `PUT /:id/toggle`, `POST /:id/action`, etc.

### 2.2 Middleware Order

Module registration in `server.js`:

```javascript
app.use('/api/:module', authenticate, autoLogger, licenseEnforcer, applyPermissions(':module'), require('./routes/:module'));
```

1. `authenticate` — JWT verification, sets `req.user`
2. `autoLogger` — wraps `res.json` for generic audit (module captured at middleware time, before Express strips mount prefix)
3. `licenseEnforcer` — license state check
4. `applyPermissions(':module')` — role-based access control
5. Route handler

### 2.3 Permission Enforcement

```javascript
app.use('/api/reps', applyPermissions('reps'), require('./routes/reps'));
```

- `applyPermissions` checks `{module}.{action}` where action is derived from HTTP method:
  - `GET` → `view`
  - `POST` → `create`
  - `PUT` / `PATCH` → `update`
  - `DELETE` → `delete`
- Permissions MUST be defined in `permissions.js`.
- Every business route MUST be protected; no unauthenticated endpoints except `/auth/*` and `/license/*`.

### 2.4 Validation Rules

Validation MUST be implemented as a reusable function scoped to the module file.

```javascript
function validateRepInput(body) {
    const errors = [];
    const rep_name = body.rep_name !== undefined && body.rep_name !== null
                     ? String(body.rep_name).trim() : undefined;

    if (!rep_name) errors.push('اسم المندوب مطلوب');

    const target_amount = body.target_amount !== undefined && body.target_amount !== null && body.target_amount !== ''
                          ? Number(body.target_amount) : 0;
    if (isNaN(target_amount) || target_amount < 0)
        errors.push('الهدف يجب أن يكون 0 أو أكثر');

    const commission_rate = body.commission_rate !== undefined && body.commission_rate !== null && body.commission_rate !== ''
                            ? Number(body.commission_rate) : 0;
    if (isNaN(commission_rate) || commission_rate < 0 || commission_rate > 100)
        errors.push('نسبة العمولة يجب أن تكون بين 0 و 100');

    return {
        errors,
        rep_code: body.rep_code !== undefined && body.rep_code !== null ? String(body.rep_code).trim() : undefined,
        rep_name, phone, region, target_amount, commission_rate
    };
}
```

#### Rules per field type:

| Type | Rules |
|------|-------|
| Strings (`rep_name`, `phone`, `region`) | Trim before validation; reject blank/whitespace-only for required fields |
| Numeric (`target_amount`, `commission_rate`) | Default to 0 if absent/empty; reject `NaN`; enforce range |
| Required fields | Return 400 immediately; check before any DB operation |
| Optional fields | Default to `null` if absent |

### 2.5 SQL Conventions

- **Every** query MUST use parameterized inputs (`@param`). No string interpolation for values.
- Use `request.input('name', sql.Type, value)` for all bindings.
- Use `sql.NVarChar` for strings, `sql.Int` for integers, `sql.Decimal(precision, scale)` for decimals.
- Use `OUTPUT INSERTED.id` for INSERT operations that need the new record ID.
- Use `sql.Transaction` for multi-step writes (e.g. POST with auto-generated code).
- No `SELECT *` in management or production queries — always specify the column list.

### 2.6 Explicit Column Selection

- `GET /manage` and `GET /:id`  MUST list columns explicitly.
- Exception: `GET /` (operational dropdown) may use `SELECT *` only when all columns are consumed by the frontend and the table schema is stable.
- The column list in `GET /manage` defines the public API contract; adding/removing columns is a breaking change.

### 2.7 Sort Whitelist Policy

```javascript
const SORT_WHITELIST = ['rep_name', 'rep_code', 'region', 'commission_rate', 'target_amount', 'is_active'];
let orderBy = 'rep_name'; // default
if (req.query.sort && SORT_WHITELIST.includes(req.query.sort)) {
    orderBy = req.query.sort;
}
const orderDir = req.query.order === 'DESC' ? 'DESC' : 'ASC';
```

- Every module with sort MUST define a whitelist.
- Only whitelisted column names are allowed; invalid values silently fall back to the default.
- `order` accepts only `ASC` or `DESC`; any other value defaults to `ASC`.
- This prevents SQL injection through sort parameters.

### 2.8 Database Connection Resilience

All database operations MUST go through the resilient connection layer in `database/mssql_db.js`.

**Startup retry policy (exponential backoff):**

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 (immediate) | 0s | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| 6 | 16s | 31s |

If all 6 attempts fail:
- The server enters **DEGRADED mode**.
- A background reconnect loop runs every **30 seconds**.
- `getPool()` throws a meaningful error; route handlers return `500` instead of crashing.
- The server continues serving non‑DB routes (e.g. static files, health check).

**Health endpoint:**

A public `GET /health` endpoint returns:

```json
{
  "status": "UP | DEGRADED",
  "database": "UP | DOWN",
  "degraded": false,
  "retryCount": 0,
  "lastError": null,
  "uptime": 1234,
  "version": "1.0.0",
  "timestamp": "2026-07-01T12:00:00.000Z"
}
```

- `GET /health` requires NO authentication and NO database access.
- It MUST be registered before the `authenticate` middleware.
- The response is derived from a shared in‑memory health state, never from a DB query.

**Reconnect loop:**
- Single instance (no race conditions).
- Creates a new pool; on success, replaces the global pool reference and clears the timer.
- Uses `timer.unref()` so it doesn't prevent graceful process shutdown.

**What is NOT allowed:**
- Calling `process.exit(1)` on DB connection failure.
- Multiple concurrent reconnect attempts.
- Creating more than one pool.
- Every request trying to re‑establish the pool.

### 2.9 Rate Limiting

Tiered rate limiting is implemented via `express-rate-limit` (v8) in `server.js`.

| Tier | Routes | Limit | Scope |
|------|--------|-------|-------|
| **Login** | `/api/auth/login` | 5 failed attempts/minute/IP | `skipSuccessfulRequests: true` — only failed logins count |
| **General API** | All `/api/*` routes | 300 requests/minute/IP | Protects backend resources |
| **Unlimited** | `/health`, static assets | No limit | Must never be throttled |

**Custom 429 response:**

```json
{
  "success": false,
  "message": "Too many requests",
  "retryAfter": 60
}
```

- HTTP status `429 Too Many Requests`.
- `Retry-After: 60` header is set.
- The default library message MUST NOT be used — always override `handler` and `message`.
- Rate‑limited requests are NOT written to `audit_log`. An internal counter and console warning are sufficient.

**Proxy awareness:**

```javascript
app.set('trust proxy', 1); // set before all middleware
```

This ensures `req.ip` reflects the client IP behind IIS, Nginx, or any reverse proxy.

**Middleware order:**

1. `app.set('trust proxy', 1)`
2. General middleware (helmet, cors, morgan, json)
3. Health endpoint + static files (unlimited)
4. **Login limiter** at `/api/auth/login` (5/min, registered before general API limiter)
5. **General API limiter** at `/api` (300/min)
6. `authenticate` + `autoLogger` + `licenseEnforcer`
7. Module routes

The login limiter takes precedence over the general API limiter because it is registered first with a more specific path.

---

## 3. Audit Standards

### 3.1 Event Lifecycle

```
Request → authenticate → autoLogger (wrap res.json) → licenseEnforcer → applyPermissions → route handler
                                                                                              │
                                                                          ┌───────────────────┤
                                                                          │                   │
                                                                     validation          DB operation
                                                                     error (400)              │
                                                                          │               transaction
                                                                          │                   │
                                                                          │               commit / rollback
                                                                          │                   │
                                                                          │            logActivity() ←─ explicit audit
                                                                          │                   │
                                                                          │               res.json()
                                                                          │                   │
                                                                          │          autoLogger ←─ generic audit
                                                                          │                   │
                                                                          │              response sent
```

### 3.2 Success-Only Logging

- Audit entries are created ONLY for successful operations.
- Validation errors (400), authentication failures (401), permission denials (403), not-found (404), conflict (409), and server errors (500) MUST NOT produce audit entries.
- The autoLogger creates generic entries for all successful non-GET requests. Module-specific `logActivity()` calls create rich entries with field-level diffs.

### 3.3 Transaction Ordering

```javascript
// CORRECT — audit after commit
await transaction.commit();
logActivity(req, 'CREATE', 'reps', refNo, affectedRecord, null, newValues, 'SUCCESS', null);
res.status(201).json({ ... });

// CORRECT — audit after update query
await pool.request().query('UPDATE ...');
logActivity(req, 'UPDATE', 'reps', null, affectedRecord, oldValues, newValues, 'SUCCESS', null);
res.json({ ... });

// WRONG — audit would be orphaned if transaction rolls back
logActivity(req, ...);   // ← never here before commit
await transaction.commit();
```

### 3.4 Module Naming Convention

```javascript
logActivity(req, 'CREATE', 'reps', ...)
```

- The module name MUST match the URL path segment (e.g. `reps` for `/api/reps/*`, `products` for `/api/products/*`).
- Module names are lowercase, singular, ASCII.
- No module map or alias translation is necessary — the autoLogger derives it from the original URL segment.

### 3.5 Field-Level Diff Format

For UPDATE operations, compute the diff before executing the query:

```javascript
const oldRep = existing.recordset[0];
const oldValues = {};
const newValues = {};
if (oldRep.rep_name !== rep_name) { oldValues.rep_name = oldRep.rep_name; newValues.rep_name = rep_name; }
if (Number(oldRep.target_amount) !== Number(target_amount || 0)) { oldValues.target_amount = oldRep.target_amount; newValues.target_amount = Number(target_amount || 0); }

logActivity(req, 'UPDATE', 'reps', null, `تم تحديث ...`,
    Object.keys(oldValues).length ? oldValues : null,
    Object.keys(newValues).length ? newValues : null,
    'SUCCESS', null);
```

- Only **changed** fields appear in `oldValues` / `newValues`.
- When no field changed, both `oldValues` and `newValues` are `null`.
- The comparison uses the raw `req.body` values against the pre-update DB snapshot.
- TOGGLE operations (boolean flip) diff only the `is_active` field.

### 3.6 Required Audit Fields

| Field | Source | Example |
|-------|--------|---------|
| `user_id` | `req.user.id` | `1` |
| `user_name` | `req.user.full_name` | `أحمد علي` |
| `role` | `req.user.role` | `admin` |
| `module` | Hardcoded per route file | `reps` |
| `operation` | See §3.7 | `CREATE` |
| `ref_no` | Business identifier | `R-0001` |
| `affected_record` | Arabic description | `تم إنشاء المندوب أحمد` |
| `old_values` | Pre-update snapshot (null for CREATE) | `{"rep_name":"قديم"}` |
| `new_values` | Post-update values | `{"rep_name":"جديد"}` |
| `ip_address` | `req.ip` | `192.168.1.1` |
| `device` | `req.headers['user-agent']` | `Mozilla/5.0 ...` |
| `status` | Always `SUCCESS` | `SUCCESS` |
| `reason` | Always `null` for success | `null` |
| `created_at` | Server timestamp | `2026-07-01T12:00:00.000Z` |

### 3.7 Action Naming Convention

| HTTP Method | Route | logActivity `operation` |
|------------|-------|------------------------|
| `POST` | `/:id` | `CREATE` |
| `PUT` | `/:id` | `UPDATE` |
| `PUT` | `/:id/toggle` (0→1) | `ACTIVATE` |
| `PUT` | `/:id/toggle` (1→0) | `DEACTIVATE` |
| `DELETE` | `/:id` | `DELETE` |

- Use active, past-tense English verbs.
- Module-specific actions (e.g. `ACTIVATE`, `DEACTIVATE`, `APPROVE`, `REJECT`, `CLOSE`) are preferred over generic `UPDATE` when the business operation has a semantic name.

---

## 4. Frontend Standards

### 4.1 API Wrapper Usage

```javascript
// All API calls go through window.API
const data = await window.API.getManageReps({ q: searchTerm, page: 1, limit: 25 });
```

- Never use `fetch()` directly — always use the `window.API` wrapper.
- The wrapper handles: token injection, `401` → logout, `402` → license activation, error alerting.
- The `options.silent` flag suppresses the error alert for background operations.

### 4.2 CRUD Flow

```
Load → render table → user clicks "Add" → modal opens (empty form)
                                           user submits → API.create() → close modal → reload list

User clicks "Edit" → modal opens (pre-filled) → user submits → API.update() → close modal → reload list

User clicks "Toggle" → confirm dialog → API.toggle() → reload list
```

- The modal MUST be reused for both create and edit (distinguished by presence of `id`).
- On create, the modal form is reset to defaults.
- On edit, the modal is pre-filled from the in-memory `repsData` array (no extra API call).
- After any mutation, `loadReps()` is called to refresh the table.

### 4.3 Modal Lifecycle

1. Open: add `open` class to modal overlay
2. Fill/prefill form fields
3. User submits → validate on frontend → call API
4. On success: hide modal, reload list
5. On error: show error message (API wrapper handles this automatically via `alert()`)
6. Close: remove `open` class

### 4.4 Loading State

```javascript
tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px">' +
    '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحميل...</td></tr>';
```

- Show a spinner row whenever an API call is in flight.
- Replace the spinner with data or the empty state when the call completes.

### 4.5 Empty State

```javascript
tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#6b7280">' +
    'لا توجد نتائج</td></tr>';
```

- Shown when the API returns `data: []`.
- `colspan` MUST match the number of table columns.
- Distinct from the loading state (spinner → empty vs spinner → data).

### 4.6 Debounced Search

```javascript
let repSearchTimer = null;

$('rep-search')?.addEventListener('input', function () {
    clearTimeout(repSearchTimer);
    repSearchTimer = setTimeout(() => {
        repFilters.q = this.value.trim();
        repFilters.page = 1;
        loadReps();
    }, 400); // 300–500ms delay
});
```

- Always debounce search input to reduce API calls.
- Reset page to 1 when search term changes.
- Trim the search value before passing to API.

### 4.7 Pagination Behavior

```javascript
function renderRepPagination() {
    if (!repPagination || repPagination.pages <= 1) {
        paginationEl.style.display = 'none';
        return;
    }
    paginationEl.style.display = 'flex';
    pageInfo.textContent = 'الصفحة ' + p.page + ' من ' + p.pages;
    prevBtn.disabled = p.page <= 1;
    nextBtn.disabled = p.page >= p.pages;
}
```

- Hide pagination when total pages <= 1.
- Disable prev/next buttons at boundaries instead of hiding them.
- Show "الصفحة X من Y" as page indicator.

### 4.8 Error Handling Pattern

```javascript
try {
    const result = await window.API.someMethod();
    // success path
} catch (e) {
    console.error('operation error', e);
    // The API wrapper already shows an alert; no additional UI needed
}
```

- The API wrapper handles user-facing error alerts.
- Route handlers should catch errors and log them for debugging.
- Do NOT show technical details to users.

---

## 5. Regression Checklist

Every module MUST pass this checklist before merging.

### 5.1 CRUD

- [ ] POST creates a new record and returns `201` with `id`
- [ ] GET `/:id` returns the created record with all expected columns
- [ ] PUT `/:id` updates the record and returns `200`
- [ ] PUT `/:id/toggle` (or equivalent status action) works both ways
- [ ] DELETE `/:id` (if applicable) removes the record

### 5.2 Validation

- [ ] Missing required field → `400`
- [ ] Whitespace-only required field → `400`
- [ ] Negative numeric → `400`
- [ ] Out-of-range numeric → `400`
- [ ] Duplicate unique value → `409`
- [ ] Non-existent `:id` → `404`

### 5.3 Search / Filter / Sort / Pagination

- [ ] `?q=` returns matching results (substring match)
- [ ] `?q=` with no match returns empty array
- [ ] `?status=` filter returns only matching records
- [ ] `?region=` filter returns only matching records
- [ ] `?sort=` with whitelisted column changes sort order
- [ ] `?sort=` with invalid column falls back to default
- [ ] `?order=DESC` reverses ASC order
- [ ] `?page=1&limit=N` returns ≤ N records with pagination block
- [ ] `?page=999&limit=N` returns empty array
- [ ] No pagination params returns all records without pagination block
- [ ] Combined `?q=&status=&sort=&page=&limit=` works together

### 5.4 Audit

- [ ] POST → audit entry with `operation: 'CREATE'`, `old_values: null`, `new_values: {...}`
- [ ] PUT → audit entry with `operation: 'UPDATE'`, `old_values: {...}`, `new_values: {...}`
- [ ] Toggle ON → `operation: 'ACTIVATE'`, only `is_active` in diff
- [ ] Toggle OFF → `operation: 'DEACTIVATE'`, only `is_active` in diff
- [ ] Validation error → no audit entry
- [ ] Not found → no audit entry
- [ ] Duplicate conflict → no audit entry
- [ ] Module name in audit matches URL segment
- [ ] `ref_no` populated with business identifier where applicable

### 5.5 Security

- [ ] Unauthenticated request → `401`
- [ ] Authenticated without permission → `403`
- [ ] All SQL queries use parameterized inputs
- [ ] Sort column validated against whitelist
- [ ] No raw string interpolation in SQL

### 5.6 Frontend (if applicable)

- [ ] Tab loads and displays data
- [ ] Add modal opens with empty form
- [ ] Edit modal opens pre-filled
- [ ] Submit creates/updates correctly
- [ ] Toggle with confirm works
- [ ] Search debounces and updates results
- [ ] Filters update results on change
- [ ] Pagination controls work (prev/next)
- [ ] Loading state shown during API call
- [ ] Empty state shown when no results
- [ ] No console errors

---

## 6. Module Completion Checklist

Use this checklist to determine when a module is production-ready.

### 6.1 API Layer

- [ ] All CRUD endpoints implemented
- [ ] Static route before parameterized route (`GET /manage` before `GET /:id`)
- [ ] Middleware chain: `authenticate → autoLogger → licenseEnforcer → applyPermissions`
- [ ] Permission entries defined in `permissions.js`
- [ ] Route registered in `server.js` with `applyPermissions`
- [ ] Validation function with all field rules
- [ ] Search (`?q=`) on relevant text fields
- [ ] Status/type filters (`?status=`, etc.)
- [ ] Sort with whitelist (`?sort=&order=`)
- [ ] Pagination (`?page=&limit=`) with pagination response block
- [ ] Backward compatible: no params = return all

### 6.2 Audit Layer

- [ ] `logActivity` imported and called in every mutation handler
- [ ] `CREATE` — `old_values: null`, `new_values: full record`
- [ ] `UPDATE` — field-level diff (only changed fields)
- [ ] Semantic operations (`ACTIVATE`, `DEACTIVATE`, etc.) used where applicable
- [ ] Audit AFTER transaction commit (never before)
- [ ] No audit on error paths (400, 404, 409, 500)
- [ ] Module name in audit calls matches URL segment

### 6.3 Frontend Layer (if applicable)

- [ ] Tab/button in appropriate settings or navigation panel
- [ ] Table renders all columns with proper formatting
- [ ] Add modal with complete form
- [ ] Edit modal pre-filled from existing data
- [ ] Toggle/status action with confirmation dialog
- [ ] Search with debounce (300–500ms)
- [ ] Filter dropdowns populated from data
- [ ] Pagination with prev/next + page info
- [ ] Loading state (spinner)
- [ ] Empty state ("لا توجد نتائج")
- [ ] Error state (handled by API wrapper)
- [ ] Form submit creates/updates and reloads list

### 6.4 Verification

- [ ] All regression checklist items pass
- [ ] No console errors
- [ ] Response format matches API contract (§1)
- [ ] Audit entries created correctly for all mutation types
- [ ] No SQL injection vectors
- [ ] Backward compatible: existing consumers (dropdowns, reports, invoices) unaffected

---

## 7. Database Migration Standards

### 7.1 Forward-Only Migrations

- All schema changes MUST be forward-only. Never alter or delete a committed migration.
- A migration file, once merged, is immutable. Corrections require a new migration.

### 7.2 File Naming Convention

```
YYYYMMDD_HHMMSS_description.sql
```

Example:

```
20260701_120000_create_sales_reps.sql
20260701_140000_add_rep_code_unique.sql
```

- Timestamps ensure chronological ordering.
- The description is lowercase, underscore-separated, maximum 60 characters.

### 7.3 Migration Structure

```sql
-- ============================================================
-- Migration ID: 20260701_120000
-- Description:  Create sales_reps table
-- Author:       [name]
-- ============================================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sales_reps]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[sales_reps] (
        [id]               [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [rep_code]         [nvarchar](50) NULL,
        [rep_name]         [nvarchar](200) NOT NULL,
        [phone]            [nvarchar](50) NULL,
        [region]           [nvarchar](200) NULL,
        [target_amount]    [decimal](18,4) DEFAULT ((0)),
        [commission_rate]  [decimal](18,4) DEFAULT ((0)),
        [is_active]        [int] DEFAULT ((1))
    );
END
```

### 7.4 Idempotent Scripts

- Every migration MUST be idempotent: running it multiple times produces the same result.
- Use `IF NOT EXISTS` / `IF EXISTS` guards for all DDL statements.
- Do NOT use `DROP` + `CREATE` — this destroys existing data.

```sql
-- Idempotent column add
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('sales_reps') AND name = 'new_column')
BEGIN
    ALTER TABLE sales_reps ADD new_column [nvarchar](100) NULL;
END
```

### 7.5 Rollback Policy

- Rollbacks are **not** supported via migration files.
- To revert a change, create a new forward-only migration that reverses the logic.
- Exception: during active development on a feature branch, uncommitted migrations may be
  dropped and recreated. Once merged to a shared branch, they are frozen.

### 7.6 Seed-Data Policy

- Static reference data (status codes, lookup tables, default permissions) may be seeded
  in migration files, wrapped in idempotent guards.
- Transactional seed data (test records, demo data) MUST NOT appear in migrations.
- Production seed scripts live in a separate `scripts/seed.js` or equivalent.

### 7.7 Versioned File-Naming Convention (Implementation)

The `migrationRunner.js` reads `.sql` files sorted alphabetically by filename.
Each file is named with a numeric prefix for ordering:

```
NNN_description.sql
```

Examples:

```
001_customers_schema.sql
002_customer_tables.sql
003_sales_returns_index.sql
```

- Numbers are zero-padded to 3+ digits (e.g., `001`, `002`, ..., `999`).
- The description is lowercase, underscore-separated.
- Files live under `backend/migrations/`.

### 7.8 schema_versions Table

Maintained automatically by the migration runner:

```sql
CREATE TABLE [dbo].[schema_versions] (
    [version]     [int] IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [name]        [nvarchar](255) NOT NULL,
    [applied_at]  [datetime2] NOT NULL DEFAULT (SYSDATETIME()),
    [duration_ms] [int] NOT NULL DEFAULT (0),
    [checksum]    [nvarchar](64) NOT NULL
);
```

- `version` — auto‑incrementing PK.
- `name` — migration filename (e.g., `001_customers_schema.sql`).
- `applied_at` — timestamp when the migration completed.
- `duration_ms` — execution time in milliseconds.
- `checksum` — SHA256 hex digest of the SQL file content (64 characters).

### 7.9 Migration Runner Behavior

- On application startup, `migrationRunner.js` is invoked after the database pool is
  established but before the HTTP server listens.
- It lists `migrations/*.sql`, compares filenames against `schema_versions.name`,
  and runs any not yet recorded.
- Each migration is executed **inside a database transaction**. If the SQL file
  contains `GO` batch separators, it is treated as non‑transactional and executed
  without a wrapping transaction.
- After successful execution, the `schema_versions` row is inserted.
- If a migration fails, the transaction is rolled back and no record is written.
- The runner is **idempotent**: consecutive runs with no new files produce zero migrations.
- A SHA256 checksum is computed for each file and stored; a checksum mismatch on
  a previously applied migration logs a warning but does not block execution.

---

## 8. Performance Standards

### 8.1 Measurable Targets

| Operation | Target | Degradation Threshold |
|-----------|--------|-----------------------|
| Single-record CRUD (GET/POST/PUT by `:id`) | `< 300 ms` | `> 500 ms` |
| List with search/filter/sort/pagination | `< 500 ms` | `> 1 s` |
| Dashboard aggregate queries | `< 1 s` | `> 2 s` |
| Full export (Excel / Print) | `< 3 s` for ≤ 10k rows | `> 5 s` |

Measure from the route handler entering the `try` block to `res.json()` call.
Network latency and authentication are excluded.

### 8.2 Pagination Requirement

- Any endpoint returning a list with potential for > 200 records MUST support pagination.
- Management/list views MUST default to a reasonable page size (e.g. 25).
- The frontend MUST NOT render unbounded lists.

### 8.3 SQL Performance Guidelines

- **No `SELECT *`** in production queries — always specify the column list.
  Exception: `SELECT *` is permitted only in operational dropdown endpoints that consume
  all columns and have a stable schema (see §2.6).
- **Indexing requirements**:
  - Primary key indexes are automatic (`IDENTITY` + `PRIMARY KEY`).
  - Add indexes for all columns used in `WHERE`, `ORDER BY`, `JOIN`, and `LIKE` lead columns:

    ```sql
    CREATE NONCLUSTERED INDEX IX_sales_reps_rep_name ON sales_reps (rep_name);
    CREATE NONCLUSTERED INDEX IX_sales_reps_is_active ON sales_reps (is_active) WHERE is_active = 1;
    CREATE NONCLUSTERED INDEX IX_sales_reps_region ON sales_reps (region);
    ```

  - Use filtered indexes for boolean/flag columns (`WHERE is_active = 1`).
  - Avoid over-indexing: no more than 5 non-clustered indexes per table unless justified.
  - **Composite index discipline**: Composite indexes (multi-column) MUST only be added after a specific query pattern is confirmed by an execution plan. Never add composite indexes proactively without a proven JOIN + filter pattern. The index key order MUST match the query predicate order (equality columns first, then range/filter columns).
- **N+1 query prohibition**:
  - Never fetch related data in a loop. Use `JOIN`, subqueries, or batch loading instead.
  - Code review MUST flag any `for`/`forEach` containing an `await` to the database.
- **Use `OUTPUT INSERTED.id`** instead of a separate `SELECT SCOPE_IDENTITY()` after INSERT.
- **Parameterized queries** (see §2.5) also improve query plan caching.

### 8.4 Connection Management

- Use a connection pool (mssql connection pool). Never open/close connections manually.
- Pool size: min 2, max 10 (configurable via environment variable).
- Queries MUST complete within 30 seconds; longer operations (exports, reports) should use
  streaming or background jobs.

---

## 9. Security Standards

### 9.1 Authentication Flow

```
Login form → POST /api/auth/login → JWT issued (expires in configurable TTL)
                                         ↓
Each request → Authorization header: Bearer <token>
                  ↓
           authenticate middleware:
           1. Verify JWT signature
           2. Check expiry (iat, exp)
           3. Attach user to req.user
           4. Call next() or 401
```

- JWT secret MUST be in environment variables (`.env`), never in code.
- Default token TTL: 24 hours.
- Passwords are hashed with `bcryptjs` (cost factor ≥ 10).
- Logout: client-side token removal only (no server-side session).

### 9.2 Authorization Model

```
Role-based access control (RBAC):

User → roles → { module.action: true/false }

Module: reps, products, customers, sales, ...
Action: view, create, update, delete
```

- Permissions are defined as strings: `module.action` (e.g. `reps.create`).
- The middleware `applyPermissions(moduleName)` derives the action from the HTTP method:

  | Method | Action |
  |--------|--------|
  | `GET` | `view` |
  | `POST` | `create` |
  | `PUT` / `PATCH` | `update` |
  | `DELETE` | `delete` |

- Permissions are loaded into `req.user.permissions` at login; middleware checks
  `permissions.includes('reps.update')` without a DB query on every request.

### 9.3 Permission Naming Convention

```
{module}.{action}

Examples:
  reps.view
  reps.create
  reps.update
  reps.delete
  reports.invoice.view
  settings.company.update
```

- Module names are lowercase, singular, ASCII.
- Action names are lowercase verbs: `view`, `create`, `update`, `delete`.
- Legacy groupings (e.g. `reps.view` under the `settings` key in `permissions.js`) are
  permitted for backward compatibility but deprecated for new modules.

### 9.4 SQL Injection Prevention

- **All** queries MUST use parameterized inputs (`@param` + `request.input(...)`).
- **Never** concatenate user input into SQL strings. Exceptions:
  - Column names in `ORDER BY` — validated against a whitelist only (§2.7).
  - Schema/table names — use a whitelist or lookup table, NEVER raw input.
- The `LIKE` pattern value (`'%' + q + '%'`) is passed as a parameter, not concatenated:

  ```javascript
  // CORRECT
  request.input('q', sql.NVarChar(200), `%${req.query.q}%`);
  sql_query += ' AND name LIKE @q';

  // WRONG — SQL injection
  sql_query += ` AND name LIKE '%${req.query.q}%'`;
  ```

### 9.5 XSS Prevention

- All user-supplied data displayed in the frontend is rendered via `.textContent` or
  framework-safe templating. When using `.innerHTML`, all values are cast to safe types
  (strings, numbers) — never raw HTML from the server.
- The backend does NOT store HTML in string fields.
- JSON responses from the API set `Content-Type: application/json` (not `text/html`).

### 9.6 CSRF Policy

- The API uses stateless JWT authentication; CSRF tokens are NOT required.
- `Authorization: Bearer <token>` headers prevent cross-origin form submissions
  (browsers do not send custom headers cross-origin without CORS preflight).
- CORS is configured to allow only the application's own origin.

### 9.7 Input Sanitization

- Trim all string inputs in the validation layer (§2.4).
- Reject whitespace-only values for required fields.
- Numeric fields must parse to valid numbers before DB insertion.
- Do NOT rely on client-side validation alone — backend is the authoritative gate.

### 9.8 Output Encoding

- The Express JSON serializer handles encoding. No manual escaping is needed for JSON responses.
- File downloads (Excel, PDF) set appropriate `Content-Disposition` headers.
- Error messages are user-facing Arabic strings — never leak stack traces, SQL errors, or
  internal paths.

### 9.9 Secrets Management

- All secrets live in `backend/.env`:
  - `JWT_SECRET`
  - `DB_*` connection strings
  - External API keys
- `.env` is in `.gitignore` and MUST never be committed.
- A `.env.example` file documents required variables with placeholder values, committed
  to the repository.

### 9.10 Logging Restrictions

Audit logs MUST NOT contain:

- Passwords (any field named `password`, `old_password`, `new_password`)
- Authentication tokens (`token`, `access_token`, `refresh_token`)
- Secrets or API keys

The autoLogger already strips these fields before writing:

```javascript
delete safeBody.password;
delete safeBody.old_password;
delete safeBody.new_password;
delete safeBody.token;
```

This list MUST be extended when new sensitive fields are introduced.

---

## 10. Testing Standards

### 10.1 Test Categories

| Category | Tool | Scope | Required Before Merge? |
|----------|------|-------|------------------------|
| **Unit Tests** | `mocha` / `jest` | Individual functions: validation, formatting, business logic | Yes |
| **Integration Tests** | `mocha` + `http` | API endpoints against real or in-memory database | Yes |
| **Regression Tests** | `mocha` | Full endpoint suite comparing response shape, status codes | Yes |
| **Performance Tests** | `autocannon` / `k6` | Response time under load (see §8.1) | For high-traffic endpoints only |
| **Security Tests** | Manual + `zap` | SQL injection attempts, permission bypass, auth bypass | One-time per module |
| **Acceptance Tests** | Manual + checklist | §5 Regression Checklist + §6 Module Completion Checklist | Yes |

### 10.2 Test File Convention

```
backend/tests/module_<name>_test.js
backend/tests/module_<name>_integration.js
backend/tests/module_<name>_perf.js       (if applicable)
```

- Tests live in `backend/tests/` or at the project root.
- Test filenames are lowercase, underscore-separated.
- Each test file starts with a comment describing what it covers.

### 10.3 Integration Test Pattern

```javascript
const http = require('http');

function req(method, path, body, token) {
    return new Promise(resolve => {
        const data = body ? JSON.stringify(body) : '';
        const opts = {
            hostname: 'localhost', port: 3000, path, method,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        const r = http.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
        });
        r.write(data); r.end();
    });
}
```

- Tests run against a running server instance (localhost:3000).
- Tests MUST clean up test data after execution (DELETE inserted records).
- Use `process.exit(failCount > 0 ? 1 : 0)` for CI-compatible exit codes.

### 10.4 What Each Category Must Cover

**Unit Tests:**
- Validation function: each field rule tested (valid, invalid, boundary, missing)
- Diff computation: changed fields only, no change = no diff
- Business logic functions in isolation

**Integration Tests (per endpoint):**
- Successful request → expected status + body shape
- Missing required field → 400
- Non-existent resource → 404
- Duplicate value → 409
- With valid auth token → 200/201
- Without auth token → 401

**Regression Tests:**
- All endpoints return expected status codes (list created in §5)
- Response body keys match expected schema
- Audit entries created (check count, operation, module, old/new values)
- AutoLogger module name is correct

**Security Tests:**
- SQL injection via `?q=`, `?sort=`, `?id=`
- Permission check: user without `module.update` → 403 on PUT
- Unauthenticated → 401 on all business routes

### 10.5 Acceptance Gate

A module is accepted for production when:

1. All unit tests pass
2. All integration tests pass
3. All regression tests pass
4. Security tests show zero critical/high findings
5. Performance tests (if applicable) meet targets in §8.1
6. The Module Completion Checklist (§6) is fully checked
7. The ENGINEERING_STANDARDS.md is updated if new patterns were introduced

---

> **Document Status**: Living Standard
> **Version**: 1.0.0
> **Last Updated**: 2026-07-01
> **Review Cycle**: Every module completion, or when a pattern changes.
> **Approved By**: [Team review required]
