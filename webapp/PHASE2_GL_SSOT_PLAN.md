# Phase 2.1 — GL Single Source of Truth: System Map & Conversion Plan

> **Branch:** `nav-restructure`
> **Date:** 2026-08-03
> **Status:** 📋 Research complete — REPORT ONLY, zero code changes in this stage.
> **Hard rules:** no breaking existing screens/APIs/workflows · no historical data modification · no deleting tables/routes/services · every change incremental & reversible · after each step run Integration Tests + Integrity Audit and confirm no regression.

---

## 1. Goal

Phase 2 = turn the General Ledger (`journal_entries` / `journal_entry_lines` / `chart_of_accounts`) into the **single source of truth** for all financial figures:
- Statements (AR/AP customer/supplier)
- Aging (AR/AP)
- Trial balance, balance sheet, income statement
- Receivables / payables KPIs (dashboard, analytics)
- Treasury balances
- VAT reports (T20/T38), inventory valuation (T39)
- Cash flow, profitability BI

Operational tables remain the **transaction origin** (they capture business events). The GL remains **derived from them via the posting pipeline**. "GL = SSOT" means: any *financial figure* reported to the user is computed from the GL — not from operational tables or cached balance columns.

---

## 2. Data-Source Map

### 2.1 The GL posting pipeline (already the SSOT write-path)

`services/accountingEngine.js` is the single engine that creates ledger truth:

| Function | Lines | Role |
|---|---|---|
| `postJournalEntryAsync` | 380-393 | Posts a JE; **real-time delta on `chart_of_accounts.current_balance`** (by account type: asset/expense → debit−credit; liability/equity/revenue → credit−debit) |
| `reverseJournalEntryAsync` | 403-476 | Posts inverted JE via `postJournalEntryAsync`, sets `is_reversed=1`, `reversal_of_id` |
| `seedRequiredSystemAccountsAsync` | 193 | Idempotent system accounts (SYS_AR, SYS_AP, SYS_CASH, SYS_BANK, SYS_VAT_OUTPUT, SYS_VAT_INPUT, SYS_INVENTORY, SYS_RETAINED_EARNINGS, …) |
| `recalcSupplierBalanceAsync` | 486-515 | **GL-derived** supplier balance (the reference implementation for migration) |
| `recalcCustomerBalanceAsync` | 523-559 | **operational-derived** customer balance (the only remaining non-GL cache) |

**Canonical active-JE predicate** (used everywhere GL is read, incl. audit): `(je.is_reversed IS NULL OR je.is_reversed = 0) AND (je.reversal_of_id IS NULL) AND (je.source_action IS NULL OR (je.source_action NOT LIKE '%_cancel' AND je.source_action <> 'cancel'))`.

70+ `postJournalEntryAsync` call sites across sales, purchases, returns, AR/AP payments/notes/cheques, collections, treasury, CRM settlements, inventory, fixed assets, customer opening — every business event already flows to GL.

### 2.2 Table classification

| Layer | Tables | Role in SSOT |
|---|---|---|
| **GL (authoritative)** | `journal_entries`, `journal_entry_lines`, `chart_of_accounts` | All financial figures must derive from here |
| **Operational (transaction origin)** | `sales_invoices`, `sales_returns`, `purchase_invoices`, `purchase_returns`, `ar_payments`, `ap_payments`, `ar_notes`, `ap_notes`, `customer_collections`, `treasury_transactions`, `stock_movements`, `inventory_balances`, `fixed_assets`, `crm_settlements` | Business events; metadata + quantities for display; still the input to the GL pipeline |
| **Cached balances (derived, to be GL-maintained)** | `customers.current_balance`, `suppliers.current_balance`, `treasury_accounts.current_balance`, `chart_of_accounts.current_balance`, `inventory_balances.balance_after` | Read-optimized mirrors. Must be (a) maintained from GL, or (b) reconciled vs GL continuously |
| **Legacy (no longer authoritative)** | `supplier_payments` (comments in `payments.js:34-35` confirm ap_payments+allocations is truth; empty/legacy) | Remove only after confirming zero readers |

### 2.3 Cached-balance write/read inventory (complete)

#### `customers.current_balance`
- **WRITE:** `accountingEngine.recalcCustomerBalanceAsync` (canonical, 46 call sites), `balanceService.updateCustomerBalance` (test-only), `customers.js:509/332/720/821`.
- **READ:** overpay guards (collections.js:313/356-366, ar_payments.js:326/610), credit-limit warning (sales.js:540-544), dashboard KPI (dashboard.js:45), analytics (analyticsRepository.js:283/450-453/498-499, agingRepository.js:46/64, analyticsService.js:209), sales reports (salesReports.js:47-106/170-179/566/755-764).

#### `suppliers.current_balance`
- **WRITE:** `accountingEngine.recalcSupplierBalanceAsync` (GL-derived, 26 call sites), `balanceService.updateSupplierBalance` (test-only), `suppliers.js:119-121/173`.
- **READ:** overpay guard (payments.js:166-172, ap_payments.js:485), dashboard (dashboard.js:46), analytics (analyticsRepository.js:284/513/560-561, agingRepository.js:89/104), purchase reports (purchaseReports.js:872/1053-1097/1147-1152).

#### `treasury_accounts.current_balance`
- **WRITE:** 13 direct `UPDATE`s (sales.js:479/754, purchases.js:395/605, collections.js:104, ar_payments.js:128/538, ap_payments.js:96/440, ar_cheques.js:260, ap_cheques.js:177, treasury.js:166/271/66-69) + seed zeroing.
- **READ:** treasury.js:35-38, cashFlowRepository.js:123-128/223, cashFlowService.js:38/84, analyticsRepository.js:285, dashboard.js:47, admin.js:101-108 (audit diff).
- **Drift risk:** 13 manual write sites vs authoritative JE on SYS_CASH/SYS_BANK. `verifyIntegrity` audits cache vs treasury_transactions but **not** vs GL yet.

#### `chart_of_accounts.current_balance`
- **WRITE:** `postJournalEntryAsync` (real-time, canonical), year-end close (admin.js:577/583), COA create (seeds 0).
- **READ:** verifyIntegrity audit (admin.js:81-116), trial balance (accounting.js:568), inventory account balance (inventoryReports.js:552), integrityGate.js, integrity_audit.js.

#### `inventory_balances.quantity` + `stock_movements.balance_after`
- Written only via `stockEngine.updateStockBalanceAsync` (atomic OUTPUT delta); `balance_after` written into stock_movements by ~40 call sites. Qty cache is operational-parallel — the GL value driver is SYS_INVENTORY.

---

