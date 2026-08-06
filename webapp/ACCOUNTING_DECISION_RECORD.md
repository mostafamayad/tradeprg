# Accounting Decision Record (ADR) — Integrity Exceptions E1–E3

> **Owner of decisions:** Finance / Chief Accountant (أخ).  **Status:** ⏳ **DRAFT — PENDING APPROVAL**.
> No compensating journal entry in this record is booked until a decision is signed below.
> Reference: `INTEGRITY_EXCEPTIONS.md` (baseline) · `PHASE4_AP_MIGRATION_PLAN.md` (hold gates).
> Baseline tag: `phase4-ap-complete`.

Context: the integrity audit is green except **4 items grouped into 3 decisions**. Each
decision is documented so no migration-time choice becomes ad‑hoc code.

---

## E1 — Operational‑Balance vs GL (customers C‑0001 & C‑0002)

### الحالة / الحالة الحالية
| Customer | `current_balance` | `gl_balance` (SYS_AR) | operational | diff_cur_gl |
|---|---|---|---|---|
| C‑0001 منير السيد علي | 1.60 | 1.60 | 0.80 | **0** |
| C‑0002 الحج متولي سعيد | −261.40 | −261.40 | −743.20 | **0** |

### لماذا يحدث الفرق
- `current_balance` == `gl_balance` (فرق 0) → عمود الرصيد متسق مع دفتر الأستاذ (GL).
- الفرق يظهر في **الرصيد التشغيلي** فقط: معادلة الرصيد التشغيلي
  (`opening + sales − returns − receipts − discounts`) تحتسب **سندات قبض شيكات غير مودعة**
  (مثل `ARP-0005` قيمة 400) كتحصيل، بينما دفتر الأستاذ لا يعكس الشيك إلا عند **الإيداع/التحصيل**.
  لذلك الرصيد التشغيلي يظهر أقل من GL بمقدار الشيكات غير المودعة لدى العميل.

### هل الـ GL هو SSOT أم التقرير التشغيلي؟
- **الـ GL هو المرجع (SSOT)** — مؤكد من `diff_cur_gl = 0` لكلا العميلين.
- التقرير التشغيلي (operational) أساس مختلف (نقدي/تشغيلي) — ليست SSOT.

### هل يبقى الفرق مقصودًا أم يُعدَّل التقرير؟
اختر أحد الخيارين (لا يتم الجمع بينهما):

- [ ] **A — إبقاء الأساس التشغيلي كما هو**: يبقى الفرق مقصودًا وموثّقًا (الشيكات تحت التحصيل
      تُعرض كبند منفصل "شيكات تحت التحصيل" بدل دمجها في الرصيد).
- [ ] **B — محاذاة التقرير التشغيلي مع GL**: يُستثنى من معادلة الرصيد التشغيلي أي سند قبض
      شيك `payment_method='check'` وليس `status='deposited'` حتى يتم التحصيل.

### القرار النهائي المعتمد (يملأه الفريق المالي)
> الخيار: `A / B` ……… التوقيع / التاريخ: ………………………… ملاحظات: ………………………………………………

---

## E2 — فرق تقييم المخزون (Inventory Valuation vs GL)

### مقدار الفرق الحالي
> **Dynamic amount:** the exact amount is computed at execution time by
> `book_e2_inventory.js`; figures below are a snapshot as of the preparation date (2026-08-07).
> **Never rely on the stale 3,414.77** — the live value moved to **3,831.76**.

| بند | قيمة (snapshot) |
|---|---|
| قيمة المخزون (كمية × تكلفة حسب التدقيق) | 9,893.26 |
| رصيد GL لـ `SYS_INVENTORY` (114) | 6,061.50 |
| **الفرق الحالي** | **3,831.76** |
| (مرجع سابق غير محدَّث — لا يُستخدم) | ~~9,476.27 ض 3,414.77~~ |

> ملاحظة: أرصدة الكميات متسقة (audit qty = PASS). الخلاف **قيمي فقط** (أساس التكلفة).
> قيد E2 يُنفذ دائمًا بمبلغ محسوب لايًا (live) عند التنفيذ، وليس بهذا الرقم المثبت.

### تحليل المصدر (يفحصه الفريق قبل الاختيار)
- [ ] **Opening Balance** — مخزون افتتاحي معرَّف في `products`/`inventory_balances` دون قيد
      افتتاحي في GL (الأنسب هنا: حسابات افتتاحية منسية، أرصدة = 0).
- [ ] **Cost Basis / WAC** — انحراف متوسط التكلفة المحسوب عن `cost_price` المستخدم في
      valuation (الفرق بين 9,476 و9,893 يشير لهذا).
- [ ] **Historical Posting** — أرصدة مخزون أدخلت سابقًا في GL ثم خُصمت بـ COGS دون سند
      متقابل، أو مشتريات لم تُرحَّل للـ GL أصلًا.

