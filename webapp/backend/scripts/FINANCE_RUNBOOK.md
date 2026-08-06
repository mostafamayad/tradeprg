# Finance Adjustment Runbook

> Official operating document for executing any **finance-approved** accounting adjustment
> (ADR E1–E3) without breaking system balance. Follow top-to-bottom; ask Finance on any
> deviation. Read-only verification is mandatory — never skip it.
>
> Related scripts (all in `scripts/`):
> - `book_e2_inventory.js` — E2 opening-inventory reconciliation (Finance-gated, idempotent).
> - `process_cheque_e3.js` — E3 customer-cheque lifecycle: deposit/return/cancel (idempotent).
> - `post_adjustment_verification.js` — read-only verification report after any adjustment.
>
> Fiscal record of source decisions: `ACCOUNTING_DECISION_RECORD.md` (ADR E1–E3).

---

## Purpose

يوضح طريقة تنفيذ أي تعديل مالي معتمد دون كسر اتزان النظام. السكربتات الثلاثة مقسومة
(فصل المسؤوليات): E2 يسجّل القيد، E3 يدير دورة حياة الشيك، والتحقق يثبت أن النظام ما زال
متزنًا — **لا أحد منها يصلح شيئًا تلقائيًا**.

---

## Execution Order

### Step 1 — Finance Approval

Ensure a **Finance sign-off** exists on the ADR **before** any execution. Never start without it.

### Step 2 — Execute E2 (if required)

```bash
node scripts/book_e2_inventory.js --execute --approved
```

(Default `--dry-run` is read-only. Without `--approved` or `CONFIRM_FINANCE_APPROVAL=true`
the script aborts.)

### Step 3 — Execute E3 (if required)

```bash
node scripts/process_cheque_e3.js --cheque <id> --action <deposit|return|cancel> --execute --approved
```

- Example: `--cheque 38 --action return --execute --approved`.
- Idempotent: aborts if the cheque is already at the target terminal state.

### Step 4 — Verify (independent, read-only)

```bash
node scripts/post_adjustment_verification.js
```

Run by Finance or an independent reviewer — not by the execution script itself.

---

## Expected Result

```
OVERALL RESULT: PASS
```

If the report ends with:

```
OVERALL RESULT: FAILED
```

**it is prohibited** to proceed with any Migration or production deploy until the failing
checks are analyzed and closed.

---

## Safety Rules

* يمنع تعديل قاعدة البيانات يدويًا (Manual DB edits are forbidden).
* يمنع تشغيل أي سكربت بدون موافقة المالية (No script run without finance approval).
* يمنع تشغيل سكربت مرتين (Scripts are idempotent — double-execution is blocked).
* يمنع تجاوز مرحلة التحقق (Verification step cannot be skipped).

---

## Audit Trail

Any executed adjustment **must** leave an audit trail. Review it after execution:

| Artifact | Why | Example / Where |
|---|---|---|
| Journal Entry | balanced entry(s) | `journal_entries` + `journal_entry_lines` |
| Audit Log | who/what/when | `customer_activity_log`, activity logger |
| Reference Type | traceability key | `opening_inventory_reconciliation`, `ar_cheque` |
| Reference ID | links the JE to its source | E2 ref doc `ADR_E2`; E3 ref cheque id |
| ADR Reference | decision evidence | `ACCOUNTING_DECISION_RECORD.md` E2 / E3 |

---

## Production Checklist

Before any Deploy (tick each):

- [ ] ADR Approved
- [ ] E2 Executed (if required)
- [ ] E3 Executed (if required)
- [ ] `post_adjustment_verification` = PASS
- [ ] Integrity Audit = PASS
- [ ] Trial Balance = PASS
- [ ] GL Reconciliation = PASS
- [ ] Result signed off by Finance

---

> Failure of any production item above **blocks** migration and production promotion.