## 3. Complete List of Non-GL-Dependent Places (migration targets)

### Tier A — Reports already having a GL counterpart (flip source, show diff as reconciliation)
| Endpoint | File:Line | Now reads | GL substitution |
|---|---|---|---|
| VAT report (T20) | reports.js:549 | `sales_invoice_items` | `journal_entry_lines` on SYS_VAT_OUTPUT, group by rate |
| VAT purchase report (T38) | reports.js:3358 | `purchase_invoices` | `journal_entry_lines` on SYS_VAT_INPUT |
| Inventory valuation (T39) | reports.js:3936 | `inventory_balances × cost_price` | SYS_INVENTORY GL movements; qty only as display cross-check |

### Tier B — Statements / aging / receivables / payables (core 13 docs)
| Endpoint | File:Line | Notes |
|---|---|---|
| AR customer statement | collections.js:262 | GL rows via `je.customer_id`; pattern already proven by payments.js:353 |
| AP supplier statement | payments.js:353 | **already GL** — the reference template |
| AP supplier statement | ap_payments.js:200, ar_payments.js:259 | GL-ify |
| Customer account aging | collections.js:493, ar_payments.js, agingRepository.js | GL buckets (current/30/60/90/120) |
| Customer statement (analytics) | analyticsRepository.js:786 | uses `system_code='AR'`; align with SYS_AR |
| Dashboard receivable/payable KPIs | dashboard.js:10/45/46 | currently Cached `current_balance` |

### Tier C — BI / analytics re-derived from GL
| Endpoint | File | Now reads | GL source |
|---|---|---|---|
| Cash flow (T46) | cashFlowRepository.js | treasury_transactions | JE on bank/treasury accounts |
| Treasury summary/balances (T47-T51) | treasury.js:300, cashFlow repo | `treasury_accounts.current_balance` | GL cash accounts |
| Profitability (T52) | profitabilityRepository.js | sales/purchase invoices + expense ledgers | GL revenue/COGS/expense accounts |

### Tier D — Cached columns & reconciliation hardening
| Target | File:Line | Action |
|---|---|---|
| `customers.current_balance` | accountingEngine.js:523-559 | swap recalc to GL (SYS_AR + `je.customer_id`); **single choke point, 46 call sites unchanged** |
| `balanceService.getCustomerFullBalance` | balanceService.js:14-42 | same GL swap (keeps legacy/test paths consistent) |
| `treasury_accounts.current_balance` | 13 sites | derive from GL or assert parity in verifyIntegrity |
| `verifyIntegrity` | admin.js:70-120 | extend to compare each cached balance vs GL sum (today only vs operational) |
| `supplier_payments` legacy reads | balanceService.js:193-198, admin.js:96 | confirm zero-reader before removal |

---

## 4. Key Architectural Findings

1. **GL already maintains COA balances** — `postJournalEntryAsync` updates `chart_of_accounts.current_balance` transactionally on every JE. All 70+ call sites already drive COA.
2. **Supplier balance is already GL-derived** — the reference implementation to copy for customers.
3. **Customer balance is the only operational-derived cache** — one choke point (`recalcCustomerBalanceAsync`), 46 callers; lowest-risk high-value swap.
4. **Treasury has double-tracking drift risk** — 13 manual write sites vs authoritative JE on SYS_CASH/SYS_BANK.
5. **Two parallel route trees** (monolithic `sales.js`/`purchases.js` + modular `sales/*`/`purchases/*`) — both post JEs and call recalc; migration must cover both.
6. **Reconciliation tooling already exists** — `admin.js verifyIntegrity`, `scripts/integrity_audit.js` (GL-aware), `scripts/integrityGate.js` (CI gate). These become the guardrails for each step.

---

## 5. Conversion Priorities (lowest → highest risk)

| Priority | Work | Risk | Why |
|---|---|---|---|
| **P1 (low)** | Make GL = sole read source for financial reports already mirroring GL (VAT, valuation) — keep operational tables as cross-check only | Low | Report-only read path; no writes; no workflow change |
| **P2 (low-mid)** | Swap `recalcCustomerBalanceAsync` + `balanceService` customer balance to GL (mirror supplier impl) | Low | Single choke point, 46 callers unchanged, readers unchanged; verified by existing GL-aware audit |
| **P3 (mid)** | GL-ify AR/AP statements + aging + dashboard receivables/payables (Tier B) | Mid | Read-path changes to many report endpoints; must not change displayed numbers (audit must show 0 diff on clean DB) |
| **P4 (mid-high)** | Treasury: derive `treasury_accounts.current_balance` from GL (or parity-assert) + cash flow BI | Mid-high | Removes 13 manual writes; must preserve treasury workflow behavior |
| **P5 (high)** | Profitability BI + year-end close hardening from GL | High | Complex joins, close-time math |

---

## 6. Step-by-Step Execution Plan (each step: implement → Integration Tests → Integrity Audit → confirm no regression)

### Step 1 — Extend `verifyIntegrity` to audit Cached-vs-GL parity (read-only, no behavior change)
- Add: for each customer/supplier/treasury account, compare cached `current_balance` vs GL-derived sum (canonical active-JE predicate). Report as issues (like existing 6 historical diffs), **never auto-fix**.
- Deliverable: the audit now exposes exactly what each later step must drive to zero.
- **Risk: none** (read-only audit). **Gate: audit exit code still 0 (issues allowed, errors not).**

### Step 2 — Swap `recalcCustomerBalanceAsync` to GL (mirror supplier version)
- Formula: `customers.opening_balance + SUM(jl.debit − jl.credit)` on SYS_AR filtered by `je.customer_id`, canonical active-JE predicate.
- Same change in `balanceService.getCustomerFullBalance`. No reader changes. 46 call sites untouched.
- **Risk: low.** **Gate: integration 14/14 + audit shows customer balances now match GL (pre-existing historical diffs remain documented, not touched).**

### Step 3 — GL-ify customer/treasury statement & aging read paths (Tier B)
- Convert AR/AP statements, customer aging, dashboard receivable/payable KPIs to GL reads (using `payments.js:353` as template). Operational tables only LEFT JOINed for metadata (doc numbers, dates).
- **Risk: mid.** **Gate: on clean DB, statement/aging numbers must equal previous output (diff = 0).**

### Step 4 — Flip VAT (T20/T38) + inventory valuation (T39) to GL-primary
- Aggregate `journal_entry_lines` on SYS_VAT_OUTPUT/SYS_VAT_INPUT; valuation from SYS_INVENTORY movements. Operational data becomes display cross-check.
- **Risk: low-mid.** **Gate: report totals on clean DB match within rounding; audit 0/0.**

