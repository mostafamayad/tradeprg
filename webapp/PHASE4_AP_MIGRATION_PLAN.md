# PHASE 4 — AP Legacy Migration Plan (من REPLACE → AP SSOT)

> **STATUS: INTERNAL PLAN — IN DEVELOPMENT. DO NOT EXECUTE.**
>
> This document is a plan ONLY. Phase 4 currently ships with the **AP unified engine**
> live (verified 18/18) and the regression suite green (52/52). The legacy
> `supplier_payments` / `supplier_payment_allocations` tables are **read-only** and are
> still the historical source of old records.
>
> Nothing in this doc has been run against `TradePro` (live) nor `TradeProCI` yet.
> Every step below is gated behind an explicit decision from the product owner after
> Phase 4 is accepted.

---

## 1. Objective

No dual-write remains: the frontend and ALL reports/screens now read and write
exclusively through `/api/ap/payments` + the `ap_payment_allocations` SSOT.
The only DB tables still holding **historical AP documents** are:

| Table | Role today | Role after migration |
|---|---|---|
| `ap_payments` | **SSOT** for new AP payment vouchers | **SSOT** (unchanged) |
| `ap_payment_allocations` | **SSOT** for allocations/soft-reversal (active/void) | **SSOT** (unchanged) |
| `supplier_payments` | legacy, read-only (history) | **archive only** (renamed/archived) |
| `supplier_payment_allocations` | legacy, read-only (history) | **archive only** (renamed/archived) |

The migration moves the legacy historical rows into the new SSOT **without** touching
any live operation, then retires the legacy tables.

---

## 2. Guiding rules (unchanged from Decisions 1–7)

1. **The AR proven engine is the template.** AP allocations are a 100% copy of the
   AR soft-reversal fields: `discount_amount`, `net_amount`, `status`,
   `created_at`, `created_by`, `void` — never `DELETE`.
2. **SINGLE SOURCE OF TRUTH is `ap_payment_allocations`** for allocation, matching &
   reports. Legacy doubles are never referenced for new reads.
3. **Journal entries are the GL referee.** `suppliers.current_balance` is derived from
   the GL (`SYS_AP` lines); `recalcSupplierBalanceAsync` is called **after** every JE
   is posted (fixed in this phase).
4. **Discount** attaches to the voucher (`reference_type='ap_payment'`,
   `reference_id=paymentId`) so the generic voucher-JE reverse loop reverses it
   atomically on void.
5. **Legacy-write guards** return `410 LEGACY_WRITE_DISABLED` → users are told to use
   `/api/ap/payments`.

---

## 2. Preconditions (gates) — must ALL be TRUE before ANY execution

- [ ] `A` — Phase-4 AP engine **verified end‑to‑end** (done: `verify_ap_phase4.js` → 18/18).
- [ ] `B` — Full regression/integration **green** (done: `npm run regression` → 52/52).
- [ ] `C` — **Integrity = 0 on a clean state**. Rationale: the live `TradePro` still shows
       33 non-AP/pre‑existing drift items (inventory, subledger vs GL, COA, treasury,
       the pre‑existing `ARP-0014/15` AR cheques). Migration must ONLY start when
       **Allocations = 0** and **AP accountability = 0** and no NEW GL/Treasury delta
       comes from AP soft-reversal. (These are pre-existing; they are a product decision,
       not a Phase 4 blocker — see `《Decision: C go/no-go`.)
- [ ] `D` — `supplier_payments`/`supplier_payment_allocations` contain **no active
      allocations** that callers still depend on (all consumers migrated to `ap_*`).

---

## 3. Migration steps (in order)

### Step 1 — Archive (rename, no data copy)
```
sp_rename 'supplier_payments', 'supplier_payments_legacy'
sp_rename 'supplier_payment_allocations', 'supplier_payment_allocations_legacy'
```
- No rows are copied or deleted. Only the object names change.
- `server.js` migration block already creates/keep `ap_payment_allocations` API new-field
  schema (discount, net, status, created_*) so it does not depend on discovery of the old
  table for schema after rename.
- **Only execute AFTER Step A–D green AND after the dry‑run review (step 6).**

