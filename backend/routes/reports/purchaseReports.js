const router = require('express').Router();
const asyncHandler = require('../../utils/asyncHandler');
const { num, loadCompanyData, escapeHtml, validatePagination, applyDateFilter, getSysAccId, getPool, sql, SYS_SALES, SYS_SALES_RETURNS, SYS_AR, SYS_AP, SYS_VAT_OUTPUT, SYS_VAT_INPUT, SYS_COGS, SYS_PURCHASES, SYS_PURCHASE_RETURNS, SYS_INVENTORY, SYS_INVENTORY_SHORTAGE } = require('./shared');
const { parsePagination, buildPaginationResponse } = require('../../middleware/pagination');
// â”€â”€ Purchase Invoice Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/purchase-invoice/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const invRes = await rq.query(`SELECT i.*, s.supplier_name, s.phone, s.address,
                                          st.store_name
                                   FROM purchase_invoices i
                                   LEFT JOIN suppliers s ON i.supplier_id = s.id
                                   LEFT JOIN stores st ON i.store_id = st.id
                                   WHERE i.id = @id`);
    const invoice = invRes.recordset[0];
    if (!invoice) return res.status(404).send('الفاتورة غير موجودة');

    const itemsRes = await rq.query(`SELECT ii.*, p.product_name, p.product_code, p.unit_name
                                     FROM purchase_invoice_items ii
                                     LEFT JOIN products p ON ii.product_id = p.id
                                     WHERE ii.invoice_id = @id`);
    const items = itemsRes.recordset;

    const company = await loadCompanyData(rq);

    const subtotal     = Number(invoice.subtotal) || 0;
    const discount     = Number(invoice.discount_amount) || 0;
    const tax          = Number(invoice.tax_amount) || 0;
    const grand_total  = Number(invoice.grand_total) || 0;
    const amount_paid  = Number(invoice.amount_paid) || 0;
    const remaining    = Number(invoice.remaining != null ? invoice.remaining : (grand_total - amount_paid));
    const isCancelled  = invoice.status === 'cancelled' || invoice.status === 'deleted';

    const paymentMethodLabel =
      invoice.payment_type === 'cash'   ? 'نقدي' :
      invoice.payment_type === 'credit' ? 'آجل'  :
      invoice.payment_type === 'bank'   ? 'تحويل بنكي' :
      invoice.payment_type === 'check'  ? 'شيك' : (invoice.payment_type || '-');

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return escapeHtml(v); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة مشتريات ${e(invoice.invoice_no)}</title>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Cairo',sans-serif;color:#1f2937;margin:0;padding:12px;background:#f3f4f6;font-size:12px;line-height:1.4;}
  .page{max-width:850px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
  .header{display:grid;grid-template-columns:1.4fr 1fr;padding:14px 18px;border-bottom:1px solid #e5e7eb;gap:14px;align-items:center;}
  .header-left{display:flex;gap:10px;align-items:center;}
  .logo-box{width:44px;height:44px;background:#1f2937;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0;}
  .company-name{font-size:18px;font-weight:900;color:#1f2937;margin-bottom:2px;line-height:1.2;}
  .company-tag{font-size:11px;color:#6b7280;margin-bottom:4px;}
  .contact-list{font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;}
  .contact-row{display:flex;align-items:center;gap:5px;color:#4b5563;}
  .contact-row i{color:#9ca3af;width:12px;font-size:10px;}
  .header-right{text-align:left;}
  .invoice-title{font-size:18px;font-weight:900;color:#1f2937;line-height:1.2;}
  .invoice-title-en{font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:6px;}
  .invoice-number-box{background:#1f2937;color:#fff;padding:8px 12px;border-radius:6px;display:inline-block;min-width:160px;text-align:center;}
  .invoice-number-label{font-size:10px;opacity:0.7;margin-bottom:2px;}
  .invoice-number-value{font-size:18px;font-weight:900;letter-spacing:1px;}
  .meta-boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 18px;border-bottom:1px solid #e5e7eb;background:#fafafa;}
  .meta-box{display:flex;align-items:center;gap:8px;padding:4px 8px;}
  .meta-box .icon-wrap{width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#4b5563;font-size:11px;flex-shrink:0;}
  .meta-box .meta-text{text-align:right;flex:1;min-width:0;}
  .meta-box .lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.2px;line-height:1.2;}
  .meta-box .val{font-size:12px;font-weight:800;color:#1f2937;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .info-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 18px;}
  .info-card{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}
  .info-card-header{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#1f2937;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .info-card-header i{color:#9ca3af;font-size:11px;}
  .info-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:2px 0;gap:8px;}
  .info-row .lbl{color:#6b7280;flex-shrink:0;}
  .info-row .val{color:#1f2937;font-weight:600;text-align:left;overflow:hidden;text-overflow:ellipsis;}
  .items-section{padding:0 18px 10px;}
  .section-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#fff;margin:0 0 6px 0;padding:5px 10px;background:#1f2937;border-radius:4px;width:fit-content;}
  .section-title i{font-size:10px;}
  .items-table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;}
  .items-table thead th{background:#f3f4f6;color:#374151;padding:6px 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.2px;text-align:center;border-bottom:1px solid #d1d5db;}
  .items-table tbody td{padding:7px 4px;font-size:11px;text-align:center;border-bottom:1px solid #f3f4f6;}
  .items-table tbody tr:last-child td{border-bottom:none;}
  .item-name-cell{text-align:right;font-weight:700;}
  .totals-section{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;padding:0 18px 10px;}
  .totals-side-col{display:flex;flex-direction:column;gap:6px;}
  .totals-side-card{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:center;}
  .totals-side-card .ts-head{font-size:10px;color:#6b7280;margin-bottom:2px;}
  .totals-side-card .ts-big{font-size:15px;font-weight:900;color:#1f2937;}
  .summary-table{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;}
  .summary-table table{width:100%;border-collapse:collapse;}
  .summary-table td{padding:5px 12px;font-size:11px;border-bottom:1px solid #f3f4f6;}
  .summary-table tr:last-child td{border-bottom:none;}
  .summary-table td:first-child{color:#6b7280;}
  .summary-table td:last-child{font-weight:700;color:#1f2937;text-align:left;}
  .summary-table tr.grand td{background:#1f2937;color:#fff;font-size:12px;font-weight:900;padding:8px 12px;}
  .summary-table tr.grand td:first-child{color:#fff;}
  .footer{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:10px 18px;border-top:1px solid #e5e7eb;}
  .footer-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;}
  .footer-card h4{margin:0 0 5px 0;font-size:11px;font-weight:800;display:flex;align-items:center;gap:5px;color:#1f2937;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .footer-card h4 i{color:#9ca3af;font-size:10px;}
  .footer-card ul{margin:0;padding-right:14px;font-size:10px;color:#4b5563;line-height:1.6;}
  .bottom-bar{background:#1f2937;color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:8px;}
  .bottom-bar>div{display:flex;align-items:center;gap:5px;}
  .bottom-bar i{color:#9ca3af;font-size:11px;}
  .bottom-bar span{opacity:0.95;}
  .no-print{max-width:850px;margin:0 auto 8px;text-align:center;}
  .no-print button{padding:8px 24px;background:#1f2937;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;}
  @page{size:A4;margin:6mm;}
  @media print{body{padding:0;background:#fff!important;font-size:11px;}.page{box-shadow:none;border:none;max-width:100%;}.no-print{display:none!important;}}
  .cancelled-stamp{text-align:center;padding:18px 14px;margin:14px 18px;border:3px double #dc2626;border-radius:8px;background:#fef2f2;}
  .cancelled-stamp .cs-text{font-size:28px;font-weight:900;color:#dc2626;letter-spacing:4px;line-height:1;}
  .cancelled-stamp .cs-sub{font-size:12px;color:#dc2626;margin-top:6px;font-weight:700;}
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة فاتورة المشتريات</button></div>
<div class="page">
<div class="header">
  <div class="header-left">
    ${company.logo ? '<img src="' + e(company.logo) + '" style="width:60px;height:60px;object-fit:contain;border-radius:8px;">' : '<div class="logo-box"><span>' + e((company.company_name||'T').charAt(0)) + '</span></div>'}
    <div><div class="company-name">${e(company.company_name||'')}</div>
    <div class="company-tag">${e(company.company_activity||'')}</div>
    <div class="contact-list">
      <div class="contact-row"><i class="fa-solid fa-phone"></i> <span>${e(company.company_phone||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-envelope"></i> <span>${e(company.company_email||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-mobile-screen"></i> <span>${e(company.mobile||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-globe"></i> <span>${e(company.website||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-location-dot"></i> <span>${e(company.company_address||'')}${company.city ? ' - ' + e(company.city) : ''}${company.country ? ' - ' + e(company.country) : ''}</span></div>
      <div class="contact-row"><i class="fa-solid fa-hashtag"></i> <span>${e(company.tax_number||'')}${company.cr_no ? ' | سجل تجاري: ' + e(company.cr_no) : ''}</span></div>
    </div></div>
  </div>
  <div class="header-right">
    <div class="invoice-title">فاتورة مشتريات</div>
    <div class="invoice-title-en">PURCHASE INVOICE</div>
    <div class="invoice-number-box">
      <div class="invoice-number-label">رقم الفاتورة</div>
      <div class="invoice-number-value">${e(invoice.invoice_no)}</div>
    </div>
  </div>
</div>

<div class="meta-boxes">
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar"></i></div>
    <div class="meta-text"><div class="lbl">التاريخ</div><div class="val">${e(invoice.invoice_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar-check"></i></div>
    <div class="meta-text"><div class="lbl">تاريخ الاستحقاق</div><div class="val">${e(invoice.due_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-credit-card"></i></div>
    <div class="meta-text"><div class="lbl">طريقة الدفع</div><div class="val">${paymentMethodLabel}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-warehouse"></i></div>
    <div class="meta-text"><div class="lbl">المخزن</div><div class="val">${e(invoice.store_name||'')}</div></div>
  </div>
</div>

<div class="info-cards">
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-truck"></i> بيانات المورد</div>
    <div class="info-row"><span class="lbl">الاسم</span><span class="val">${e(invoice.supplier_name||'-')}</span></div>
    <div class="info-row"><span class="lbl">الهاتف</span><span class="val">${e(invoice.phone||'-')}</span></div>
    <div class="info-row"><span class="lbl">العنوان</span><span class="val">${e(invoice.address||'-')}</span></div>
    <div class="info-row"><span class="lbl">الرقم الضريبي</span><span class="val">${e(invoice.tax_number||'-')}</span></div>
  </div>
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-file-invoice"></i> بيانات الفاتورة</div>
    <div class="info-row"><span class="lbl">رقم فاتورة المورد</span><span class="val">${e(invoice.supplier_invoice_no||'-')}</span></div>
    <div class="info-row"><span class="lbl">الط­الط©</span><span class="val">${isCancelled ? 'ملغاة' : 'مسجلة'}</span></div>
    <div class="info-row"><span class="lbl">الالمبلغ المدفوع</span><span class="val" style="color:#059669;">${money(amount_paid)}</span></div>
    <div class="info-row"><span class="lbl">المتبقي</span><span class="val" style="color:${remaining > 0 ? '#dc2626' : '#059669'};">${money(remaining)}</span></div>
  </div>
</div>

<div class="items-section">
  <div class="section-title"><i class="fa-solid fa-box"></i> الأصناف الفاتورة</div>
  <table class="items-table">
    <thead><tr>
      <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر التكلفة</th><th>الإجمالي</th>
    </tr></thead>
    <tbody>
      ${items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="item-name-cell">${e(item.product_name)}<br><small style="color:#9ca3af;font-size:9px;">${e(item.product_code||'')}</small></td>
        <td>${e(item.unit_name||'-')}</td>
        <td>${Number(item.quantity).toLocaleString()}</td>
        <td>${money(item.cost_price)}</td>
        <td>${money(item.line_total || (item.quantity * item.cost_price))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="totals-section">
  <div class="totals-side-col">
    <div class="totals-side-card">
      <div class="ts-head">إجمالي الأصناف</div>
      <div class="ts-big">${money(subtotal)}</div>
    </div>
    <div class="totals-side-card">
      <div class="ts-head">ط¹ط¯ط¯ الأصناف</div>
      <div class="ts-big">${items.length}</div>
    </div>
  </div>
  <div class="summary-table">
    <table>
      <tr><td>إجمالي الأصناف</td><td>${money(subtotal)}</td></tr>
      ${discount ? `<tr><td>الخصم</td><td style="color:#dc2626;">-${money(discount)}</td></tr>` : ''}
      ${tax ? `<tr><td>ضريبة القيمة المضافة</td><td style="color:#059669;">+${money(tax)}</td></tr>` : ''}
      <tr class="grand"><td>الإجمالي النهائي</td><td>${money(grand_total)}</td></tr>
    </table>
  </div>
</div>

${isCancelled ? `<div class="cancelled-stamp"><div class="cs-text">ملغاة</div><div class="cs-sub">هذا الفاتورة ملغاة ولم يعد لها أي اعتبار</div></div>` : ''}

<div class="footer">
  <div class="footer-card">
    <h4><i class="fa-solid fa-message"></i> ملاحظات</h4>
    <div style="font-size:11px;color:#4b5563;min-height:40px;">${e(invoice.notes||'لا توجد ملاحظات')}</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-signature"></i> توقيع</h4>
    <div class="signature-line"></div>
    <div class="signature-text">المورد / الالمستلم</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-barcode"></i> QR</h4>
    <div style="font-size:9px;color:#6b7280;margin-top:4px;">${e(invoice.invoice_no)}</div>
  </div>
</div>

<div class="bottom-bar">
  <div><i class="fa-regular fa-copyright"></i> <span>${e(company.company_name||'')}</span></div>
  <div><i class="fa-solid fa-print"></i> <span>تمت الطباعة: ${new Date().toLocaleString('ar-EG')}</span></div>
  <div><i class="fa-solid fa-hashtag"></i> <span>فاتورة مشتريات رقم ${e(invoice.invoice_no)}</span></div>
</div>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Purchase invoice print error:', err);
    res.status(500).send('خطأ في طباعة فاتورة المشتريات');
  }
}));

// â”€â”€ Purchase Return Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/purchase-return/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const retRes = await rq.query(`
      SELECT pr.*, s.supplier_name, s.phone, s.address,
             pi.invoice_no as original_invoice_no, pi.invoice_date as original_invoice_date,
             st.store_name, rr.label_ar AS reason_name
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN purchase_invoices pi ON pr.invoice_id = pi.id
      LEFT JOIN stores st ON pr.store_id = st.id
      LEFT JOIN return_reasons rr ON pr.return_reason = rr.code
      WHERE pr.id = @id`);
    const pret = retRes.recordset[0];
    if (!pret) return res.status(404).send('المرتجع غير موجود');

    const itemsRes = await rq.query(`
      SELECT pri.*, p.product_name, p.product_code, p.unit_name
      FROM purchase_return_items pri
      LEFT JOIN products p ON pri.product_id = p.id
      WHERE pri.return_id = @id`);
    const items = itemsRes.recordset;

    const company = await loadCompanyData(rq);

    // Fetch creator user name
    let createdByName = '—';
    if (pret.created_by) {
        try {
            rq.input('cbId', sql.Int, pret.created_by);
            const uRes = await rq.query(`SELECT full_name FROM users WHERE id = @cbId`);
            if (uRes.recordset[0]) createdByName = uRes.recordset[0].full_name;
        } catch(e) {}
    }

    const subtotal = Number(pret.subtotal) || 0;
    const discount = Number(pret.discount_amount) || 0;
    const tax = Number(pret.tax_amount) || 0;
    const grand_total = Number(pret.grand_total) || 0;
    const isCancelled = pret.status === 'cancelled' || pret.status === 'deleted';

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return escapeHtml(v); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>مرتجع مشتريات ${e(pret.return_no)}</title>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');
  *{box-sizing:border-box;}
  body{font-family:'Cairo',sans-serif;color:#1f2937;margin:0;padding:12px;background:#f3f4f6;font-size:12px;line-height:1.4;}
  .page{max-width:850px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
  .header{display:grid;grid-template-columns:1.4fr 1fr;padding:14px 18px;border-bottom:1px solid #e5e7eb;gap:14px;align-items:center;}
  .header-left{display:flex;gap:10px;align-items:center;}
  .logo-box{width:44px;height:44px;background:#1f2937;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:900;flex-shrink:0;}
  .company-name{font-size:18px;font-weight:900;color:#1f2937;margin-bottom:2px;line-height:1.2;}
  .company-tag{font-size:11px;color:#6b7280;margin-bottom:4px;}
  .contact-list{font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;}
  .contact-row{display:flex;align-items:center;gap:5px;color:#4b5563;}
  .contact-row i{color:#9ca3af;width:12px;font-size:10px;}
  .header-right{text-align:left;}
  .invoice-title{font-size:18px;font-weight:900;color:#1f2937;line-height:1.2;}
  .invoice-title-en{font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:6px;}
  .invoice-number-box{background:#dc2626;color:#fff;padding:8px 12px;border-radius:6px;display:inline-block;min-width:160px;text-align:center;}
  .invoice-number-label{font-size:10px;opacity:0.7;margin-bottom:2px;}
  .invoice-number-value{font-size:18px;font-weight:900;letter-spacing:1px;}
  .meta-boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px 18px;border-bottom:1px solid #e5e7eb;background:#fafafa;}
  .meta-box{display:flex;align-items:center;gap:8px;padding:4px 8px;}
  .meta-box .icon-wrap{width:26px;height:26px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#4b5563;font-size:11px;flex-shrink:0;}
  .meta-box .meta-text{text-align:right;flex:1;min-width:0;}
  .meta-box .lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:0.2px;line-height:1.2;}
  .meta-box .val{font-size:12px;font-weight:800;color:#1f2937;line-height:1.3;}
  .info-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 18px;}
  .info-card{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;}
  .info-card-header{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#1f2937;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .info-card-header i{color:#9ca3af;font-size:11px;}
  .info-row{display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:2px 0;gap:8px;}
  .info-row .lbl{color:#6b7280;flex-shrink:0;}
  .info-row .val{color:#1f2937;font-weight:600;text-align:left;overflow:hidden;text-overflow:ellipsis;}
  .items-section{padding:0 18px 10px;}
  .section-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#fff;margin:0 0 6px 0;padding:5px 10px;background:#dc2626;border-radius:4px;width:fit-content;}
  .section-title i{font-size:10px;}
  .items-table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;}
  .items-table thead th{background:#f3f4f6;color:#374151;padding:6px 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.2px;text-align:center;border-bottom:1px solid #d1d5db;}
  .items-table tbody td{padding:7px 4px;font-size:11px;text-align:center;border-bottom:1px solid #f3f4f6;}
  .items-table tbody tr:last-child td{border-bottom:none;}
  .item-name-cell{text-align:right;font-weight:700;}
  .totals-section{display:grid;grid-template-columns:1fr 1.4fr;gap:8px;padding:0 18px 10px;}
  .totals-side-col{display:flex;flex-direction:column;gap:6px;}
  .totals-side-card{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:center;}
  .totals-side-card .ts-head{font-size:10px;color:#6b7280;margin-bottom:2px;}
  .totals-side-card .ts-big{font-size:15px;font-weight:900;color:#1f2937;}
  .summary-table{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;}
  .summary-table table{width:100%;border-collapse:collapse;}
  .summary-table td{padding:5px 12px;font-size:11px;border-bottom:1px solid #f3f4f6;}
  .summary-table tr:last-child td{border-bottom:none;}
  .summary-table td:first-child{color:#6b7280;}
  .summary-table td:last-child{font-weight:700;color:#1f2937;text-align:left;}
  .summary-table tr.grand td{background:#dc2626;color:#fff;font-size:12px;font-weight:900;padding:8px 12px;}
  .summary-table tr.grand td:first-child{color:#fff;}
  .footer{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;padding:10px 18px;border-top:1px solid #e5e7eb;}
  .footer-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;}
  .footer-card h4{margin:0 0 5px 0;font-size:11px;font-weight:800;display:flex;align-items:center;gap:5px;color:#1f2937;padding-bottom:4px;border-bottom:1px solid #f3f4f6;}
  .footer-card h4 i{color:#9ca3af;font-size:10px;}
  .bottom-bar{background:#dc2626;color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:8px;}
  .bottom-bar>div{display:flex;align-items:center;gap:5px;}
  .bottom-bar i{color:#fca5a5;font-size:11px;}
  .bottom-bar span{opacity:0.95;}
  .no-print{max-width:850px;margin:0 auto 8px;text-align:center;}
  .no-print button{padding:8px 24px;background:#1f2937;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;}
  @page{size:A4;margin:6mm;}
  @media print{body{padding:0;background:#fff!important;font-size:11px;}.page{box-shadow:none;border:none;max-width:100%;}.no-print{display:none!important;}}
  .cancelled-stamp{text-align:center;padding:18px 14px;margin:14px 18px;border:3px double #dc2626;border-radius:8px;background:#fef2f2;}
  .cancelled-stamp .cs-text{font-size:28px;font-weight:900;color:#dc2626;letter-spacing:4px;line-height:1;}
  .cancelled-stamp .cs-sub{font-size:12px;color:#dc2626;margin-top:6px;font-weight:700;}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:900;color:rgba(220,38,38,0.06);pointer-events:none;z-index:0;letter-spacing:10px;}
  .audit-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 18px;border-top:1px solid #e5e7eb;background:#fafafa;font-size:10px;}
  .audit-item{display:flex;align-items:center;gap:4px;color:#6b7280;}
  .audit-item i{color:#9ca3af;font-size:9px;}
  .audit-item .audit-val{font-weight:700;color:#374151;}
  .source-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;}
  .source-badge.invoice{background:#dbeafe;color:#1e40af;}
  .source-badge.manual{background:#fef3c7;color:#92400e;}
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة مرتجع المشتريات</button></div>
<div class="page">
<div class="watermark">ORIGINAL</div>
<div class="header">
  <div class="header-left">
    ${company.logo ? '<img src="' + e(company.logo) + '" style="width:60px;height:60px;object-fit:contain;border-radius:8px;">' : '<div class="logo-box"><span>' + e((company.company_name||'T').charAt(0)) + '</span></div>'}
    <div><div class="company-name">${e(company.company_name||'')}</div>
    <div class="company-tag">${e(company.company_activity||'')}</div>
    <div class="contact-list">
      <div class="contact-row"><i class="fa-solid fa-phone"></i> <span>${e(company.company_phone||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-envelope"></i> <span>${e(company.company_email||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-mobile-screen"></i> <span>${e(company.mobile||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-globe"></i> <span>${e(company.website||'')}</span></div>
      <div class="contact-row"><i class="fa-solid fa-location-dot"></i> <span>${e(company.company_address||'')}${company.city ? ' - ' + e(company.city) : ''}${company.country ? ' - ' + e(company.country) : ''}</span></div>
      <div class="contact-row"><i class="fa-solid fa-hashtag"></i> <span>${e(company.tax_number||'')}${company.cr_no ? ' | سجل تجاري: ' + e(company.cr_no) : ''}</span></div>
    </div></div>
  </div>
  <div class="header-right">
    <div class="invoice-title">مرتجع مشتريات</div>
    <div class="invoice-title-en">PURCHASE RETURN</div>
    <div class="invoice-number-box">
      <div class="invoice-number-label">رقم المرتجع</div>
      <div class="invoice-number-value">${e(pret.return_no)}</div>
    </div>
  </div>
</div>

<div class="meta-boxes">
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-calendar"></i></div>
    <div class="meta-text"><div class="lbl">التاريخ</div><div class="val">${e(pret.return_date||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-file-invoice"></i></div>
    <div class="meta-text"><div class="lbl">الفاتورة الأصلية</div><div class="val">${e(pret.original_invoice_no||'-')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-warehouse"></i></div>
    <div class="meta-text"><div class="lbl">المخزن</div><div class="val">${e(pret.store_name||'')}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-info-circle"></i></div>
    <div class="meta-text"><div class="lbl">الحالة</div><div class="val">${isCancelled ? 'ملغي' : 'نشط'}</div></div>
  </div>
  <div class="meta-box">
    <div class="icon-wrap"><i class="fa-solid fa-tag"></i></div>
    <div class="meta-text"><div class="lbl">النوع</div><div class="val"><span class="source-badge ${pret.source_type || 'invoice'}">${pret.source_type === 'manual' ? 'مرتجع يدوي' : 'مرتبط بفاتورة'}</span></div></div>
  </div>
  ${pret.reason_name ? `<div class="meta-box"><div class="icon-wrap"><i class="fa-solid fa-circle-question"></i></div><div class="meta-text"><div class="lbl">السبب</div><div class="val">${e(pret.reason_name)}</div></div></div>` : ''}
</div>
</div>

<div class="info-cards">
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-truck"></i> بيانات المورد</div>
    <div class="info-row"><span class="lbl">الاسم</span><span class="val">${e(pret.supplier_name||'-')}</span></div>
    <div class="info-row"><span class="lbl">الهاتف</span><span class="val">${e(pret.phone||'-')}</span></div>
    <div class="info-row"><span class="lbl">العنوان</span><span class="val">${e(pret.address||'-')}</span></div>
  </div>
  <div class="info-card">
    <div class="info-card-header"><i class="fa-solid fa-file-invoice"></i> بيانات المرتجع</div>
    <div class="info-row"><span class="lbl">الفاتورة الأصلية</span><span class="val">${e(pret.original_invoice_no||'-')}</span></div>
    <div class="info-row"><span class="lbl">تاريخ الفاتورة</span><span class="val">${e(pret.original_invoice_date||'-')}</span></div>
    <div class="info-row"><span class="lbl">ملاحظات</span><span class="val">${e(pret.notes||'-')}</span></div>
  </div>
</div>

<div class="items-section">
  <div class="section-title"><i class="fa-solid fa-box"></i> الأصناف المرتجعط©</div>
  <table class="items-table">
    <thead><tr>
      <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر التكلفة</th><th>الإجمالي</th>
    </tr></thead>
    <tbody>
      ${items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="item-name-cell">${e(item.product_name)}<br><small style="color:#9ca3af;font-size:9px;">${e(item.product_code||'')}</small></td>
        <td>${e(item.unit_name||'-')}</td>
        <td>${Number(item.quantity).toLocaleString()}</td>
        <td>${money(item.cost_price)}</td>
        <td>${money(item.line_total || (item.quantity * item.cost_price))}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="totals-section">
  <div class="totals-side-col">
    <div class="totals-side-card">
      <div class="ts-head">ط¹ط¯ط¯ الأصناف</div>
      <div class="ts-big">${items.length}</div>
    </div>
  </div>
  <div class="summary-table">
    <table>
      <tr><td>إجمالي الأصناف</td><td>${money(subtotal)}</td></tr>
      ${discount ? `<tr><td>الخصم</td><td style="color:#dc2626;">-${money(discount)}</td></tr>` : ''}
      ${tax ? `<tr><td>ضريبة القيمة المضافة</td><td style="color:#059669;">+${money(tax)}</td></tr>` : ''}
      <tr class="grand"><td>إجمالي المرتجع</td><td>${money(grand_total)}</td></tr>
    </table>
  </div>
</div>

${isCancelled ? `<div class="cancelled-stamp"><div class="cs-text">ملغي</div><div class="cs-sub">هذا المرتجع ملغي وليس له أي اعتبار</div></div>` : ''}

<div class="audit-bar">
  <div class="audit-item"><i class="fa-solid fa-user-plus"></i> أنشأه: <span class="audit-val">${e(createdByName)}</span></div>
  <div class="audit-item"><i class="fa-solid fa-print"></i> طُبع بواسطة: <span class="audit-val">${e(req.user?.full_name || 'المستخدم الحالي')}</span></div>
  <div class="audit-item"><i class="fa-solid fa-clock"></i> وقت الطباعة: <span class="audit-val">${new Date().toLocaleString('ar-EG')}</span></div>
</div>

<div class="footer">
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-user-check"></i> تم الإنشاء بواسطة</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(createdByName)}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-stamp"></i> تم الاعتماد بواسطة</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(createdByName)}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع</div>
  </div>
  <div class="footer-card" style="text-align:center;">
    <h4><i class="fa-solid fa-truck"></i> استلم المورد</h4>
    <div style="font-size:11px;font-weight:700;color:#1f2937;padding:6px 0;">${e(pret.supplier_name||'')}</div>
    <div class="signature-line"></div>
    <div class="signature-text">التوقيع والختم</div>
  </div>
</div>

<div class="bottom-bar">
  <div><i class="fa-regular fa-copyright"></i> <span>${e(company.company_name||'')}</span></div>
  <div><i class="fa-solid fa-print"></i> <span>تمت الطباعة: ${new Date().toLocaleString('ar-EG')}</span></div>
  <div><i class="fa-solid fa-hashtag"></i> <span>مرتجع مشتريات رقم ${e(pret.return_no)}</span></div>
</div>
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Purchase return print error:', err);
    res.status(500).send('خطأ في طباعة مرتجع المشتريات');
  }
}));

// â”€â”€ Supplier Payment Print â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/payment/:id/print', asyncHandler(async (req, res) => {
  try {
    const pool = await getPool();
    const rq = pool.request();
    rq.input('id', sql.Int, req.params.id);

    const payRes = await rq.query(`SELECT sp.*, s.supplier_name, s.phone, s.address
                                   FROM supplier_payments sp
                                   LEFT JOIN suppliers s ON sp.supplier_id = s.id
                                   WHERE sp.id = @id`);
    const pay = payRes.recordset[0];
    if (!pay) return res.status(404).send('السند غير موجود');

    const allocRes = await rq.query(`SELECT spa.*, pi.invoice_no
                                     FROM supplier_payment_allocations spa
                                     LEFT JOIN purchase_invoices pi ON spa.invoice_id = pi.id
                                     WHERE spa.payment_id = @id`);
    const allocs = allocRes.recordset;

    const company = await loadCompanyData(rq);

    const amount = Number(pay.amount) || 0;
    const methodLabel = pay.payment_method === 'cash' ? 'نقدي' : pay.payment_method === 'check' ? 'شيك' : 'تحويل بنكي';

    function money(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function e(v) { return (v != null ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>سند صرف - ${e(pay.payment_no)}</title>
<style>
@page { margin: 8mm; size: A4 portrait; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Cairo', Tahoma, sans-serif; color:#1e293b; background:#fff; padding:20px; font-size:13px; }
.print-header { text-align:center; border-bottom:2px solid #1e3a8a; padding-bottom:12px; margin-bottom:20px; }
.print-header h1 { font-size:20px; color:#1e3a8a; margin-bottom:4px; }
.print-header .sub { font-size:11px; color:#64748b; }
.invoice-title { text-align:center; margin:16px 0; font-size:16px; font-weight:700; color:#1e3a8a; border:1px solid #e2e8f0; display:inline-block; padding:6px 28px; border-radius:6px; background:#f8fafc; width:100%; }
.info-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 30px; padding:14px; background:#f8fafc; border-radius:6px; margin-bottom:14px; border:1px solid #e2e8f0; }
.info-grid > div { padding:3px 0; }
.info-grid strong { color:#475569; }
.data-table { width:100%; border-collapse:collapse; margin:10px 0; }
.data-table th { background:#1e3a8a; color:#fff; padding:8px 10px; font-size:12px; text-align:center; }
.data-table td { padding:8px 10px; text-align:center; border-bottom:1px solid #e2e8f0; font-size:12px; }
.data-table tr:nth-child(even) td { background:#f8fafc; }
.totals { margin-top:16px; padding:12px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; text-align:center; }
.totals .amount { font-size:20px; font-weight:700; color:#dc2626; }
.notes { margin-top:12px; padding:10px; background:#fef3c7; border-radius:6px; font-size:12px; }
.footer { margin-top:24px; display:flex; justify-content:space-between; padding-top:12px; border-top:1px solid #e2e8f0; font-size:11px; color:#64748b; }
.footer .sig-line { width:160px; border-top:1px solid #94a3b8; padding-top:4px; text-align:center; font-size:11px; margin-top:30px; }
@media print { body { padding:10px; } .no-print { display:none !important; } }
</style>
</head>
<body>
<div class="no-print" style="text-align:left;margin-bottom:10px">
  <button onclick="window.print()" style="background:#1e3a8a;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px"><i class="fa-solid fa-print"></i> طباعة</button>
  <button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;margin-right:8px">âœ✖️ إغلاق</button>
</div>

<div class="print-header">
  ${company.logo ? '<img src="' + e(company.logo) + '" style="height:48px;object-fit:contain;margin-bottom:8px;">' : ''}
  <h1>${e(company.company_name || '')}</h1>
  <div class="sub">${e(company.company_address || '')}${company.city ? ' - ' + e(company.city) : ''} | ${e(company.company_phone || '')} | ${e(company.company_email || '')}${company.tax_number ? ' | رقم ضريبي: ' + e(company.tax_number) : ''}</div>
</div>

<div class="invoice-title">سند صرف رقم: ${e(pay.payment_no)}</div>

<div class="info-grid">
  <div><strong>رقم السند:</strong> ${e(pay.payment_no)}</div>
  <div><strong>التاريخ:</strong> ${pay.payment_date || '-'}</div>
  <div><strong>المورد:</strong> ${e(pay.supplier_name || '-')}</div>
  <div><strong>طريقة الدفع:</strong> ${methodLabel}</div>
  ${pay.payment_method === 'check' ? `<div><strong>رقم الشيك:</strong> ${e(pay.check_no || '-')}</div><div><strong>تاريخ الشيك:</strong> ${pay.check_date || '-'}</div><div><strong>البنك:</strong> ${e(pay.bank_name || '-')}</div>` : ''}
  <div><strong>هاتف المورد:</strong> ${e(pay.phone || '-')}</div>
  <div><strong>العنوان:</strong> ${e(pay.address || '-')}</div>
</div>

${allocs.length > 0 ? `
<table class="data-table">
  <thead><tr><th>#</th><th>رقم الفاتورة</th><th>الالمبلغ الالمسددة</th></tr></thead>
  <tbody>
    ${allocs.map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${e(a.invoice_no || '-')}</td>
        <td>${money(a.allocated_amount)} ج.م</td>
      </tr>`).join('')}
  </tbody>
</table>` : ''}

