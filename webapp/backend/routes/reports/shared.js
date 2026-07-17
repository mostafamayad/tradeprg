const { getPool, sql } = require("../../database/mssql_db");
const { parsePagination, buildPaginationResponse } = require("../../middleware/pagination");

// ============================================================
// TradePro ERP â€“ Enterprise Reports Module
// SAP S/4HANA / Dynamics 365 / Odoo Enterprise â€“ Grade
// ============================================================
// Every report reconciles with accounting (journal entries)
// All totals validated against system accounts
// ============================================================

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// Load company data from both company_info and settings tables (settings has logo, phone, email, etc.)
async function loadCompanyData(requestObj) {
    const rq = requestObj.request ? requestObj.request() : requestObj;
    const compRes = await rq.query(`SELECT TOP 1 * FROM company_info`);
    const company = compRes.recordset[0] || {};
    try {
        const settingsRes = await (requestObj.request ? requestObj.request() : requestObj).query(`SELECT * FROM settings WHERE [key] LIKE 'company_%'`);
        settingsRes.recordset.forEach(s => {
            const stripped = s.key.replace('company_', '');
            if (s.value) {
                company[stripped] = s.value;
                // Also overwrite the original company_info-style key if different
                if (stripped !== s.key) company[s.key] = s.value;
            }
        });
    } catch (e) { /* settings table may not exist */ }
    return company;
}

function escapeHtml(u) {
  if (u == null) return '';
  return u.toString().replace(/[&<>\"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[m]);
}

function validatePagination(page, per_page) {
  const p = Math.max(1, parseInt(page) || 1);
  const pp = Math.max(1, Math.min(500, parseInt(per_page) || 50));
  return { page: p, perPage: pp, offset: (p - 1) * pp };
}

function applyDateFilter(sqlParts, alias, from, to, req) {
  if (from) { sqlParts.push(` AND ${alias} >= @from`); req.input('from', sql.NVarChar, from); }
  if (to)   { sqlParts.push(` AND ${alias} <= @to`);   req.input('to',   sql.NVarChar, to);   }
}

// â”€â”€ Accounting system codes (must match accountingEngine) â”€â”€
const SYS_SALES          = 'SYS_SALES';
const SYS_SALES_RETURNS  = 'SYS_SALES_RETURNS';
const SYS_AR             = 'SYS_AR';
const SYS_AP             = 'SYS_AP';
const SYS_VAT_OUTPUT     = 'SYS_VAT_OUTPUT';
const SYS_VAT_INPUT      = 'SYS_VAT_INPUT';
const SYS_COGS           = 'SYS_COGS';
const SYS_PURCHASES      = 'SYS_PURCHASES';
const SYS_PURCHASE_RETURNS = 'SYS_PURCHASE_RETURNS';

// â”€â”€ Reusable: get active pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getSysAccId(requestObj, code) {
  requestObj.input('sysCode', sql.NVarChar, code);
  const r = await requestObj.query(`SELECT id FROM chart_of_accounts WHERE system_code = @sysCode`);
  return r.recordset[0] ? r.recordset[0].id : null;
}


const SYS_INVENTORY      = "SYS_INVENTORY";
const SYS_INVENTORY_SHORTAGE = "SYS_INVENTORY_SHORTAGE";

module.exports = { num, loadCompanyData, escapeHtml, validatePagination, applyDateFilter, getSysAccId, getPool, sql, SYS_SALES, SYS_SALES_RETURNS, SYS_AR, SYS_AP, SYS_VAT_OUTPUT, SYS_VAT_INPUT, SYS_COGS, SYS_PURCHASES, SYS_PURCHASE_RETURNS, SYS_INVENTORY, SYS_INVENTORY_SHORTAGE };