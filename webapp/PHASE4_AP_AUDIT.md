# Phase 4 — AP Engine Audit (report only)

> **Branch:** `phase4-ap-unification`
> **Date:** 2026-08-06
> **Status:** 📋 Audit complete — REPORT ONLY, zero code changes yet.
> **Rule before code:** apply the same Single-Source-of-Truth philosophy AR reached in Phase 2/3 (`phase3-soft-reversal-passed`), not a copy/paste of AR code.

---

## 1. The core problem: TWO parallel payment worlds

AP today runs **two live, competing** payment stacks. Both are written by the frontend in production.

| | World A — "new" | World B — "legacy" |
|---|---|---|
| Payment table | `ap_payments` | `supplier_payments` |
| Allocation table | `ap_payment_allocations` | `supplier_payment_allocations` |
| Cheque table | `ap_cheques` | `checks` |
| Create endpoint | `POST /api/ap/payments` (used by `accounting.js:1149`, `api.js:921`) | `POST /api/payments` (used by `viewSupplierFinance.js:634`) |
| Delete endpoint | `DELETE /api/ap/payments/:id` | `DELETE /api/payments/:id` |
| Matching endpoints | read/write **World B** tables! | — |
| Statement / detail | GL-derived (good) | GL-derived (good) |

**The killer:** the AP matching engine (`/api/ap/payments/matching/*` in `routes/ap_payments.js`) reads and writes **`supplier_payments` + `supplier_payment_allocations`** (World B), while AP payment creation writes **`ap_payments` + `ap_payment_allocations`** (World A). So:

- A voucher created through `POST /api/ap/payments` never appears in the matching screen (matching lists `supplier_payments`).
- A voucher created through `POST /api/payments` never appears in `ap_payments` reports/statements that read World A.
- Reports are split across the two tables (`reports.js:3047` reads `supplier_payments`; `reports.js:2583` reads `ap_payments`; `balanceService.js:195` and `cashFlowRepository.js:66` read `supplier_payments`).

This is exactly the AR fragmentation (legacy `customer_collections` vs `ar_payments`) — but in AP the matching engine itself is still on the legacy tables, so the SSOT is worse than AR was before Phase 2.

---

## 2. Findings by category