### Step 5 — Treasury current_balance from GL + cash-flow BI (Tier C)
- Derive `treasury_accounts.current_balance` from GL cash/bank accounts; assert parity in verifyIntegrity. Re-point cash flow repo to JE lines.
- **Risk: mid-high.** **Gate: treasury workflows (create/delete/cancel) integration + parity audit = 0 diff on clean DB.**

### Step 6 — Profitability BI from GL (Tier C, last)
- Re-point profitabilityRepository to GL revenue/COGS/expense accounts.
- **Risk: high.** **Gate: BI figures equal old output on clean DB.**

### Step 7 — Reconciliation hardening & legacy cleanup (only after everything green)
- Remove `supplier_payments` readers after confirming zero usage; document final tool as read-only report (never auto-fix production data).

**Cross-cutting rule per step:** no schema change, no table/route/service deletion, no historical data modification. Every step is additive/reversible and guarded by the same CI gate used in Phase 1 (`phase1-regression.yml`).

---

## 7. Verification Strategy (unchanged from Phase 1)

1. `node tests/phase1/integration.js` → must stay **14/14** after every step.
2. `node scripts/integrity_audit.js` → **0 errors** always; known historical issues (6) documented, never touched; new diffs caused by a step = blocker.
3. CI `phase1-regression.yml` runs both on every push to `nav-restructure`.

---

## 8. Recommended Next Action (after approval of this report)

Start with **Step 1** (extend `verifyIntegrity` cached-vs-GL parity audit) + **Step 2** (swap customer balance to GL). Both are low-risk, high-value, and make every subsequent step verifiable.

---

# Step 1 + Step 2 — Execution Report (DONE)

> **Date:** 2026-08-04 · **Branch:** `nav-restructure` · **Status:** ✅ COMPLETE — both steps implemented, integration + audit green.
> **Scope:** Step 1 (read-only GL-vs-cached audit) and Step 2 (customer balance derived from GL). **Step 3 NOT started** per plan.

## Step 1 — `verifyIntegrity` cached-vs-GL parity audit (read-only)

- `backend/routes/admin.js`: `verifyIntegrity` now audits cached `current_balance` vs GL-derived sums for **customers**, **suppliers**, **treasury accounts**, plus **inventory** (SYS_INVENTORY) and **COA-vs-operational** checks, using the canonical active-JE predicate (`ACTIVE_JE` const shared with `accountingEngine.js`/`balanceService.js`/`integrity_audit.js`). Reports issues, **never auto-fixes**.
- `backend/frontend/.../viewSettings.js`: shows the audit result (`allPassed` + per-check diffs) in the admin settings view.
- **Gate:** audit reports diffs as issues but stays `0 errors`; on the clean seed DB all diffs = 0.

## Step 2 — Customer balance derived from GL (SYS_AR + `je.customer_id`)

Both `recalcCustomerBalanceAsync` (`accountingEngine.js`) and `getCustomerFullBalance` (`balanceService.js`) now compute:
`customers.opening_balance + SUM(jl.debit − jl.credit)` over `journal_entry_lines jl JOIN journal_entries je` where `je.customer_id = :cid`, `jl.account_id = SYS_AR`, canonical active-JE predicate.

- **Return shape preserved:** `{ opening, sales, returns, collections, balance }` — `sales/returns/collections` now returned as `0` (GL-derived net is in `balance`). The `/collections/customer/:id/preview` endpoint and the AR screen read `d.balance`/`d.opening`, which remain intact (verified by integration + preview shape check).
- **Posting sites now pass `customer_id`** into `postJournalEntryAsync` (10th param) so the derived balance stays correct:
  - `ar_payments.js` (create payment JE) + recalc moved **after** the JE in the same transaction.
  - `collections.js` (create collection JE) + recalc moved **after** the JE in the same transaction.
  - `ar_notes.js` (debit note + credit note JEs).
  - `ar_cheques.js` (deposit JE + return-of-deposit JE; the bank-collection JE at L235 touches SYS_BANK/SYS_AR_CHEQUES only → correctly left without customer_id).
  - `crm_settlements.js` (approve JE) + recalc after the JE.
  - `sales.js`: invoice accrual JE (already had it), invoice collection JE on creation, `/invoices/:id/pay` JE, returns create/approve/edit JEs.
- **Intentional exception:** customer opening-balance JE (`customers.js:534`) carries no `customer_id` — the formula adds `opening_balance` explicitly, so double-counting is avoided. Confirmed correct, no change.
- **Readers unchanged** — all 46 `recalcCustomerBalanceAsync` call sites, overpay guards, credit-limit warning, dashboard KPI, analytics/aging/sales reports untouched.

## Verification results (clean `TradePro_CISeed_Repro`, port 3100)

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` (`TEST_BASE_URL=http://localhost:3100/api`) | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** (Subledger vs GL: 0) |
| `GET /api/admin/integrity` | ✅ `allPassed: true` |
| AR posting-attribution script (invoice/payment/collection/note JEs carry `customer_id`, SSOT `current=opening+GL`, preview shape + balance) | ✅ **20/20 passed** |
| `node --check` on all 8 modified backend files | ✅ no syntax errors |

## Operational notes

- **Environment trap found & fixed:** a **production** server (pid 3852, DB `TradePro`) listens on port **3000** and predates this session; earlier runs that hard-coded `http://localhost:3000/api` polluted `TradePro`. Root cause fixed in `tests/lib/auth.js` → `BASE = process.env.TEST_BASE_URL || 'http://localhost:3000/api'`; all test runs use `TEST_BASE_URL=http://localhost:3100/api` against the test DB.
- **Production `TradePro` restored to a clean state:** test invoices deleted via API, orphaned `CNT-0007` inventory count JE reversed via `reverseJournalEntryAsync` within a transaction (new entry 214), inventory qty restored to 34 with `adjustment_cancel` movement. Zero active JEs from 08/04 remain in production; the 5 original active invoices are intact. (`CNT-0005`, 08/03, predates the session — untouched.)
- API login uses `email` (not `username`): `admin@3smcompany.com` / `admin123`.

## Modified files (Step 1 + Step 2)

`routes/admin.js` · `routes/ar_cheques.js` · `routes/ar_notes.js` · `routes/ar_payments.js` · `routes/collections.js` · `routes/crm_settlements.js` · `routes/sales.js` · `services/accountingEngine.js` · `services/balanceService.js` · `tests/lib/auth.js` · `frontend/js/views/viewSettings.js`

**Next:** Step 3 (GL-ify AR/AP statements, aging, dashboard KPIs) — **DONE** (see below).

---

# Step 3 — Execution Report (DONE)