### Step 1b — (optional, if historical amounts must be visible in new reports)
If existing open `supplier_payments` rows need to appear in new AP reports, backfill
`ap_payments` + `ap_payment_allocations` from the legacy rows **with** JEs:
- For each legacy `supplier_payments` row that is NOT already outstanding (already
  cancelled/void), open →
  - ensure `suppliers.current_balance` matches the sum of the remapped allocations;
  - create `ap_payments` rows and matching `ap_payment_allocations`
    (`allocated_amount`+`discount_amount`→`net_amount`, `status='active'`), and
    `reference_type/payment` on its voucher.
- Backfill creates **new** documents; it must be **idempotent** (keyed by a migration
   marker, e.g. a `source_legacy_id` column) so a re‑run never doubles.

> Decision: whether historical rows are backfilled+laded as `active` is a **product call**
> — if the company considers already‑settled old records, they are migrated as
> `status='void/archived'` on a closed history, i.e. not re‑matched in new reports.

### Step 2 — Golden‑data sync (dry‑run)
Run the backfill on `TradeProCI` first. Verify:
- `ap_payment_allocations` dtssot totals equal legacy totals (per supplier).
- `suppliers.current_balance` (GL‑derived) === expected net outstanding.
- integrity audit shows zero new AP allocations issues.

### Step 3 — Reduce/remove legacy writers
Ensure NO endpoint writes the legacy tables except the 410‑guard messages:
- `routes/payments.js` POST/DELETE → 410 (done).
- `routes/purchases.js` POST `/payments` → 410 (done).
- audit `routes/purchases/payments.js:75`, `purchases.js:588` remain 410-dead code
  (they never reach SQL after the guard).

### Step 4 — Lockdown: `stores`/triggers (optional, strong)
Optionally create a `DEMAND` trigger on legacy tables that RAISES an error unless the
`app_name`/`transaction` is the migration itself → guarantees no re‑entry writes.

### Step 5 — Docs & branches
- Migration is NOT merged to `main`. It lives on a dedicated (**untrottedTo**) branch
  (e.g. `ap-legacy-migration`), always reviewed, gated, and run **only on CI** until green.

### Step 6 — Run order on live:
1. Backup `TradePro` (full).
2. Run on `TradeProCI` (full read-only dry via CI scripts).
3. Integrity audit CI → expect **0**.
4. If green → day‑time (off‑peak) run on `TradePro`.
5. Post-run audit → 0, then archive the legacy tables, drop the 410 guards **only**
   after end‑user smoke passes on those screens.

---

## 4. Rollback / Safety
- Everything is reversible simply: `sp_rename` back (object rename in same database).
- Do **NOT** hard-delete legacy rows for 6 months after migration (read vintage).
- A full DB backup is taken immediately before `Step 1`.

---

## 5. Acceptance / go‑no-go gates (the decisions that must be made)
- **《Decision: C`** — Do we proceed with migration BEFORE resolving the 33 pre‑existing
  integrity items, or resolve them first? (These are not Phase‑4‑caused.)
- **《Decision: historical** — backfill legacy as `active` (live reporting) or archive/void
  (no new books)?
- **《Decision: migration owner** — who signs off the CI‑green + the 6‑month retention?
- **《Decision: tag/eGrade` — tag `phase4-ap-complete` is the Phase‑4 acceptance point;
   migration is its own tracked work stream, not part of Phase 4.

---

## Appendix — files that are now legacy/read‑only (no writes)
| File | Guard |
|---|---|
| `backend/routes/payments.js` | POST/DELETE → 410 |
| `backend/routes/purchases.js` POST `/payments` | 410 |
| `backend/routes/purchases/payments.js` | no live writer (dead code) |
| `backend/scripts/migrate_vfp.js`, `_test_*` | tooling only, never user-run |
| `supplier_payments`, `supplier_payment_allocations` | DDL read‑only |

Reports/readers that now read the SSOT: `routes/reports.js`,
`routes/reports/purchaseReports.js`, `services/balanceService.js`,
`analytics/repositories/cashFlowRepository.js`, `routes/purchases.js`/
`purchases/invoices.js` cancel‑blockers.