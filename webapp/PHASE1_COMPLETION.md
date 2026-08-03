# Phase 1 — Freeze Point (Stable Baseline)

> **Tag/Branch:** `phase1-stable`
> **Date:** 2026-08-03
> **Status:** ✅ Complete & verified — 14/14 integration checks PASS, Integrity Audit gate = 6 known historical issues / 0 check errors.

---

## 1. Scope of Phase 1

Phase 1 = **ثبّت الأنبوب المحاسبي المركزي (Posting Pipeline)** بدون بيانات تشغيلية جديدة:

1. **إصلاح بذر الحسابات + العكس المحاسبي** في `services/accountingEngine.js`:
   - `isReversalAction` حارس يمنع عكس الوثائق غير القابلة للعكس.
   - `seedRequiredSystemAccountsAsync` يبني شجرة حسابات النظام (idempotent، بالمعاملات).
2. **إصلاح التعامل مع `req.params.id`** في `routes/sales.js` (catch يعيد `id` حقيقيًا بدل `undefined`).
3. **إصلاح عمود `total_difference` المفقود** في `stock_count`:
   - الكود كان يكتبه (`routes/inventory.js`) والواجهة تقرؤه (`viewInventoryManagement.js`) بينما لم يكن موجودًا في أي schema.
   - أُضيف `[total_difference] DECIMAL(18,2) DEFAULT 0` إلى الـ DB الحي + `schema.sql` + `schema_fixed.sql`.
4. **اختبارات تكامل Phase 1** (`tests/phase1/integration.js`) — 14 سيناريو:
   فاتورة بيع (إنشاء → تعديل → تعديل مرة أخرى → حذف → حذف مكرر ممنوع)، مرتجع بيع (إنشاء → عكس)، جرد (بدء → أصناف → إتمام → إلغاء)، تعديل مخزون (إتاحة → إلغاء)، توالف (إنشاء → إلغاء) — مع تحقق من GL + المخزون + رصيد العميل + سلسلة التدقيق في كل خطوة.

## 2. Verifications

### 2.1 Integration suite
```
node tests/phase1/integration.js   →  PASS 14/14
```
- كل سيناريو يتحقق عبر DB مباشرة (قيود نشطة، حركات مخزون، رصيد العميل، إجمالي GL للعميل).
- بعد كل تشغيل أُعيدت القاعدة لنفس الـ baseline: 27 قيدًا / 55 سطرًا / 8 حركات / 5 فواتير، أرصدة المخزون prod1=31، prod2=10، returns=0، counts=0، adjustments=0، damaged=0.

### 2.2 Integrity Audit (read-only gate)
```
node scripts/integrity_audit.js
```
**Total issues: 6   |   check errors: 0**
- **Subledger vs GL (3):** فروقات أرصدة العملاء C-0001 وC-0002 والفروق الفرعية بين الرصيد التشغيلي وGL.
- **COA / Trial Balance (2):** حساب 113 (العملاء) `490.2` مقابل GL `487.79` (فارق 2.41)؛ حساب 41 (إيرادات المبيعات) `9732.6` مقابل `9730.19` (فارق 2.41).
- **Inventory (1):** قيمة المخزون `7769.4` مقابل GL `7769.44` (فارق 0.04).

هذه فروقات **تاريخية** (قبل بداية المشروع) توثَّق فقط ولا تُلمس — هي أساس مرحلة GL-SSoT (Phase 2). التفصيل الكامل قابل لإعادة الإنتاج عبر الأمر أعلاه (`--json` لملف JSON).

## 3. Regression Protection (CI)

`/.github/workflows/phase1-regression.yml` — **GitHub Actions**، بدون deploy:
- قاعدة **SQL Server نظيفة** (container) + `scripts/ci_seed.js` يبني baseline متوافقًا مع التدقيق (0/0 على قاعدة نظيفة).
- يشغّل الخادم ثم `tests/phase1/integration.js` ثم `integrity_audit.js` كبوابة (خروج 1 عند أي مشكلة أو خطأ).
- يتفعّل تلقائيًا على أي تغيير في مسارات **Sales / Purchases / Inventory / Accounting / Treasury** (routes + services + schemas + migrations + tests) في PR أو push إلى main/develop/phase1-stable.

## 4. Phase 2 Preview (خارج نطاق هذا الثبات)

تحويل النظام إلى **GL as Single Source of Truth**:
1. كشوف العملاء/الموردين تُبنى من GL فقط (إزالة Cached Balances).
2. توحيد مصادر التقارير المالية (Trial Balance / Income / Balance Sheet).
3. توحيد Stock Ledger مع GL.
4. تجهيز **أداة Reconciliation نهائية** (تُعدّ ولا تُشغَّل حتى اكتمال كل المراحل والاعتماد — لا تُلمس بيانات الإنتاج).

---

## 5. How to reproduce / verify the freeze

```bash
git checkout phase1-stable
# backend
cd webapp/backend
npm install
npm run seed:ci        # CI baseline only (refuses on non-empty DB)
npm run test:phase1    # 14/14
npm run audit          # gate: 6 historical issues / 0 errors
```
