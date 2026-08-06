# TradePro Integrity — Baseline & Accepted Exceptions

> Status: **BASELINE ESTABLISHED** — Phase 4 (AP) is accepted at tag `phase4-ap-complete`.
> Integrity audit reduced **33 → 4** issues. Remaining 4 are **real business items**,
> documented below as *accepted exceptions* — they are NOT Phase‑4‑caused and do NOT block
> the migration, which remains **on hold** pending the product‑owner decisions in this doc.

## Run set proven green (at this baseline)

| Check | Result |
|---|---|
| `node scripts/integrity_audit.js` | **4 issues / 0 check errors** (GL Core 0, COA 0, Treasury 0, Allocations 0) |
| `node scripts/verify_ap_phase4.js` | **18/18 PASS** (self‑tearing fixture) |
| `npm run regression -- --skip-performance` | **52/52 PASS** |

## Cleanup performed (to reach the clean baseline)

1. Removed all `TST_*` synthetic fixtures (suppliers 3–5, customers 3–6, products 3–8)
   and every related document: invoices, returns, items, collections, ar/ap payments +
   allocations + cheques + notes, legacy `supplier_payments`, treasury transactions,
   stock movements/inventory balances, journal entries. — `scripts/cleanup_tst_fixtures.js`
2. Removed the pre‑existing AR**-promote test customer **`PROMOTE2`** and its reversed
   payments + its sales invoice + treasury `in` rows without JEs.
3. Removed **orphan journal entries** (ids referencing deleted TST / PROMOTE2 documents).
4. **Anchored materialized balances to the GL referee** (the SSOT):
   - `chart_of_accounts.current_balance` recomputed from GL lines (all 54 accounts)
   - `treasury_accounts.current_balance` recomputed from the linked SYS_CASH/BANK GL
   - `customers.current_balance` and `suppliers.current_balance` recomputed via
     `recalcCustomerBalanceAsync` / `recalcSupplierBalanceAsync`
   → `scripts/reconcile_balances.js`

---

## Remaining 4 — accepted exceptions (need business decision or acknowledgment)

### E1. Customer operational‑basis vs GL — C‑0001 (منير السيد علي) & C‑0002 (الحج متولي)
- `current_balance` == `gl_balance` for both (`diff_cur_gl = 0` → the SSOT is consistent
  with the GL). Only the **operational‑basis formula** (opening + sales − returns − recpts)
  differs: C‑0001 op 0.8 vs GL 1.6; C‑0002 op −743.2 vs GL −261.4.
- Cause: the operational basis counts **customer cheques `ARP-0005`-type** collections
  that have no GL posting until deposit. This is a reporting‑basis difference, **not** a
  data error.
- **Action**: (a) accept as a known reporting basis, or (b) instruct `balance`/statement
  ticket to match operational to GL by excluding un‑deposited cheques. **Owner: finance.**

### E2. Inventory value vs GL (`سعر المخزون` 9,476.27 vs SYS_INVENTORY GL 6,061.50, diff 3,414.77)
- Inventory quantity ledger is consistent (audit qty PASS). The **monetary value of
  on‑hand stock does not equal the GL `SYS_INVENTORY` balance** — a cost‑basis opening
  gap (likely historical stock‑in posted into GL before the GL‑SSOT, or item cost vs WAC
  drift).
- **Action**: book a single GL adjustment entry to bring `SYS_INVENTORY` up to the
  quantity×cost stock value (asset/total equity), or document the intentional opening
  difference. **Owner:** accounting/finance. **Do not** fix by silent delete.

### E3. Customer cheque ARP‑0005 (400) — active, no journal entry
- Real customer cheque (C‑0002) in an **awaiting‑deposit** state. By AR‑engine design,
  cheques post a journal entry only at **deposit/clear**. The audit chequeline flags it as
  a known "bank cheque" — an accounting feature, not an anomaly.
- **Action**: confirm it is a live cheque (deposit it to post the JE) or reverse if invalid.
  **Owner:** treasury/AR.

---

## Migration hold status (per product owner)
- The **AP legacy migration** is **NOT started**. It will only proceed on `TradeProCI`
  after the product owner resolves/accepts the exceptions above (E1–E3) and signs each of
  the gates in `PHASE4_AP_MIGRATION_PLAN.md1` (notably 《go/no-go：clear vs accept`).
- Tag `phase4-ap-complete` is the official Phase‑4 baseline point.