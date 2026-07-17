class ReportPrintEngine {
  constructor() {
    this.company = {};
    this.printSettings = {};
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;
    const token = localStorage.getItem('auth_token');
    const h = token ? { 'Authorization': 'Bearer ' + token } : {};
    try {
      const res = await fetch('/api/settings/company', { headers: h });
      const d = await res.json();
      if (d.success && d.data) Object.assign(this.company, d.data);
    } catch (e) { console.warn('PrintEngine: could not load company settings', e); }
    try {
      const res = await fetch('/api/settings/print', { headers: h });
      const d = await res.json();
      if (d.success && d.data) this.printSettings = d.data;
    } catch (e) { console.warn('PrintEngine: could not load print settings', e); }
  }

  print({ title, filters = [], summary = [], columns = [], rows = [], totals = [] }) {
    const html = this._buildHTML({ title, filters, summary, columns, rows, totals });
    const w = window.open('', '_blank', 'width=1024,height=768,scrollbars=yes');
    if (!w) { alert('الرجاء السماح بالنوافذ المنبثقة للطباعة'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 500);
  }

  exportCSV({ title, columns = [], rows = [] }) {
    if (!columns.length || !rows.length) { alert('لا توجد بيانات للتصدير'); return; }
    let csv = '\uFEFF';
    csv += columns.join(',') + '\n';
    for (const row of rows) {
      const vals = columns.map((_, ci) => {
        const v = row[ci] !== undefined ? row[ci] : '';
        const s = String(v).replace(/<[^>]*>/g, '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') ? '"' + s + '"' : s;
      });
      csv += vals.join(',') + '\n';
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'report') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _buildHTML({ title, filters, summary, columns, rows, totals }) {
    const c = this.company;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-SA');
    const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    let printedBy = '';
    try { const u = JSON.parse(localStorage.getItem('auth_user') || '{}'); printedBy = u.name || u.email || ''; } catch (e) {}

    const paperSize = this.printSettings.paper_size || 'A4';
    const orientation = this.printSettings.orientation || 'portrait';
    const marginTop = (this.printSettings.margin_top || '18') + 'mm';
    const marginBottom = (this.printSettings.margin_bottom || '22') + 'mm';
    const marginLeft = (this.printSettings.margin_left || '14') + 'mm';
    const marginRight = (this.printSettings.margin_right || '14') + 'mm';
    const showLogo = this.printSettings.show_logo !== 'false';
    const showFooter = this.printSettings.show_footer !== 'false';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${this._esc(title)}</title>
<style>
  @page { size: ${paperSize} ${orientation}; margin: ${marginTop} ${marginLeft} ${marginBottom} ${marginRight}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    font-size: 9pt;
    color: #1f2937;
    direction: rtl;
    line-height: 1.5;
  }
  @media print {
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    .no-print { display: none; }
  }
  @media screen {
    body { padding: 20px; max-width: 210mm; margin: 0 auto; }
  }
  .report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 14px;
    border-bottom: 2px solid #1e3a5f;
    margin-bottom: 16px;
  }
  .report-header .company-section {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .report-header .company-logo {
    width: 60px; height: 60px;
    background: #f1f5f9;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: #1e3a5f;
    flex-shrink: 0;
    overflow: hidden;
  }
  .report-header .company-logo img { width: 100%; height: 100%; object-fit: contain; }
  .report-header .company-info h2 {
    font-size: 13pt;
    font-weight: 800;
    color: #1e3a5f;
    margin: 0 0 4px 0;
  }
  .report-header .company-info .company-details {
    font-size: 7.5pt;
    color: #4b5563;
    line-height: 1.6;
  }
  .report-header .report-info { text-align: left; direction: ltr; }
  .report-header .report-info h1 {
    font-size: 11pt;
    font-weight: 800;
    color: #1e3a5f;
    margin: 0 0 6px 0;
    text-align: left;
  }
  .report-header .report-info .meta {
    font-size: 7pt;
    color: #6b7280;
    line-height: 1.7;
  }
  .report-header .report-info .meta span { display: block; }
  .filters-section {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }
  .filters-section .filter-item {
    font-size: 7.5pt;
    color: #374151;
  }
  .filters-section .filter-item strong {
    color: #1e3a5f;
    font-weight: 700;
  }
  .summary-section {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
  }
  .summary-section .summary-item { font-size: 8pt; }
  .summary-section .summary-item .summary-label {
    font-size: 6.5pt;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .summary-section .summary-item .summary-value {
    font-size: 10pt;
    font-weight: 800;
    color: #1e3a5f;
  }
  .table-wrapper {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 14px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  thead th {
    background: #1e3a5f;
    color: #fff;
    font-weight: 700;
    font-size: 7pt;
    padding: 8px 8px;
    text-align: center;
    white-space: nowrap;
    letter-spacing: 0.3px;
  }
  tbody td {
    padding: 7px 8px;
    text-align: center;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  tbody tr:hover td { background: #eef2ff; }
  tfoot td {
    background: #f1f5f9;
    padding: 8px 8px;
    text-align: center;
    font-weight: 800;
    font-size: 8.5pt;
    border-top: 2px solid #1e3a5f;
    color: #1e3a5f;
  }
  .totals-section {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px 24px;
    padding: 10px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    margin-bottom: 14px;
  }
  .totals-section .total-item { text-align: center; }
  .totals-section .total-item .total-label {
    font-size: 6.5pt;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .totals-section .total-item .total-value {
    font-size: 10pt;
    font-weight: 800;
    color: #1e3a5f;
  }
  .report-footer {
    text-align: center;
    font-size: 6.5pt;
    color: #9ca3af;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
    margin-top: 16px;
  }
  .report-footer span { margin: 0 10px; }
  .text-success { color: #059669; }
  .text-danger  { color: #dc2626; }
  .text-primary { color: #1e3a5f; }
  .fw-700 { font-weight: 700; }
  .print-toolbar {
    text-align: center;
    margin-bottom: 20px;
  }
  .print-toolbar button {
    padding: 10px 30px;
    font-size: 10pt;
    font-weight: 700;
    background: #1e3a5f;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  .print-toolbar button:hover { background: #152d4a; }
</style>
</head>
<body>
  <div class="print-toolbar no-print">
    <button onclick="window.print()"><i class="fa-solid fa-print"></i> طباعة / PDF</button>
  </div>
  <div class="report-header">
    <div class="company-section">
      <div class="company-logo">
        ${showLogo && c.logo ? '<img src="' + this._esc(c.logo) + '" alt="Logo">' : '<i class="fa-solid fa-building"></i>'}
      </div>
      <div class="company-info">
        <h2>${this._esc(c.name || '')}</h2>
        <div class="company-details">
          ${c.address ? c.address + '<br>' : ''}
          ${c.phone ? 'هاتف: ' + this._esc(c.phone) + ' | ' : ''}
          ${c.email ? 'بريد: ' + this._esc(c.email) + '<br>' : ''}
          ${c.tax_no ? 'رقم ضريبي: ' + this._esc(c.tax_no) + ' | ' : ''}
          ${c.cr_no ? 'سجل تجاري: ' + this._esc(c.cr_no) : ''}
        </div>
      </div>
    </div>
    <div class="report-info">
      <h1>${this._esc(title)}</h1>
      <div class="meta">
        <span>تاريخ الطباعة: ${dateStr}</span>
        <span>وقت الطباعة: ${timeStr}</span>
        <span>مطبوع بواسطة: ${this._esc(printedBy || '---')}</span>
      </div>
    </div>
  </div>
  ${filters.length ? `
  <div class="filters-section">
    ${filters.map(f => `<div class="filter-item"><strong>${this._esc(f.label)}:</strong> ${this._esc(f.value || '---')}</div>`).join('')}
  </div>` : ''}
  ${summary.length ? `
  <div class="summary-section">
    ${summary.map(s => `<div class="summary-item"><div class="summary-label">${this._esc(s.label)}</div><div class="summary-value">${s.value}</div></div>`).join('')}
  </div>` : ''}
  ${columns.length ? `
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>${columns.map(c => `<th>${this._esc(c)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map(row => `
        <tr>${columns.map((_, ci) => {
          const v = row[ci] !== undefined ? row[ci] : '';
          return `<td>${v}</td>`;
        }).join('')}</tr>`).join('') : `
        <tr><td colspan="${columns.length}" style="text-align:center;padding:20px;color:#9ca3af;">لا توجد بيانات</td></tr>`}
      </tbody>
    </table>
  </div>` : ''}
  ${totals.length ? `
  <div class="totals-section">
    ${totals.map(t => `<div class="total-item"><div class="total-label">${this._esc(t.label)}</div><div class="total-value">${t.value}</div></div>`).join('')}
  </div>` : ''}
  ${showFooter !== false ? `
  <div class="report-footer">
    <span>${this._esc(c.name || '')}</span>
    ${c.website ? '<span>| ' + this._esc(c.website) + '</span>' : ''}
    <span>|</span>
    <span>${dateStr} ${timeStr}</span>
  </div>` : ''}
</body>
</html>`;
  }

  _esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
  }
}
