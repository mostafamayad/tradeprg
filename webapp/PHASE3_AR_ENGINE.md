# AR Payment Engine — Single Source of Truth

> **Branch:** `ar-payment-unification-1a` → `phase4-ap-unification`
> **Status:** ✅ Stable (tag `phase3-soft-reversal-passed`)
> **Purpose:** one readable map of how money received is recorded, matched, reversed and reported. Read this before touching anything AR — or before modeling AP.

---

## 1. The Chain (write path)

Every customer payment flows through exactly one operational chain; the GL is derived from it. Nothing bypasses it.

```
Voucher
   │
   ▼
ar_payments                ← the receipt itself (amount, method, status: active/reversed)
   │
   ▼
ar_payment_allocations     ← SINGLE SOURCE OF TRUTH for allocation
   │                          (invoice_id, allocated_amount, discount_amount,
   │                           net_amount = allocated + discount, status: active/void)
   ▼
Journal Entries            ← posted by services/accountingEngine.js
   │                          (cash receipt, and a separate settlement-discount JE)
   ▼
Customer Balance           ← GL-derived (recalcCustomerBalanceAsync = opening + SYS_AR net)
   ▼
Statement                  ← reads ar_payments + allocations drill-down (active only)
   ▼
Matching                   ← dynamic remaining = grand_total − SUM(active net) − returns
   ▼
Reports                    ← ar-matching-status, aging, dashboard, trial balance
```

**Invariant:** every financial figure shown is computed from active allocations + the GL — never from cached `amount_paid` / `remaining` columns alone (they stay in sync for display only).

---

## 2. Soft Reverse (never delete allocation)

Voiding a voucher **reopens** the invoices it covered. The allocation rows are the audit trail and are **never deleted**; they are flagged and excluded from every calculation.

```
status = 'active'   → counts toward invoice due / matching / reports
status = 'void'     → excluded everywhere (allocation history preserved)
```

Every consumer filters `status = 'active'`:

- `refreshInvoiceStatusAsync` (ar_payments / collections / ar_cheques)
- matching engine (`/ar/payments/matching/save`, `/matching/data`, `/matching/customers`)
- dynamic remaining (reports `INV_DYNAMIC_REMAINING`, collections allocation, sales guards)
- ar-matching-status report, commission repository
- integrity audit checks

Inside the voucher void transaction (same `UPDATE ... status='void'` applies to cash, transfer and cheque paths):

1. restore invoice `amount_paid` / `remaining` by allocation net
2. `UPDATE ar_payment_allocations SET status = 'void'`
3. refresh invoice status (active allocations only)
4. reverse the payment JEs (`reverseJournalEntryAsync`, marks `is_reversed=1` + links reversal)
5. reverse the treasury 'in' transaction
6. mark the voucher `reversed`
7. `recalcCustomerBalanceAsync` (GL-referent)

After void, the invoice can be matched again from zero — no drift.

---

## 3. Discount rule

`net_amount = allocated_amount + discount_amount`.

A settlement discount is a **credit against SYS_AR** posted as its own JE attached to the **voucher** (not the invoice), so voiding the voucher reverses the discount in the same transaction. Validation: `allocated + discount` must not exceed the invoice's dynamic due.

---

## 4. Hard rules (copy into AP)

1. `ar_payment_allocations` is the only allocation source — legacy `customer_collections` / `collection_allocations` are never written.
2. Allocation rows are never physically deleted.
3. All consumers filter `status = 'active'`.
4. Customer balance is GL-derived, recomputed inside the same transaction as the event.
5. Every new phase must re-run: `verify_ar_phase2.js`, `tests/phase1/integration.js`, `integrity_audit.js`, and the manual promote scenario — confirm zero regression and `Allocations: 0`.