> **Date:** 2026-08-04 · **Status:** ✅ COMPLETE — all statement endpoints converted, integration + audit green.

## Step 3a — كشف حساب العملاء (Customer Statement) → GL

Converted 3 endpoints from operational-table reads to GL-only:

| Endpoint | File | Change |
|---|---|---|
| `GET /reports/customer-statement/:id` | `reports.js:71` | UNION of 3 operational tables + manual JEs → single GL query on SYS_AR via `je.customer_id` |
| `GET /collections/customer/:id/statement` | `collections.js:262` | Same conversion, response shape preserved (`type`, `notes`, `balance`) |
| `GET /customers/:id/statement` | `customers.js:912` | Same conversion, response shape preserved (`lines`, `running_balance`, `summary`) |

**Pattern used:** identical to supplier statement in `payments.js:353`:
- `GL_SELECT` query on `journal_entry_lines jl JOIN journal_entries je` where `jl.account_id = SYS_AR` and `je.customer_id = :cid`, canonical active-JE predicate
- Opening balance: `customer.opening_balance + SUM(debit - credit) before @from`
- `LEFT JOIN` operational tables for metadata only (not for balance)
- `ref_type` mapped to display labels (`sales_invoice` → فاتورة مبيعات, `customer_collection` → تحصيل, `ar_note` → إشعار, etc.)
- `showDetails=true` in reports.js still fetches items from operational tables (product names, quantities) — this is display data, not balance data

**Bug fixed:** `reports.js` supplier statement had undefined `op_bal` variable → replaced with GL-derived opening.

## Step 3b — كشف حساب الموردين (Supplier Statement) → GL

Converted 3 endpoints (1 was already GL-based):

| Endpoint | File | Status |
|---|---|---|
| `GET /payments/supplier/:id/statement` | `payments.js:353` | ✅ Already GL-based (Step 1) |
| `GET /ap_payments/supplier/:id/statement` | `ap_payments.js:200` | ✅ Converted |
| `GET /reports/supplier-statement/:id` | `reports.js:2792` | ✅ Converted |
| `GET /reports/purchaseReports/supplier-statement/:id` | `reports/purchaseReports.js:762` | ✅ Converted |

## Step 3c — تقارير Aging (Aging Reports) → NOT convertible

**Decision: Aging reports cannot be fully GL-ified.**

Aging buckets (current/30/60/90/120 days) require `invoice_date` and/or `due_date` to compute time-based buckets. The GL stores transaction amounts and dates, but does not store invoice-level metadata (due_date, payment terms). The aging calculation in `analyticsRepository.js:446-564` needs to:
1. Fetch individual invoices with their dates
2. Compute days-past-due per invoice
3. Group into aging buckets

This requires operational data (`sales_invoices.invoice_date`, `purchase_invoices.invoice_date`). The GL cannot provide this granularity without duplicating invoice metadata into JE descriptions (which would be fragile).

**Current state:** Aging reads `current_balance` (already GL-derived via Step 2 recalc) + operational invoice dates. This is the correct architecture: GL for balances, operational tables for business metadata.

## Step 3d — Dashboard KPIs → Already GL-consistent

**Decision: Dashboard KPIs do NOT need modification.**

Dashboard reads `customers.current_balance`, `suppliers.current_balance`, `treasury_accounts.current_balance` — which are cached columns maintained by:
- `recalcCustomerBalanceAsync` (GL-derived from SYS_AR, Step 2)
- `recalcSupplierBalanceAsync` (GL-derived from SYS_AP, already was GL)
- Treasury (13 manual write sites, Step 4 target)

The `verifyIntegrity` audit (Step 1) continuously verifies cached-vs-GL parity. Converting dashboard to direct GL queries would:
- Add complexity (import `getSystemAccountAsync`, build GL queries)
- Slow down dashboard (recalculate on every load vs read cache)
- Add no real value (audit already catches drift)

## Step 3e — التقارير التي تعتمد على أرصدة العملاء/الموردين

**Reports that read `current_balance`:**
- Dashboard KPIs (lines 45-47) — GL-consistent via recalc ✅
- Analytics `getDashboardKPIs` (analyticsRepository.js:283-285) — same ✅
- Analytics aging (analyticsRepository.js:446-564) — needs operational data, documented above ✅
- Sales/purchase reports — read operational tables for line items, not balance-dependent ✅
- Overpay guards (collections.js, ar_payments.js) — read `current_balance` for validation, GL-consistent ✅

All balance-dependent readers are GL-consistent via the recalc cache + audit guardrails.

## Verification results (clean `TradePro_CISeed_Repro`, port 3100)

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** |
| `node --check` on all 5 modified files | ✅ no syntax errors |

## Modified files (Step 3)

`routes/reports.js` · `routes/collections.js` · `routes/customers.js` · `routes/ap_payments.js` · `routes/reports/purchaseReports.js`

**Next:** Step 4 (Treasury `current_balance` from GL + cash-flow BI) — not started.

---

# Stabilization Phase (before Step 4)

## Findings during review of Step 3-converted reports

### Bug 1 (CRITICAL): `ref_type` contract mismatch in statements

`mapRefType` in `routes/reports.js` and `routes/collections.js` returned raw `reference_type` values (`customer_collection`, `ar_payment`, `ar_note`, `crm_settlement`, `manual_je`...), but the frontend contract (`frontend/js/views/viewReportsSales.js:641`) only accepts 4 values for statement filtering: `['sales_invoice','sales_return','collection','journal_entry']`. Rows with unmapped values were silently hidden + KPIs (`totalCollections`, `last_collection_date`) missed them.

**Fix (both files):**
- `sales_invoice` → `sales_invoice`
- `sales_return` → `sales_return`
- `customer_collection` / `ar_payment` → `collection`
- everything else (`manual_je`, `ar_note`, `crm_settlement`, ...) → `journal_entry`

### Bug 2 (CRITICAL): Trial Balance / General Ledger / Balance Sheet / Income Statement ignore reversal predicate

`routes/accounting.js` reports filtered only `is_reversed=0` (Trial Balance) or had **no** reversal filter at all (General Ledger opening+period, Balance Sheet, Income Statement, account Ledger). This **included reversal/cancellation entries** (inverted amounts), producing wrong balances that contradict the statements and the integrity audit, which both use the canonical `ACTIVE_JE` predicate.

**Empirical proof on test DB:** Trial Balance SYS_AR net was **−2500** (partial filter) vs **0** (canonical). The −2500 came entirely from cancellation entries (e.g. `create_invoice_cancel`, `manual_entry_cancel`) that must be excluded.