<div class="totals">
  <div style="font-size:13px;color:#64748b;margin-bottom:4px">إجمالي الالمبلغ</div>
  <div class="amount">${money(amount)} ج.م</div>

</div>

${pay.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${e(pay.notes)}</div>` : ''}

<div class="footer">
  <div>
    <div class="sig-line">توقيع المورد</div>
  </div>
  <div>
    <div class="sig-line">الالمحاسب</div>
  </div>
  <div>
    <div class="sig-line">المدير المالي</div>
  </div>
</div>

<div style="text-align:center;margin-top:14px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px">
  <i class="fa-solid fa-print"></i> تمت الطباعة: ${new Date().toLocaleString('ar-EG')}
  &nbsp;|&nbsp; <i class="fa-solid fa-hashtag"></i> سند صرف رقم ${e(pay.payment_no)}
</div>
</body>
</html>`);
  } catch (err) {
    console.error('Payment print error:', err);
    res.status(500).send('خطأ في طباعة سند الصرف');
  }
}));

// =====================================================================
// PURCHASE REPORTS
// =====================================================================

router.get('/purchase-dashboard', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND invoice_date <= @to`;   rq.input('to',   sql.NVarChar, to);   }

        const purchQ = `
            SELECT COUNT(*) AS invoice_count,
                   COALESCE(SUM(grand_total), 0) AS total_purchases,
                   COALESCE(SUM(subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(discount_amount), 0) AS total_discount,
                   COALESCE(SUM(tax_amount), 0) AS total_tax,
                   COALESCE(SUM(amount_paid), 0) AS total_paid,
                   COALESCE(SUM(remaining), 0) AS total_outstanding,
                   CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(grand_total), 0) / COUNT(*) ELSE 0 END AS avg_invoice
            FROM purchase_invoices i
            ${wheres}
        `;
        const purch = (await rq.query(purchQ)).recordset[0];

        const rq2 = pool.request();
        let retW = `WHERE status NOT IN ('cancelled', 'deleted')`;
        if (from) { retW += ` AND return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
        if (to)   { retW += ` AND return_date <= @to`;   rq2.input('to',   sql.NVarChar, to);   }

        const retQ = `
            SELECT COALESCE(SUM(grand_total), 0) AS total_returns, COUNT(*) AS return_count
            FROM purchase_returns sr
            ${retW}
        `;
        const retData = (await rq2.query(retQ)).recordset[0];

        const rq3 = pool.request();
        let payW = '';
        if (from) { payW += ` WHERE payment_date >= @from`; rq3.input('from', sql.NVarChar, from); }
        if (to)   { payW += `${from ? ' AND' : ' WHERE'} payment_date <= @to`; rq3.input('to', sql.NVarChar, to); }
        const payQ = `
            SELECT COALESCE(SUM(amount), 0) AS paid_amount, COUNT(*) AS payment_count
            FROM supplier_payments sp
            ${payW}
        `;
        const payData = (await rq3.query(payQ)).recordset[0];

        const supQ = `SELECT COUNT(*) AS supplier_count FROM suppliers WHERE is_active = 1`;
        const supData = (await pool.request().query(supQ)).recordset[0];

        const totalPurch = num(purch.total_purchases);
        const totalReturns = num(retData.total_returns);
        const netPurch = totalPurch - totalReturns;

        res.json({
            success: true,
            data: {
                total_purchases: totalPurch,
                gross_purchases: num(purch.gross_purchases),
                total_returns: totalReturns,
                net_purchases: netPurch,
                paid_amount: num(payData.paid_amount),
                outstanding_amount: num(purch.total_outstanding),
                total_vat: num(purch.total_tax),
                invoice_count: num(purch.invoice_count),
                avg_invoice: num(purch.avg_invoice),
                supplier_count: num(supData.supplier_count),
                return_count: num(retData.return_count),
                return_rate: totalPurch > 0 ? (totalReturns / totalPurch) * 100 : 0,
                total_discount: num(purch.total_discount),
                payment_count: num(payData.payment_count)
            }
        });
    } catch (err) {
        console.error('purchase-dashboard error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/supplier-statement/:id', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const sid = req.params.id;
        const pool = await getPool();
        const rq = pool.request();
        rq.input('sid', sql.Int, sid);

        const sup = (await rq.query(`SELECT * FROM suppliers WHERE id = @sid`)).recordset[0];
        if (!sup) return res.status(404).json({ success: false, message: 'المورد غير موجود' });

        const apAcc = await getSysAccId(rq, SYS_AP);

        let wStr = '';
        if (from) wStr += ` AND invoice_date >= @from`;
        if (to)   wStr += ` AND invoice_date <= @to`;

        let parts = [];
        parts.push(`
            SELECT invoice_date AS trans_date, invoice_no AS doc_no,
                   N'فاتورة مشتريات' AS doc_type, N'فاتورة' AS doc_type_short,
                   grand_total AS debit, 0 AS credit,
                   'purchase_invoice' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM purchase_invoices
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')${wStr}
        `);

        let wStrR = '';
        if (from) wStrR += ` AND return_date >= @from`;
        if (to)   wStrR += ` AND return_date <= @to`;

        parts.push(`
            SELECT return_date AS trans_date, return_no AS doc_no,
                   N'مرتجع مشتريات' AS doc_type, N'مرتجع' AS doc_type_short,
                   0 AS debit, grand_total AS credit,
                   'purchase_return' AS ref_type, id AS ref_id,
                   ISNULL(return_reason,'') AS description, '' AS created_by_name
            FROM purchase_returns
            WHERE supplier_id = @sid AND status NOT IN ('cancelled', 'deleted')${wStrR}
        `);

        let wStrP = '';
        if (from) wStrP += ` AND payment_date >= @from`;
        if (to)   wStrP += ` AND payment_date <= @to`;

        parts.push(`
            SELECT payment_date AS trans_date, payment_no AS doc_no,
                   N'سند صرف' AS doc_type, N'سند صرف' AS doc_type_short,
                   0 AS debit, amount AS credit,
                   'supplier_payment' AS ref_type, id AS ref_id,
                   ISNULL(notes,'') AS description, '' AS created_by_name
            FROM supplier_payments
            WHERE supplier_id = @sid${wStrP}
        `);

        if (apAcc) {
            let wStrJ = '';
            if (from) wStrJ += ` AND je.entry_date >= @from`;
            if (to)   wStrJ += ` AND je.entry_date <= @to`;

            parts.push(`
                SELECT je.entry_date AS trans_date, je.entry_no AS doc_no,
                       CASE WHEN jl.debit > 0 THEN N'قيد مدين' ELSE N'قيد دائن' END AS doc_type,
                       CASE WHEN jl.debit > 0 THEN N'مدين' ELSE N'دائن' END AS doc_type_short,
                       jl.debit, jl.credit,
                       'journal_entry' AS ref_type, je.id AS ref_id,
                       ISNULL(jl.description,'') AS description,
                       ISNULL(u.full_name,'') AS created_by_name
                FROM journal_entry_lines jl
                JOIN journal_entries je ON je.id = jl.entry_id
                LEFT JOIN users u ON je.created_by = u.id
                WHERE jl.account_id = @apAccId
                  AND je.reference_type IS NULL
                  AND (jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%'
                       OR jl.description LIKE N'%المورد%' + CAST(@sid AS NVARCHAR)
                       OR jl.description LIKE N'%' + CAST(@sid AS NVARCHAR) + N'%')
                  ${wStrJ}
            `);
        }

        const finalQ = parts.join(' UNION ALL ') + ' ORDER BY trans_date ASC, ref_id ASC';

        const reqF = pool.request();
        reqF.input('sid', sql.Int, Number(sid));
        if (apAcc) reqF.input('apAccId', sql.Int, apAcc);
        if (from) reqF.input('from', sql.NVarChar, from);
        if (to)   reqF.input('to',   sql.NVarChar, to);

        const rowsRes = await reqF.query(finalQ);
        const rows = rowsRes.recordset;

        let running = num(sup.opening_balance);
        const statement = rows.map(r => {
            running += num(r.debit) - num(r.credit);
            return {
                date: r.trans_date, doc_no: r.doc_no, doc_type: r.doc_type,
                doc_type_short: r.doc_type_short, debit: num(r.debit), credit: num(r.credit),
                balance: running, description: r.description, created_by: r.created_by_name,
                ref_type: r.ref_type, ref_id: r.ref_id
            };
        });

        const totalDebit  = statement.reduce((s, r) => s + r.debit, 0);
        const totalCredit = statement.reduce((s, r) => s + r.credit, 0);
        const closing     = num(sup.opening_balance) + totalDebit - totalCredit;

        res.json({
            success: true,
            data: {
                supplier: { id: sup.id, supplier_code: sup.supplier_code, supplier_name: sup.supplier_name, phone: sup.phone, address: sup.address, current_balance: num(sup.current_balance) },
                opening_balance: num(sup.opening_balance),
                total_debit: totalDebit, total_credit: totalCredit,
                closing_balance: closing, rows: statement
            }
        });
    } catch (err) {
        console.error('supplier-statement error:', err);
        err.status = 500; err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.get('/purchases-by-period', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, store_id, group_by } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let joins = '';
        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;

        if (from)       { wheres += ` AND i.invoice_date >= @from`;  rq.input('from', sql.NVarChar, from); }
        if (to)         { wheres += ` AND i.invoice_date <= @to`;    rq.input('to', sql.NVarChar, to); }
        if (supplier_id){ wheres += ` AND i.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }
        if (store_id)   { wheres += ` AND i.store_id = @store_id`;   rq.input('store_id', sql.Int, store_id); }

        const dateGroup = group_by === 'monthly' ? `LEFT(i.invoice_date, 7)` : `LEFT(i.invoice_date, 10)`;

        const q = `
            SELECT ${dateGroup} AS period,
                   COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(i.subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(i.discount_amount), 0) AS total_discount,
                   COALESCE(SUM(i.tax_amount), 0) AS total_tax,
                   COALESCE(SUM(i.grand_total), 0) AS net_purchases,
                   CASE WHEN COUNT(DISTINCT i.id) > 0 THEN COALESCE(SUM(i.grand_total), 0) / COUNT(DISTINCT i.id) ELSE 0 END AS avg_invoice,
                   SUM(COALESCE((SELECT SUM(quantity) FROM purchase_invoice_items WHERE invoice_id = i.id), 0)) AS purchased_qty
            FROM purchase_invoices i
            ${joins}
            ${wheres}
            GROUP BY ${dateGroup}
            ORDER BY period DESC
        `;

        const data = (await rq.query(q)).recordset;

        const rq2 = pool.request();
        if (from) rq2.input('from', sql.NVarChar, from);
        if (to)   rq2.input('to',   sql.NVarChar, to);
        let retWhere = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) retWhere += ` AND sr.return_date >= @from`;
        if (to)   retWhere += ` AND sr.return_date <= @to`;

        const retQ = `SELECT COALESCE(SUM(sr.grand_total), 0) AS return_total FROM purchase_returns sr ${retWhere}`;
        const retData = (await rq2.query(retQ)).recordset[0];
        const returnTotal = num(retData.return_total);

        const totQ = `
            SELECT COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(i.subtotal), 0) AS gross_purchases,
                   COALESCE(SUM(i.discount_amount), 0) AS total_discount,
                   COALESCE(SUM(i.tax_amount), 0) AS total_tax,
                   COALESCE(SUM(i.grand_total), 0) AS net_purchases
            FROM purchase_invoices i ${joins} ${wheres}
        `;
        const totData = (await rq.query(totQ)).recordset[0];
        const netPurch = num(totData.net_purchases);
        const returnRate = netPurch > 0 ? (returnTotal / netPurch) * 100 : 0;

        res.json({
            success: true, data,
            totals: {
                invoice_count: num(totData.invoice_count), purchased_qty: 0,
                gross_purchases: num(totData.gross_purchases),
                total_discount: num(totData.total_discount), total_tax: num(totData.total_tax),
                net_purchases: netPurch,
                avg_invoice: num(totData.invoice_count) > 0 ? netPurch / num(totData.invoice_count) : 0,
                return_total: returnTotal, return_rate: returnRate
            }
        });
    } catch (err) {
        console.error('purchases-by-period error:', err);
        err.status = 500; err.message = 'خطأ في قاعدة البيانات';
        throw err;
    }
}));

router.get('/purchase-returns', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, page = 1, per_page = 200 } = req.query;
        const pPR = Math.max(1, parseInt(page) || 1);
        const ppPR = Math.max(1, Math.min(500, parseInt(per_page) || 200));
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND sr.return_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND sr.return_date <= @to`;   rq.input('to', sql.NVarChar, to); }
        if (supplier_id) { wheres += ` AND sr.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }

        const q = `
            SELECT sr.id, sr.return_no, sr.return_date, sr.grand_total, sr.tax_amount,
                   sr.grand_total - sr.tax_amount AS net_total, sr.return_reason AS reason,
                   sr.source_type, sr.reason_id,
                   s.supplier_name, pi.invoice_no, rr.label_ar AS reason_name,
                   sr.supplier_id, sr.invoice_id
            FROM purchase_returns sr
            LEFT JOIN suppliers s ON s.id = sr.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.id = sr.invoice_id
            LEFT JOIN return_reasons rr ON sr.return_reason = rr.code
            ${wheres}
            ORDER BY sr.return_date DESC
            OFFSET ${(pPR-1)*ppPR} ROWS FETCH NEXT ${ppPR} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const totQ = `SELECT COUNT(*) AS return_count, COALESCE(SUM(grand_total), 0) AS grand_total, COALESCE(SUM(tax_amount), 0) AS tax_amount, COALESCE(SUM(grand_total - tax_amount), 0) AS net_total FROM purchase_returns sr ${wheres}`;
        const totals = (await rq.query(totQ)).recordset[0];

        const countQ = `SELECT COUNT(*) AS total FROM purchase_returns sr ${wheres}`;
        const countRes = (await rq.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            totals: { return_count: num(totals.return_count), grand_total: num(totals.grand_total), tax_amount: num(totals.tax_amount), net_total: num(totals.net_total) },
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('purchase-returns error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/supplier-payments', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, page = 1, per_page = 200 } = req.query;
        const pSP = Math.max(1, parseInt(page) || 1);
        const ppSP = Math.max(1, Math.min(500, parseInt(per_page) || 200));
        const pool = await getPool();
        const rq = pool.request();

        let wheres = 'WHERE 1=1';
        if (from) { wheres += ` AND sp.payment_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND sp.payment_date <= @to`;   rq.input('to', sql.NVarChar, to); }
        if (supplier_id) { wheres += ` AND sp.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }

        const q = `
            SELECT sp.id, sp.payment_no, sp.payment_date, sp.amount, sp.payment_method, sp.reference, sp.notes,
                   s.supplier_name, s.supplier_code
            FROM supplier_payments sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            ${wheres}
            ORDER BY sp.payment_date DESC
            OFFSET ${(pSP-1)*ppSP} ROWS FETCH NEXT ${ppSP} ROWS ONLY
        `;
        const data = (await rq.query(q)).recordset;

        const totQ = `SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS total_amount FROM supplier_payments sp ${wheres}`;
        const totals = (await rq.query(totQ)).recordset[0];

        const countQ = `SELECT COUNT(*) AS total FROM supplier_payments sp ${wheres}`;
        const countRes = (await rq.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            totals: { payment_count: num(totals.payment_count), total_amount: num(totals.total_amount) },
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('supplier-payments error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/payables', asyncHandler(async (req, res) => {
    try {
        const pool = await getPool();
        const q = `
            SELECT s.id, s.supplier_code, s.supplier_name, s.phone,
                   s.current_balance,
                   CASE WHEN s.current_balance > 0 THEN DATEDIFF(DAY, GETDATE(), GETDATE()) ELSE 0 END AS days_outstanding,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 0 AND 30
                   ), 0) AS age_0_30,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 31 AND 60
                   ), 0) AS age_31_60,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 61 AND 90
                   ), 0) AS age_61_90,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) BETWEEN 91 AND 120
                   ), 0) AS age_91_120,
                   COALESCE((
                       SELECT SUM(i.grand_total - i.amount_paid)
                       FROM purchase_invoices i
                       WHERE i.supplier_id = s.id AND i.status NOT IN ('cancelled', 'deleted')
                         AND (i.grand_total - i.amount_paid) > 0
                         AND DATEDIFF(DAY, CAST(i.invoice_date AS DATE), GETDATE()) > 120
                   ), 0) AS age_120_plus
            FROM suppliers s
            WHERE s.is_active = 1 AND s.current_balance > 0
            ORDER BY s.current_balance DESC
        `;
        const data = (await pool.request().query(q)).recordset;

        const totals = data.reduce((acc, r) => {
            acc.total_balance += num(r.current_balance);
            acc.age_0_30 += num(r.age_0_30);
            acc.age_31_60 += num(r.age_31_60);
            acc.age_61_90 += num(r.age_61_90);
            acc.age_91_120 += num(r.age_91_120);
            acc.age_120_plus += num(r.age_120_plus);
            return acc;
        }, { total_balance: 0, age_0_30: 0, age_31_60: 0, age_61_90: 0, age_91_120: 0, age_120_plus: 0 });

        res.json({ success: true, data, totals });
    } catch (err) {
        console.error('payables error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/top-suppliers', asyncHandler(async (req, res) => {
    try {
        const { from, to, page = 1, per_page = 50 } = req.query;
        const pTS = Math.max(1, parseInt(page) || 1);
        const ppTS = Math.max(1, Math.min(500, parseInt(per_page) || 50));
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }

        const offset = (pTS - 1) * ppTS;

        const q = `
            WITH sup_purchases AS (
                SELECT i.supplier_id,
                       COUNT(DISTINCT i.id) AS invoice_count,
                       COALESCE(SUM(i.grand_total), 0) AS total_purchases
                FROM purchase_invoices i
                ${wheres}
                GROUP BY i.supplier_id
            ),
            sup_returns AS (
                SELECT sr.supplier_id, COALESCE(SUM(sr.grand_total), 0) AS total_returns
                FROM purchase_returns sr
                WHERE sr.status NOT IN ('cancelled', 'deleted')
                GROUP BY sr.supplier_id
            ),
            sup_payments AS (
                SELECT sp.supplier_id, COALESCE(SUM(sp.amount), 0) AS total_payments
                FROM supplier_payments sp
                GROUP BY sp.supplier_id
            )
            SELECT s.id, s.supplier_code, s.supplier_name, s.phone, s.current_balance,
                   COALESCE(sp.invoice_count, 0) AS invoice_count,
                   COALESCE(sp.total_purchases, 0) AS total_purchases,
                   COALESCE(sr.total_returns, 0) AS total_returns,
                   COALESCE(spa.total_payments, 0) AS total_payments,
                   s.current_balance AS outstanding,
                   ROW_NUMBER() OVER (ORDER BY COALESCE(sp.total_purchases, 0) DESC) AS ranking
            FROM suppliers s
            LEFT JOIN sup_purchases sp ON sp.supplier_id = s.id
            LEFT JOIN sup_returns sr ON sr.supplier_id = s.id
            LEFT JOIN sup_payments spa ON spa.supplier_id = s.id
            WHERE s.is_active = 1
            ORDER BY total_purchases DESC
            OFFSET ${offset} ROWS FETCH NEXT ${ppTS} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const countQ = `SELECT COUNT(DISTINCT i.supplier_id) AS total FROM purchase_invoices i ${wheres}`;
        const countRes = (await rq.query(countQ)).recordset[0];

        res.json({
            success: true, data,
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('top-suppliers error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/product-purchases', asyncHandler(async (req, res) => {
    try {
        const { from, to, store_id, page = 1, per_page = 100, sort = 'purchase_value', order = 'desc' } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from)   { wheres += ` AND i.invoice_date >= @from`;   rq.input('from', sql.NVarChar, from); }
        if (to)     { wheres += ` AND i.invoice_date <= @to`;     rq.input('to',   sql.NVarChar, to); }
        if (store_id) { wheres += ` AND i.store_id = @store_id`;  rq.input('store_id', sql.Int, store_id); }

        const pPP = Math.max(1, parseInt(page) || 1);
        const ppPP = Math.max(1, Math.min(500, parseInt(per_page) || 100));
        const offset = (pPP - 1) * ppPP;
        const sortCol = ['purchased_qty','returned_qty','net_qty','purchase_value','cost','inventory'].includes(sort) ? sort : 'purchase_value';
        const sortDir = order === 'asc' ? 'ASC' : 'DESC';

        const q = `
            WITH product_purchases AS (
                SELECT p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price,
                       COALESCE(SUM(ii.quantity), 0) AS purchased_qty,
                       COALESCE(SUM(ii.line_total), 0) AS purchase_value,
                       COALESCE(SUM(ii.quantity * ii.cost_price), 0) AS cost
                FROM products p
                LEFT JOIN purchase_invoice_items ii ON ii.product_id = p.id
                LEFT JOIN purchase_invoices i ON ii.invoice_id = i.id AND i.status NOT IN ('cancelled', 'deleted')
                ${wheres}
                GROUP BY p.id, p.product_code, p.product_name, p.unit_name, p.cost_price, p.sell_price
            ),
            product_returns AS (
                SELECT pri.product_id, COALESCE(SUM(pri.quantity), 0) AS returned_qty
                FROM purchase_return_items pri
                JOIN purchase_returns pr ON pr.id = pri.return_id AND pr.status NOT IN ('cancelled', 'deleted')
                GROUP BY pri.product_id
            ),
            product_inventory AS (
                SELECT ib.product_id, COALESCE(SUM(ib.quantity), 0) AS inventory
                FROM inventory_balances ib
                GROUP BY ib.product_id
            )
            SELECT pp.*,
                   COALESCE(pr.returned_qty, 0) AS returned_qty,
                   pp.purchased_qty - COALESCE(pr.returned_qty, 0) AS net_qty,
                   COALESCE(pinv.inventory, 0) AS inventory
            FROM product_purchases pp
            LEFT JOIN product_returns pr ON pr.product_id = pp.id
            LEFT JOIN product_inventory pinv ON pinv.product_id = pp.id
            WHERE pp.purchased_qty > 0 OR COALESCE(pr.returned_qty, 0) > 0
            ORDER BY ${sortCol} ${sortDir}
            OFFSET ${offset} ROWS FETCH NEXT ${ppPP} ROWS ONLY
        `;

        const data = (await rq.query(q)).recordset;

        const cq = `SELECT COUNT(DISTINCT ii.product_id) AS total FROM purchase_invoice_items ii JOIN purchase_invoices i ON ii.invoice_id = i.id ${wheres}`;
        const countRes = (await rq.query(cq)).recordset[0];

        res.json({
            success: true, data,
            pagination: { page: Number(page), per_page: Number(per_page), total: num(countRes.total), total_pages: Math.ceil(num(countRes.total)/Number(per_page)) }
        });
    } catch (err) {
        console.error('product-purchases error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/purchase-movement', asyncHandler(async (req, res) => {
    try {
        const { from, to, supplier_id, store_id, page = 1, per_page = 200 } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let parts = [];

        let wI = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wI += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wI += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }
        if (supplier_id) { wI += ` AND i.supplier_id = @supplier_id`; rq.input('supplier_id', sql.Int, supplier_id); }

        parts.push(`
            SELECT i.invoice_date AS trans_date, i.invoice_no AS doc_no,
                   N'فاتورة مشتريات' AS doc_type, i.grand_total, i.tax_amount,
                   i.grand_total - i.tax_amount AS net_total, i.status,
                   s.supplier_name, st.store_name
            FROM purchase_invoices i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN stores st ON st.id = i.store_id
            ${wI}
        `);

        let wR = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wR += ` AND sr.return_date >= @from`; }
        if (to)   { wR += ` AND sr.return_date <= @to`; }
        if (supplier_id) { wR += ` AND sr.supplier_id = @supplier_id`; }

        parts.push(`
            SELECT sr.return_date AS trans_date, sr.return_no AS doc_no,
                   N'مرتجع مشتريات' AS doc_type, sr.grand_total, sr.tax_amount,
                   sr.grand_total - sr.tax_amount AS net_total, sr.status,
                   s.supplier_name, st.store_name
            FROM purchase_returns sr
            LEFT JOIN suppliers s ON s.id = sr.supplier_id
            LEFT JOIN stores st ON st.id = sr.store_id
            ${wR}
        `);

        let wP = 'WHERE 1=1';
        if (from) { wP += ` AND sp.payment_date >= @from`; }
        if (to)   { wP += ` AND sp.payment_date <= @to`; }
        if (supplier_id) { wP += ` AND sp.supplier_id = @supplier_id`; }

        parts.push(`
            SELECT sp.payment_date AS trans_date, sp.payment_no AS doc_no,
                   N'سند صرف' AS doc_type, sp.amount AS grand_total, 0 AS tax_amount,
                   sp.amount AS net_total, 'paid' AS status,
                   s.supplier_name, '' AS store_name
            FROM supplier_payments sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            ${wP}
        `);

        const finalQ = parts.join(' UNION ALL ') + ' ORDER BY trans_date DESC, doc_no DESC';

        const reqF = pool.request();
        if (from) reqF.input('from', sql.NVarChar, from);
        if (to)   reqF.input('to',   sql.NVarChar, to);
        if (supplier_id) reqF.input('supplier_id', sql.Int, supplier_id);

        const allRows = (await reqF.query(finalQ)).recordset;
        const total = allRows.length;
        const offset = (Number(page) - 1) * Number(per_page);
        const data = allRows.slice(offset, offset + Number(per_page));

        const totals = data.reduce((acc, r) => {
            acc.grand_total += num(r.grand_total);
            acc.tax_amount += num(r.tax_amount);
            acc.net_total += num(r.net_total);
            return acc;
        }, { grand_total: 0, tax_amount: 0, net_total: 0 });

        res.json({
            success: true, data: data,
            totals: { trans_count: total, grand_total: num(totals.grand_total), tax_amount: num(totals.tax_amount), net_total: num(totals.net_total) },
            pagination: { page: Number(page), per_page: Number(per_page), total, total_pages: Math.ceil(total/Number(per_page)) }
        });
    } catch (err) {
        console.error('purchase-movement error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

router.get('/vat-purchase-report', asyncHandler(async (req, res) => {
    try {
        const { from, to } = req.query;
        const pool = await getPool();
        const rq = pool.request();

        let wheres = `WHERE i.status NOT IN ('cancelled', 'deleted')`;
        if (from) { wheres += ` AND i.invoice_date >= @from`; rq.input('from', sql.NVarChar, from); }
        if (to)   { wheres += ` AND i.invoice_date <= @to`;   rq.input('to', sql.NVarChar, to); }

        const purchVatQ = `
            SELECT COALESCE(ii.tax_pct, 0) AS vat_rate,
                   COUNT(DISTINCT i.id) AS invoice_count,
                   COALESCE(SUM(ii.line_total), 0) AS taxable_purchases,
                   COALESCE(SUM(ii.line_total * (ii.tax_pct / 100.0)), 0) AS vat_paid
            FROM purchase_invoice_items ii
            JOIN purchase_invoices i ON ii.invoice_id = i.id
            ${wheres}
            GROUP BY ii.tax_pct
            ORDER BY vat_rate
        `;
        const purchVat = (await rq.query(purchVatQ)).recordset;

        const rq2 = pool.request();
        let retW = `WHERE sr.status NOT IN ('cancelled', 'deleted')`;
        if (from) { retW += ` AND sr.return_date >= @from`; rq2.input('from', sql.NVarChar, from); }
        if (to)   { retW += ` AND sr.return_date <= @to`;   rq2.input('to', sql.NVarChar, to); }

        const retVatQ = `
            SELECT COALESCE(pri.tax_pct_snapshot, 0) AS vat_rate,
                   COUNT(DISTINCT sr.id) AS return_count,
                   COALESCE(SUM(pri.line_total), 0) AS taxable_returns,
                   COALESCE(SUM(pri.tax_amount_snapshot), 0) AS vat_reversed
            FROM purchase_return_items pri
            JOIN purchase_returns sr ON sr.id = pri.return_id
            ${retW}
            GROUP BY pri.tax_pct_snapshot
            ORDER BY vat_rate
        `;
        const retVat = (await rq2.query(retVatQ)).recordset;

        const rq3 = pool.request();
        const vatAcc = await getSysAccId(rq3, SYS_VAT_INPUT);

        let accW = `WHERE jl.account_id = @vatAccId`;
        if (from) { accW += ` AND je.entry_date >= @from`; rq3.input('from', sql.NVarChar, from); }
        if (to)   { accW += ` AND je.entry_date <= @to`;   rq3.input('to', sql.NVarChar, to); }
        rq3.input('vatAccId', sql.Int, vatAcc);

        const accVatQ = `
            SELECT COALESCE(SUM(jl.debit), 0) AS vat_paid, COALESCE(SUM(jl.credit), 0) AS vat_reversed
            FROM journal_entry_lines jl
            JOIN journal_entries je ON je.id = jl.entry_id
            ${accW}
        `;
        const accVat = vatAcc ? (await rq3.query(accVatQ)).recordset[0] : { vat_paid: 0, vat_reversed: 0 };

        const rateMap = {};
        for (const r of purchVat) {
            const rate = num(r.vat_rate);
            rateMap[rate] = { vat_rate: rate, invoice_count: num(r.invoice_count), taxable_purchases: num(r.taxable_purchases), vat_paid: num(r.vat_paid), return_count: 0, taxable_returns: 0, vat_reversed: 0 };
        }
        for (const r of retVat) {
            const rate = num(r.vat_rate);
            if (!rateMap[rate]) rateMap[rate] = { vat_rate: rate, invoice_count: 0, taxable_purchases: 0, vat_paid: 0, return_count: 0, taxable_returns: 0, vat_reversed: 0 };
            rateMap[rate].return_count += num(r.return_count);
            rateMap[rate].taxable_returns += num(r.taxable_returns);
            rateMap[rate].vat_reversed += num(r.vat_reversed);
        }

        const details = Object.values(rateMap).sort((a, b) => a.vat_rate - b.vat_rate);
        const totals = details.reduce((acc, r) => {
            acc.taxable_purchases += r.taxable_purchases;
            acc.taxable_returns += r.taxable_returns;
            acc.vat_paid += r.vat_paid;
            acc.vat_reversed += r.vat_reversed;
            return acc;
        }, { taxable_purchases: 0, taxable_returns: 0, vat_paid: 0, vat_reversed: 0 });
        totals.net_vat = totals.vat_paid - totals.vat_reversed;

        res.json({
            success: true, data: details, totals,
            accounting_validation: {
                vat_paid_operational: totals.vat_paid,
                vat_paid_accounting: num(accVat.vat_paid),
                vat_reversed_operational: totals.vat_reversed,
                vat_reversed_accounting: num(accVat.vat_reversed),
                reconciled: Math.abs(totals.vat_paid - num(accVat.vat_paid)) < 0.01 && Math.abs(totals.vat_reversed - num(accVat.vat_reversed)) < 0.01
            }
        });
    } catch (err) {
        console.error('vat-purchase-report error:', err);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات' });
    }
}));

module.exports = router;