### الخيارات (اختر واحدًا، لا تُجمع)
| خيار | أثر على الميزانية | أثر على P&L | أثر على تكلفة المخزون | مناسب لو |
|---|---|---|---|---|
| **O1 — قيد تسوية واحد (مُوصى به)** | يرفع الأصل +3,414.77 / يرفع حقوق الملكية +3,414.77 | محايد (يُسجل في الأرباح المحتجزة لا في الإيراد) | يُحقق تطابق GL مع valuation | فجوة افتتاحية تاريخية |
| **O2 — إعادة تقييم الافتتاحية** | نفس أثر O1 لكن عبر إعادة إدخال أرصدة افتتاحية | محايد | نفس O1 | يُفضل توثيق الافتتاحية |
| **O3 — قبول الفرق كرصيد افتتاحي تاريخي (بلا قيد)** | بلا أثر | بلا أثر | يبقى GL أقل من valuation بشكل مقصود | عدم الرغبة في تعديل |

### القيد المحاسبي المقترح — عند اختيار O1 (Compensating Entry)
```
Dr  SYS_INVENTORY (114)     3,414.77     (زيادة قيمة المخزون)
    Cr SYS_RETAINED_EARNINGS (32)     3,414.77   (تسوية افتتاحية — محايدة للـ P&L)
```
- **بديل** إن أثبت الفريق أن الفرق مشتريات جارية غير مرحلة: `Cr SYS_AP (211)` بدل الأرباح المحتجزة.
- ينفَّذ **بعد** الموافقة، من خلال محرك `accountingEngine` (قيد نظامي مع مرجع
  `reference_type='inventory_opening_adjustment'` وقابل للعكس).

### القرار النهائي المعتمد (يملأه الفريق المالي)
> الخيار: `O1 / O2 / O3` ……… تاريخ التنفيذ المقترح: ……… التوقيع: …………………………

---

## E3 — شيك عميل ARP‑0005 (قيمة 400)

### الحالة الحالية (snapshot 2026-08-07)
- سند قبض `ARP-0005` (ar_payments id 1021) — العميل C‑0002 — `payment_method='check'` — `status='active'`.
- شيك مرتبط: رقم **34568** (ar_cheques id 38) — `amount=400` — `status='received'` (لم يودَع بعد).
- تخصيص أحد: `alloc id 2022` يُحوِّل صافي **70** فقط إلى `INV-0003` (grand 220, paid 208.2, remaining 11.8, partial).
- الرصيد: لا يوجد **JE** له حاليًا (الشيك لم يُودَع). في مخزون الشيكات: "شيكات تحت التحصيل" (`SYS_AR_CHEQUES` 117).

### دورة الحياة الصحيحة للشيك (AR)
| المرحلة | السجل | القيد |
|---|---|---|
| استلام الشيك (قبض check) | سند قبض فقط — بلا JE حتى الإيداع | — (مقصود، سلوك حالي) |
| **الإيداع/التحصيل** | `status='deposited'` + سند خزينة | `Dr SYS_AR_CHEQUES (117) / Cr SYS_AR (113)` بمبلغ الشيك |
| **ارتداد (bounce)** | `status='returned'` | عكس الإيداع إن وُجد: `Dr SYS_AR (113) / Cr SYS_AR_CHEQUES (117)` + إلغاء تخصيصات الدفعة + إعادة فتح الفاتورة + عزل الدفعة |
| **إلغاء/خالص** | soft‑reverse كـ `cancelled` | لا قيد (لم يُودَع): فقط إلغاء التخصيصات + إعادة فتح الفاتورة + عزل الدفعة |
| إغلاق السند نهائيًا | `status='deposited'` → `collected` | `Dr SYS_BANK / Cr SYS_AR_CHEQUES` (خارج نطاق سكربت E3) |
  
> **تنفيذ الدورة** يعتمد موثة: `scripts/process_cheque_e3.js --cheque 38 --action deposit|return|cancel --dry-run` (افتراضي) / **`--execute --approved`** (Finance-Gated, Idempotent، Transaction، Rollback).

### هل غياب الـ JE سلوك مقصود أم يحتاج تغييرًا؟
- **مقصود ومتسق مع محرك AR**: الشيك لا يدخل دفتر الأستاذ إلا عند الإيداع/التحصيل.
  التقرير التشغيلي وحده يعرضه (شرح E1). **لا حاجة لتغيير الكود**.
- **إجراء مطلوب**: على الخزينة اختيار إحدى المسارات (Deposit/Return/Cancel) عبر سكربت E3.

### القرار النهائي المعتمد (يملأه الفريق المالي)
> إيداع / ارتداد / إلغاء: …… (المسار: deposit / return / cancel) ……… تاريخ المعالجة: ……… التوقيع: ………………

---

## Acceptance checklist (before any migration on TradeProCI)
- [ ] E1 signed (A or B).
- [ ] E2 signed (O1/O2/O3) + JE booked (if O1/O2) with `INTEGRITY_EXCEPTIONS.md` updated to reflect the closed diff.
- [ ] E3 signed + treasury processed the cheque.
- [ ] Re-run `integrity_audit`, `verify_ap_phase4`, `regression` → expect **0 open issues** (or only signed exceptions).
- [ ] Only then: proceed with the migration plan on `TradeProCI`.