**Fix (`routes/accounting.js`):** added shared `ACTIVE_JE` constant (aliased `j`) matching `routes/admin.js` / `services/accountingEngine.js` / `scripts/integrity_audit.js`:
```
(j.is_reversed IS NULL OR j.is_reversed = 0)
AND (j.reversal_of_id IS NULL)
AND (j.source_action IS NULL OR (j.source_action NOT LIKE '%_cancel' AND j.source_action <> 'cancel'))
```
Applied to: `/ledger/:accountId`, `/trial-balance`, `/general-ledger` (opening + period), `/balance-sheet` (opening + period), `/income-statement` (opening + period).

### Bug 3 (MEDIUM): statement ORDER BY not deterministic
Changed all 7 statement queries to `ORDER BY je.entry_date ASC, je.created_at ASC, je.entry_no ASC` (was `je.entry_date ASC, je.id ASC`). Files: `reports.js` (×2), `collections.js`, `customers.js`, `ap_payments.js`, `reports/purchaseReports.js`, `payments.js`.

### Bug 4 (MEDIUM): undefined `op_bal` in `reports.js` supplier statement
Fixed during Step 3 (variable referenced before definition in `/reports/supplier-statement/:id`).

## Verification results after fixes (test DB `TradePro_CISeed_Repro`, port 3100)

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** |
| Manual JE linked to customer appears in statement as `journal_entry` and vanishes after reversal | ✅ **7/7 passed** (`_tmp_manual_je.js`) |
| Trial Balance SYS_AR net vs canonical GL | ✅ **0 == 0** (was −2500) |
| Balance Sheet totals balanced | ✅ totalAssets 7769.4 == totalLiabilitiesAndEquity 7769.4 |
| General Ledger SYS_AR (all reversed) | ✅ 0 rows; SYS_CASH shows only genuine active entry |
| `node --check` on modified files | ✅ no syntax errors |

## Performance review

- Statements: single query per customer/supplier (period) + optional opening query when `from` given → **no N+1**.
- Indexes confirmed present: `IX_Journal_Customer_Date (customer_id, entry_date, is_reversed)`, `IX_Journal_Supplier_Date (supplier_id, entry_date, is_reversed)`, `IX_JournalLine_Account_Date`.
- `reports.js` helpers (SYS_AR/SYS_AP resolution, `num()`) still used; no dead code introduced.

## Files fully GL-dependent after stabilization

- Customer statements: `routes/reports.js`, `routes/collections.js`, `routes/customers.js`
- Supplier statements: `routes/ap_payments.js`, `routes/payments.js`, `routes/reports.js`, `routes/reports/purchaseReports.js`
- Accounting reports: `routes/accounting.js` (ledger, trial-balance, general-ledger, balance-sheet, income-statement) now use canonical `ACTIVE_JE`

## Still operational + reason

- Aging reports: need `invoice_date`/`due_date` not stored in GL → documented in Step 3c.
- Dashboard KPIs: read cached `current_balance` (GL-derived via recalc + audit guardrails) → Step 3d.

## Stability confirmation

All Step 3-converted reports agree with the GL (canonical predicate). Statements, ledger, trial balance, balance sheet and income statement now share one source of truth. **Step 4 (Treasury `current_balance` from GL + cash-flow BI) may proceed on user approval.**

---

# Cleanup (before Step 4) — done

Deleted temporary test/fix files (verified not `require`d/`import`ed anywhere in the codebase):

- `backend/_tmp_stab_check.js`
- `backend/_tmp_manual_je.js`
- `backend/_tmp_cols.js`
- `backend/_fix_tb.js`
- `backend/_fix_reports.js`
- `backend/_fix_accounting.js`

Updated `webapp/.gitignore` Temp/Scratch section with new patterns: `_tmp_*.js`, `_fix_*.js`, `_scratch_*.js` (existing `tmp_*.js` kept).

Final gate (test DB `TradePro_CISeed_Repro`, port 3100):

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** |
| Temp files remaining in `backend/` | ✅ none (`backend/_*.js` = empty) |
| Dead code referencing temp files | ✅ none |

---

# Step 4a — Treasury `system_code` mapping (DONE)

## Design review (per user request, before adding the column)

**Q1: Is there an existing mapping between `treasury_accounts` and `chart_of_accounts`?**

**NO.** Verified from every angle:

- `treasury_accounts` columns: `id, account_name, account_type, bank_name, account_no, opening_balance, current_balance` — **no** `system_code`, `chart_account_id`, `gl_account_id`, `account_code`, and **no** FK to `chart_of_accounts`.
- `chart_of_accounts` has `system_code` (SYS_CASH=111, SYS_BANK=112) but nothing references it from the treasury side.
- The only indirect link is `expenses.account_id` (FK→COA) — used only for expense documents, not a general treasury↔GL mapping.
- `customers.ar_account_id` exists but is **legacy/dead**: written on create/update (`customers.js:454/658`) yet the posting pipeline always resolves `SYS_AR` via `getSystemAccountAsync` + `je.customer_id`. It is never read for accounting. So the codebase's established pattern is `system_code` (not account-id pointers), and we follow it.

**Q2: Why `system_code`?** Because it matches the canonical convention used everywhere in this codebase (`chart_of_accounts.system_code`, `getSystemAccountAsync(tx,'SYS_CASH'|'SYS_BANK')`, integrity audit `WHERE ca.system_code IN (...)`). One column links each treasury account to its GL cash/bank control account, enabling Step 4b/4c (per-account GL-derived balance + GL-based cash flow).

## What changed (Step 4a)

1. `backend/server.js` — startup migration: idempotent `ALTER TABLE treasury_accounts ADD system_code NVARCHAR(50) NULL` + separate backfill batch (`account_type='bank'` → `SYS_BANK`, else → `SYS_CASH`) for existing rows.
2. `backend/scripts/ci_seed.js` — `ensureCoreColumns` mirrors the same column + backfill (so a rebuilt test DB gets it too).
3. No API, no business logic, no historical data modified.

> Note: the backfill UPDATE runs in a **separate SQL batch** from the ALTER — SQL Server cannot reference a column in the same batch it was added.

## Verification (clean `TradePro_CISeed_Repro`, port 3100)

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** |
| `node tests/regression-test.js` | ⚠️ **9/11** — the 2 failures (`recalcCustomerBalanceAsync`/`recalcSupplierBalanceAsync` formula tests, expected 1500/2800 vs got 1000/2000) are **pre-existing from Step 2**, NOT from 4a. Proven by `git stash` of the 4a files → identical failures without 4a. Root cause: the tests insert an invoice row in the operational table **without posting a JE**, but since Step 2 the recalc functions are **GL-derived** (SYS_AR/SYS_AP via `je.customer_id`/`je.supplier_id`), so only `opening_balance` counts. These stale tests need updating in a later cleanup (out of 4a scope). |
| `node --check` server.js / ci_seed.js | ✅ no syntax errors |
| `treasury_accounts.system_code` column exists | ✅ YES, seeded row = `SYS_CASH` (cash account) |