### A. Payment creation paths
- **F1 (critical) — dual write path.** Two endpoints create payments in two different tables, each posting a GL entry with a different `reference_type` (`ap_payment` vs `supplier_payment`). Both are wired to the UI.
- **F2 — legacy status misuse.** `routes/payments.js:324` sets invoice `status='posted'` on reverse (a status this model doesn't use); create path sets `'paid'/'partial'` inline instead of the canonical `refreshInvoiceStatus`.
- **F3 — legacy overpayment guard** uses `suppliers.current_balance` (GL-derived) but its own preview (`balanceService.getSupplierFullBalance`) reads legacy `supplier_payments`, so the two disagree as soon as World A is used.

### B. Allocation SSOT fragmentation
- **F4 (critical) — matching is on the wrong table.** `ap_payments.js` `/matching/suppliers`, `/matching/data`, `/matching/save` all use `supplier_payments` / `supplier_payment_allocations`.
- **F5 — `ap_payment_allocations` is minimal.** Schema (ci_seed.js:114) = `id, payment_id, invoice_id, allocated_amount` only. Missing: `discount_amount`, `net_amount`, `status`, `created_at`, `created_by` — everything AR got in Phase 2/3.
- **F6 — no active/void lifecycle.** `refreshInvoiceStatusAsync` (`ap_payments.js:61`) sums `allocated_amount` with **no status filter** and **no net concept** → discounts and voided vouchers produce wrong remaining/status.

### C. Discount path
- **F7 (known issue, confirmed) — discount JE bypasses the accounting engine.** `ap_payments.js:619` does `require('./journal_entries')` → `createJournalEntryAsync(...)` instead of `services/accountingEngine.js` `postJournalEntryAsync` (the canonical GL SSOT writer). Different signature/behavior; this is the latent bug flagged for the AP phase.
- **F8 — discount is not persisted as an allocation.** `matching/save` computes `totalInvoiceDebit = allocated + discount` and updates the invoice, but inserts only `allocated_amount` (no discount/net columns). There is no operational record tying the discount to the voucher → DELETE can't reverse it, and dynamic remaining ignores it.
- **F9 — discount JE attached to the invoice**, not the voucher (`reference_id = invoice_id`, ref `purchase_discount`). AR deliberately attaches to the voucher so voiding the voucher reverses the discount atomically. AP's void path (`ap_payments.js` DELETE) only reverses `ap_payment` entries → the discount JE is orphaned after void.

### D. Deletion / reversal paths
- **F10 (same bug AR had pre-Phase 3) — void does not mark allocations.** `ap_payments.js` DELETE restores invoice `remaining` from allocations but neither deletes nor marks them → the invoice stays "paid" for matching/dynamic-remaining, and re-matching to full is impossible.
- **F11 — `ap_cheques.js` physically DELETEs allocations** (lines 250 and 344) on return/cancel → audit trail lost (AR already moved to soft-void).
- **F12 — legacy DELETE physically deletes** allocations + `checks` + row (`payments.js:329-331`).

### E. GL posting
- **F13 (good) — payment JE direction is correct:** `Dr SYS_AP / Cr SYS_CASH|SYS_BANK` (debit reduces payable), posted through `postJournalEntryAsync`.
- **F14 (good) — supplier balance is GL-derived:** `recalcSupplierBalanceAsync` = opening + SYS_AP net (accountingEngine.js:486), same philosophy as AR.
- **F15 (good) — statements are GL-derived** in both routes.
- **F16 (decision needed) — cheque payments post NO JE.** Both POST routes skip the JE when `payment_method='check'`; the statement note says cheques only appear once their accounting effect is posted. Consequence: GL supplier balance ≠ operational "paid by cheque" until then; invoice shows `paid` in the subledger while GL still shows the payable. Must decide the intended cheque accounting.

### F. Reports
- **F17 — supplier payments report reads legacy `supplier_payments`** (`reports.js:3047`) → misses World-A vouchers.
- **F18 (ok) — voucher print reads `ap_payments` + `ap_payment_allocations`** (`reports.js:2583-2605`).
- **F19 — `balanceService.getSupplierFullBalance` reads legacy `supplier_payments`** → preview/aging disagree with GL as soon as World A is used.
- **F20 — `cashFlowRepository` reads legacy `supplier_payments`** → cash-out flows miss World-A payments.
- **F21 (good) — integrity audit already sums BOTH** legacy + new (`integrity_audit.js:201-205`) and validates supplier subledger vs GL; also has `doc_ap_payment_no_je` (line 467). AP `Subledger vs GL` issues today are 0 with the legacy table empty — any legacy write flips them on.

### G. Cheques
- **F22 — two cheque systems live:** `ap_cheques` (World A) and `checks` (World B). Same fragmentation.
- **F23 — `ap_cheques` physical-deletes allocations** (F11).

### H. Missing canonical predicates
- **F24 — no `status='active'` filter anywhere** on AP allocation reads (all consumers list every row, including voided/reversed once soft-void exists).
- **F25 — `matching/data` doesn't filter reversed vouchers** (`WHERE sp.supplier_id = @sid` with no status).

---

## 3. Target design (mirror AR, don't copy code)

1. **One SSOT:** `ap_payments` + `ap_payment_allocations`. All creation, matching, reporting, aging, cash-flow read/write these.
2. **Migration on `ap_payment_allocations`:** add `discount_amount DECIMAL(18,4) DEFAULT 0`, `net_amount DECIMAL(18,4) DEFAULT 0`, `status NVARCHAR(20) DEFAULT 'active'`, `created_at`, `created_by` (same shape as `ar_payment_allocations`).
3. **Matching engine moved** from `supplier_payment_allocations` → `ap_payment_allocations`, with `net = allocated + discount` and `status='active'` filters everywhere.
4. **Discount JE via `services/accountingEngine.js`** (`postJournalEntryAsync`), attached to the **voucher** (`reference_type='ap_payment'`, `reference_id=payment_id`) — fixing the F7 latent bug — and reversed atomically on void.
5. **Soft-void on delete:** mark allocations `status='void'`, restore invoice, reverse voucher JE + discount JE, reverse treasury, `recalcSupplierBalanceAsync`.
6. **`ap_cheques` return/cancel** switch from physical `DELETE` to `status='void'` (like AR Phase 3).
7. **All reports read the SSOT** with `status='active'`; legacy `supplier_payments` / `supplier_payment_allocations` / `checks` stop being written; add an integrity check "legacy tables must stay empty".
8. **Decision on cheque GL posting** (F16) before finalizing supplier-balance semantics.

---

## 4. Decisions needed before coding

1. **Frontend consolidation:** the supplier-finance screen (`viewSupplierFinance.js` → `/api/payments`) and the accounting payments screen (`accounting.js` → `/api/ap/payments`) — unify onto `/api/ap/payments`. Confirm which UI is the primary; the other is redirected or removed.
2. **Cheque accounting (F16):** post the cheque JE at issue (Dr SYS_AP / Cr SYS_BANK-NOSTRO) or keep the "posted when cleared" model — must match the AR cheque behavior.
3. **Legacy tables:** drop writes first, then decide read-only retention vs migration of existing `supplier_payments` data into `ap_payments`.

**Suggested gate after implementation:** `verify_ap_phase4.js` mirroring `verify_ar_phase2` + manual soft-reverse scenario + `integrity_audit.js` (expect `Subledger vs GL` and `Allocations` = 0) + `tests/phase1/integration.js` (no regression).