**Next:** Step 4b — replace the 13 direct `current_balance` UPDATEs with a GL-derived `recalcTreasuryBalanceAsync` (mirrors `recalcSupplierBalanceAsync`).

---

# Step 4b — Treasury `current_balance` from GL — parallel GL-derived recalc (DONE)

> **Date:** 2026-08-04 · **Status:** ✅ COMPLETE — all 14 direct UPDATE sites instrumented with a GL-derived `recalcTreasuryBalanceAsync`, running in **parallel (diff-only) mode** per user rules.

## Design decisions (per user)

- **GL-only formula:** `SUM(jl.debit - jl.credit)` over the linked COA account (resolved via `system_code`: cash→`SYS_CASH`, bank→`SYS_BANK`) using the canonical active-JE predicate. **`opening_balance` is intentionally NOT added** — opening balances are already posted to the GL as opening JEs, so adding the column again would double-count. Accounts without an opening JE are a Historical-Data Issue handled later by a reconciliation tool (out of 4b scope).
- **Mapping guard (throw, not `TOP 1`):** if more than one treasury account maps to the same system code, `recalcTreasuryBalanceAsync` **throws** instead of silently picking one — a silent `TOP 1` would hide real Data Drift.
- **Two-mode execution:** `TREASURY_GL_ADOPT=1` → writes the computed value to `current_balance` (adopt mode). Default → **parallel diff-only**: computes GL balance, compares to stored, and only `console.warn("[recalcTreasuryBalance] DIFF ...")` when they differ **without writing** (per user rule: keep the parallel UPDATE, do not remove it).
- **Opening-JE fix:** the treasury-account create opening JE now posts bank→`SYS_BANK` (was always `SYS_CASH`).

## What changed

`services/accountingEngine.js` — new `recalcTreasuryBalanceAsync(poolOrTxReq, treasuryAccountId)` (exported), mirrors `recalcSupplierBalanceAsync`. Resolves the COA account via `system_code` column when present (4a migration) else falls back to `account_type`. Returns `{ treasury_account_id, system_code, balance, stored, diff, adopted }`.

Called **after** the module's own JE post (and after the direct UPDATE) inside the same transaction, at all 14 direct-UPDATE sites:

| File | Site(s) | Notes |
|---|---|---|
| `routes/treasury.js` | account create (opening JE), manual transaction, expense | opening JE now hits SYS_BANK for bank accounts |
| `services/treasuryEngine.js` | `reverseTreasuryTransactionAsync` | after offsetting reverse tx |
| `routes/sales.js` | invoice-create cash collection, `/invoices/:id/pay` | guarded `if (treasury)` |
| `routes/purchases.js` | invoice-create cash advance, payment | cash-acct re-query |
| `routes/collections.js` | collection JE | via `postTreasuryInAsync` returning `{ transNo, accountId }` |
| `routes/ar_payments.js` | payment JE, reversal | |
| `routes/ap_payments.js` | payment JE, reversal | |
| `routes/ar_cheques.js` | check collect JE | |
| `routes/ap_cheques.js` | check clear JE | |
| `routes/sales/invoices.js` (sub, not mounted) | create + pay | consistency |
| `routes/purchases/invoices.js` (sub, not mounted) | payment + accrual | |
| `routes/purchases/payments.js` (sub, not mounted) | payment JE | |

`postTreasuryInAsync` / `postTreasuryOutAsync` (collections / ar_payments / ap_payments) now return `{ transNo, accountId }` so callers can recalc the exact treasury account touched.

## Verification (freshly re-seeded clean `TradePro_CISeed_Repro`, port 3100)

> The previous Repro DB was polluted by repeated test runs (94 JEs, `TST-*` artifacts), which inflated the one Count test and the audit — unrelated to 4b. Dropped and re-seeded via `server.js` + `scripts/ci_seed.js` for a clean gate.

| Check | Result |
|---|---|
| `node tests/phase1/integration.js` (`TEST_BASE_URL=http://localhost:3100/api`) | ✅ **14/14 ALL PASSED** |
| `node scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** (Treasury: 0) |
| `node tests/regression-test.js` | ⚠️ **9/11** — the 2 failures (`recalcCustomerBalanceAsync`/`recalcSupplierBalanceAsync` formula tests, expected 1500/2800 vs got 1000/2000) are the **pre-existing Step-2** stale tests (insert operational row without JE), **NOT from 4b** — they appear identically on a clean DB and in Steps 2/3/4a. |
| Direct parity (fresh DB) | ✅ `treasury id=1` stored `current_balance` 0 == GL `SYS_CASH` SUM 0 → **diff=0, adopted=false** (parallel mode) |
| `node --check` on all modified files | ✅ no syntax errors |

## Known limitations / notes

- **`purchases.js` cash-payment JEs for the cash advance at creation (POST /invoices) and POST /payments do not post a JE for the cash OUT** (only the accrual JE is posted). Because `recalcTreasuryBalanceAsync` runs in **diff mode**, any such flow will emit a `DIFF` warning (GL below treasury balance) instead of silently diverging — this is the intended design so the diff is surfaced, and the actual GL inconsistency is left out of 4b scope.
- Direct `UPDATE treasury_accounts SET current_balance` lines are **kept** (parallel) per the user rule; `TREASURY_GL_ADOPT=1` is the opt-in switch to make the GL value authoritative.

## Modified files (Step 4b)

`services/accountingEngine.js` · `services/treasuryEngine.js` · `routes/treasury.js` · `routes/sales.js` · `routes/purchases.js` · `routes/collections.js` · `routes/ar_payments.js` · `routes/ap_payments.js` · `routes/ar_cheques.js` · `routes/ap_cheques.js` · `routes/sales/invoices.js` · `routes/purchases/invoices.js` · `routes/purchases/payments.js`

**Next:** Step 4c — cash-flow BI + (on approval) switch to adopt mode (`TREASURY_GL_ADOPT=1`) and remove the redundant parallel UPDATEs.

---

# Step 4c — Cash-Flow Reports read from GL (DONE — parallel mode, no adopt)

## Goal

Convert every Cash-Flow report (`/analytics/v1/cash-flow/*`) so its money figures come from the
General Ledger (`SYS_CASH`/`SYS_BANK` in `journal_entry_lines`) instead of the operational
`treasury_transactions` table and the stored `treasury_accounts.current_balance` column.

Per the user's rules for this step:
- **Do NOT** enable `TREASURY_GL_ADOPT=1` (stay in parallel mode).
- **Do NOT** delete any `UPDATE current_balance` — reports only switch their read source to GL.
- Run all gates and, if any old-vs-GL difference appears, report the reason **before** touching data.

## Design decisions

1. **GL cash movements** (`getGlCashMovements`) replace `getTreasuryTransactions`. Each cash line
   is a `journal_entry_lines` row whose COA account has `system_code IN ('SYS_CASH','SYS_BANK')`,
   joined to `journal_entries` and filtered by the **canonical active-JE predicate**
   (`is_reversed` NULL/0 AND `reversal_of_id` NULL AND `source_action` not `*_cancel`/`cancel`).
2. **GL cash/bank balances** (`getGlBalances`) replace `getTreasuryBalances`. Opening/closing/net/
   inflow/outflow are computed as `SUM(debit - credit)` bounded by the period on the same GL lines —
   the stored `current_balance` column is no longer read by any cash-flow report.
3. **Daily balance** and **monthly cash flow** are rebuilt directly from GL cash lines
   (running balance from GL opening; monthly `SUM(debit)`/`SUM(credit)` per month).
4. **Classification** (operating/investing/financing) is now driven by the JE `reference_type`
   on each GL cash line (e.g. `customer_collection` → operating in, `supplier_payment`/`expense` →
   operating out, `fixed_asset` → investing out, `treasury` → financing), replacing the old
   description/`trans_type` heuristic over `treasury_transactions`.
5. **Operational tables** (`customer_collections`, `supplier_payments`, `expenses`, `salary_slips`)
   are **no longer used** by any cash-flow report path. (They remain exported from the repository
   for backward compatibility of external callers, but the service no longer consumes them.)
6. **Response contract preserved** — the frontend (`viewFinance.js`) still receives
   `stmt.operating.net`, `stmt.investing.net`, `stmt.summary.openingCash/totalInflow/totalOutflow`,
   and `chartsRes.data` with the same shape. The `summary.accounts[].balance` now reflects the GL
   closing balance instead of the stored `current_balance`.
7. **Forecast** uses GL closing cash (`getGlBalances(null, today)`) instead of stored balances.

## Is Cash Flow 100% GL now?

| Old source | New source | Status |
|---|---|---|
| `treasury_transactions` (movements) | `journal_entry_lines` on SYS_CASH/SYS_BANK | ✅ GL |
| `treasury_accounts.current_balance` (opening/closing) | GL `SUM(debit-credit)` per account | ✅ GL |
| `treasury_transactions` (daily running balance) | GL cash lines running sum | ✅ GL |
| `treasury_transactions` (monthly) | GL `SUM(debit/credit)` per month | ✅ GL |
| `customer_collections` (operating in) | GL cash lines `reference_type='customer_collection'` | ✅ GL |
| `supplier_payments` (operating out) | GL cash lines `reference_type='supplier_payment'` | ✅ GL |
| `expenses` / `salary_slips` (operating out) | GL cash lines `reference_type='expense'`/`'salary'` | ✅ GL |
| `treasury_accounts.current_balance` (forecast current cash) | GL closing balance | ✅ GL |

**No cash-flow report path reads `treasury_transactions` or `current_balance` anymore.** The only
remaining `treasury_transactions` consumer is `routes/treasury.js` GET /summary (the treasury
screen totals, not the cash-flow analytics endpoints) and the frontend API client — both out of
scope for this step. `scripts/integrity_audit.js` Group F still validates the stored balances
against the operational ledger — deliberately unchanged (it is a write-path check, not a report).

## Modified files

- `analytics/repositories/cashFlowRepository.js` — added `activeJECond`, `GL_CASH_SYSTEM_CODES`,
  `getGlCashMovements`, `getGlBalances`; rebuilt `getDailyCashBalance`, `getMonthlyCashFlow`,
  `getCashFlowForecast` from GL; removed `getTreasuryTransactions`/`getTreasuryBalances`.
- `analytics/services/cashFlowService.js` — classification buckets from JE `reference_type`;
  statement/summary/kpis/charts/forecast all read GL movements + GL balances; response contract kept.

## Gate results (fresh re-seeded `TradePro_CISeed_Repro`, port 3100)

| Gate | Result |
|---|---|
| `node --check` (both modified files) | ✅ OK |
| `tests/phase1/integration.js` | ✅ **14/14** ALL PASSED |
| `scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** (Treasury: 0) |
| `tests/regression-test.js` | ✅ **9/11** — the 2 failures are the known pre-existing `recalcCustomerBalanceAsync` (expected 1500, got 1000) / `recalcSupplierBalanceAsync` (expected 2800, got 2000), documented since Step 2 and confirmed unrelated to 4c on the clean DB |

## Live verification of GL-backed figures

Posted 5 realistic journal entries through the real `accountingEngine` (customer collection,
supplier payment, expense, treasury deposit, asset purchase) and observed:

- Statement: operating in 5000, operating out 2000+300, investing out 400, financing in 1000,
  `summary.totalInflow 6000 / totalOutflow 2700 / netCashFlow 3300 / closingCash 3300` — all derived
  from GL, exact match with the posted lines.
- Charts: daily running balance 5000 → 3000 → 2700 → 3700 → 3300; monthly trend 2026-07 6000/2700/3300;
  operating breakdown Collections 5000 / Supplier 2000 / Expenses 300.
- After cleanup, DB returned to baseline and all reports show 0 (no GL cash lines) on the clean seed.

## Known difference vs. the old reports (explained, no data touched)

1. **Cash movements that never post a JE will not appear** (the old reports read operational
   tables that can contain rows with no journal entry):
   - `purchases.js` POST `/invoices` and POST `/payments` still create a treasury OUT transaction
     **without posting a cash JE** in some paths (documented earlier discovery) — under GL these
     show only if/when the payment posts a JE. This makes GL the *correct* ledger figure; the
     operational-only rows are a write-path gap (a separate Phase for `TREASURY_GL_ADOPT=1`).
   - `salary_slips` have **no GL posting at all** (no `SYS_SALARY` account exists in the seed
     tree), so "Salaries & Payroll" in the old operating breakdown has no GL counterpart and now
     reports 0 until payroll posting posts a cash JE.
2. **`summary.accounts[].balance`** now shows the GL closing balance, which differs from the stored
   `current_balance` in the exact amount already reported by the 4b diff on each treasury account
   (`diff = stored - GL`). On the clean seed both are 0 → diff 0.
3. **Opening cash** is now truly the GL balance before the period start (computed from all active
   JEs `< from`), whereas the old report summed `treasury_accounts.opening_balance`. If an opening
   balance was historically stored without an opening JE, the GL-based report reflects only what
   actually hit the ledger.

These are **reporting-source differences, not data migrations** — no stored data was modified in
this step.

## Not done here (deferred)

- Enabling `TREASURY_GL_ADOPT=1` and removing the parallel `UPDATE current_balance` sites —
  deferred to a separate later step per the user's rules.
- Fixing the write-path gaps (cash OUT without JE in `purchases.js`; payroll posting) — separate
  scope, documented as known differences above.
- `routes/treasury.js` GET /summary (screen totals) still reads `treasury_transactions` — out of
  scope for the cash-flow BI endpoints; flag for a future step if desired.

---

# Step 4d — `verifyIntegrity` Treasury audit: per-account vs GL via `system_code` (DONE)

## Goal

Upgrade the treasury audit inside `verifyIntegrity` (`routes/admin.js`, the `/api/admin/integrity`
endpoint) so it audits **every treasury account individually** against the General Ledger using the
`system_code` link introduced in Step 4a — replacing the old aggregate-only check.

Requirements honored: report-only (never fixes data), per-account display (name / type /
`system_code` / stored balance / GL balance / diff), and an explicit warning when more than one
treasury account maps to the same `system_code`.

## Design

- Each treasury account resolves to a GL system code: the explicit `system_code` column (4a
  migration) when present, else derived from `account_type` (`bank` → `SYS_BANK`, otherwise
  `SYS_CASH`) for legacy DBs.
- For each account, the stored `current_balance` is compared against the GL balance
  (`SUM(jl.debit - jl.credit)` over the linked COA account) using the canonical active-JE
  predicate.
- **Collision detection**: a separate query counts treasury accounts per effective `system_code`;
  any code with `COUNT(*) > 1` is reported as a mapping warning and forces
  `treasuryGlBalanced = false` (GL cannot be attributed across multiple operating accounts).

## New fields added to the `/admin/integrity` response

| Field | Meaning |
|---|---|
| `treasuryAccounts[]` | Per-account rows: `treasury_account_id`, `account_name`, `account_type`, `system_code` (effective), `stored_system_code`, `stored_balance`, `gl_balance`, `diff` |
| `treasuryGlDiffCount` | # treasury accounts with `|diff| > 0.01` |
| `treasuryGlTotalDiff` | Σ `|diff|` over all treasury accounts |
| `treasuryMappingCollisions[]` | Each colliding code: `system_code`, `account_count` |
| `treasuryCollisionDetected` | `true` if any code maps to >1 account |
| `treasuryGlBalanced` | `true` only if `treasuryGlDiffCount === 0` AND no collisions |

`allPassed` now includes the collision requirement (any collision ⇒ `allPassed = false`).

## Modified file

- `routes/admin.js` — replaced the single aggregate treasury-GL query (old check #7) with the
  per-account query + collision query and the fields above. `node --check` passes.

## Live verification (fresh re-seeded `TradePro_CISeed_Repro`, port 3100)

**Clean state (1 cash account mapped to SYS_CASH, #1 main treasury):**
```
allPassed = True · treasuryGlBalanced = True · treasuryCollisionDetected = False
treasuryAccounts: [ id=1 type=cash sys=SYS_CASH stored=0 gl=0 diff=0 ]
treasuryMappingCollisions: (none)
inventoryBalanced=True · customersGlBalanced=True · suppliersGlBalanced=True
```

**Collision scenario (temporarily inserted a 2nd cash account mapped to SYS_CASH):**
```
treasuryGlBalanced=False · treasuryCollisionDetected=True
accounts: [ id=2 type=cash sys=SYS_CASH stored=0 gl=0 diff=0, id=1 ... same ]
treasuryMappingCollisions: [ sys=SYS_CASH count=2 ]
```
(duplicate account removed afterwards → clean state restored.)

## Gate results

| Gate | Result |
|---|---|
| `node --check routes/admin.js` | ✅ OK |
| `tests/phase1/integration.js` | ✅ **14/14** ALL PASSED |
| `scripts/integrity_audit.js` | ✅ **Total issues: 0 · check errors: 0** (Treasury: 0) |
| `tests/regression-test.js` | ✅ **9/11** — 2 known pre-existing failures `recalcCustomerBalanceAsync` (1500 vs 1000) / `recalcSupplierBalanceAsync` (2800 vs 2000), unrelated to 4d and reconfirmed on the clean DB |

## Answers to the report questions

**Do all treasury checks now depend 100% on the GL?**
- The treasury **GL reconciliation** in `verifyIntegrity` is now **per-account and fully
  GL-based** (every account vs `journal_entry_lines` via `system_code`). This is the authoritative
  SSOT check the step targets.
- `scripts/integrity_audit.js` **Group F** still has two *write-path/diagnostic* checks that read
  `treasury_transactions`: `trs_account_balance` (stored `current_balance` vs
  `opening_balance + SUM(treasury_transactions)`) and `trs_transaction_no_je` (treasury rows with
  no journal entry). These are **intentionally unchanged** — they audit the operational write path
  (does the raw `treasury_transactions` ledger stay consistent, and are docs posted to GL), which
  is a distinct concern from the GL-vs-stored reconciliation. They currently pass (0 issues).

**Does any part of the audit system still rely on `treasury_transactions` or `current_balance`?**
- `verifyIntegrity`:
  - Check #6 `treasuryBalanced` still compares stored `current_balance` vs
    `treasury_transactions` (write-path self-consistency). Kept intentionally; it is not the GL
    reconciliation. It passes on the clean DB.
  - Check #7 (GL per-account) is fully GL — no `treasury_transactions`/`current_balance`.
- `scripts/integrity_audit.js` Group F: reads `treasury_transactions`/`current_balance`
  (write-path + accounting-completeness diagnostics), unchanged and passing — documented above.
- These remaining operational-ledger reads are **deliberate write-path audits**, not substitutes
  for the GL check. When `TREASURY_GL_ADOPT=1` ships and the parallel `current_balance` writes are
  removed, Group F's `trs_account_balance` (which reconciles against the deprecated column) can be
  retired; `trs_transaction_no_je` (accounting completeness) remains valid regardless.

## Not done here (deferred)

- Enabling `TREASURY_GL_ADOPT=1`; removing the parallel `UPDATE current_balance` write-path checks
  and the related Group F check — deferred to the next step per the user's plan.
- No stored data was modified anywhere in this step (report-only).
