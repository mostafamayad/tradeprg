const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../database/mssql_db');
const asyncHandler = require('../utils/asyncHandler');
const logActivity = require('../middleware/logger');

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// ─────────────────────────────────────────────────────────────
// EMPLOYEES CRUD
// ─────────────────────────────────────────────────────────────

router.get('/employees', asyncHandler(async (req, res) => {
    const { q, status, department, page = 1, limit = 50 } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (q) { where += ` AND (e.emp_code LIKE @q OR e.emp_name LIKE @q OR e.phone LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    if (status) { where += ` AND e.status = @st`; request.input('st', sql.NVarChar, status); }
    if (department) { where += ` AND e.department = @dept`; request.input('dept', sql.NVarChar, department); }
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    request.input('off', sql.Int, offset);
    request.input('lim', sql.Int, parseInt(limit));
    const countRes = await request.query(`SELECT COUNT(*) as total FROM employees e WHERE ${where}`);
    const total = countRes.recordset[0].total;
    const result = await request.query(`SELECT e.* FROM employees e WHERE ${where} ORDER BY e.id DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY`);
    res.json({ success: true, data: result.recordset, total, page: parseInt(page), limit: parseInt(limit) });
}));

router.get('/employees/departments', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != '' ORDER BY department`);
    res.json({ success: true, data: result.recordset.map(r => r.department) });
}));

router.get('/employees/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM employees WHERE id = @id');
    if (!result.recordset[0]) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    res.json({ success: true, data: result.recordset[0] });
}));

router.post('/employees', asyncHandler(async (req, res) => {
    const { emp_code, emp_name, department, job_title, basic_salary, hire_date, phone, national_id, status } = req.body;
    if (!emp_code) return res.status(400).json({ success: false, message: 'كود الموظف مطلوب' });
    if (!emp_name) return res.status(400).json({ success: false, message: 'اسم الموظف مطلوب' });
    const pool = await getPool();
    const result = await pool.request()
        .input('code', sql.NVarChar, emp_code)
        .input('name', sql.NVarChar, emp_name)
        .input('dept', sql.NVarChar, department || null)
        .input('job', sql.NVarChar, job_title || null)
        .input('sal', sql.Decimal(18, 4), num(basic_salary))
        .input('hd', sql.NVarChar, hire_date || null)
        .input('phone', sql.NVarChar, phone || null)
        .input('nid', sql.NVarChar, national_id || null)
        .input('st', sql.NVarChar, status || 'active')
        .input('cb', sql.Int, req.user ? req.user.id : null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO employees (emp_code, emp_name, department, job_title, basic_salary, hire_date, phone, national_id, status, created_at)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @dept, @job, @sal, @hd, @phone, @nid, @st, @now)`);
    const newId = result.recordset[0].id;
    await logActivity(req, 'CREATE', 'employees', newId, `إضافة موظف: ${emp_name}`, null, req.body, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إضافة الموظف بنجاح', data: { id: newId } });
}));

router.put('/employees/:id', asyncHandler(async (req, res) => {
    const { emp_code, emp_name, department, job_title, basic_salary, hire_date, phone, national_id, status } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM employees WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('code', sql.NVarChar, emp_code || existing.recordset[0].emp_code)
        .input('name', sql.NVarChar, emp_name || existing.recordset[0].emp_name)
        .input('dept', sql.NVarChar, department !== undefined ? department : existing.recordset[0].department)
        .input('job', sql.NVarChar, job_title !== undefined ? job_title : existing.recordset[0].job_title)
        .input('sal', sql.Decimal(18, 4), basic_salary !== undefined ? num(basic_salary) : existing.recordset[0].basic_salary)
        .input('hd', sql.NVarChar, hire_date !== undefined ? hire_date : existing.recordset[0].hire_date)
        .input('phone', sql.NVarChar, phone !== undefined ? phone : existing.recordset[0].phone)
        .input('nid', sql.NVarChar, national_id !== undefined ? national_id : existing.recordset[0].national_id)
        .input('st', sql.NVarChar, status || existing.recordset[0].status)
        .query(`UPDATE employees SET emp_code=@code, emp_name=@name, department=@dept, job_title=@job,
                basic_salary=@sal, hire_date=@hd, phone=@phone, national_id=@nid, status=@st WHERE id=@id`);
    await logActivity(req, 'UPDATE', 'employees', req.params.id, `تعديل موظف: ${emp_name || existing.recordset[0].emp_name}`, null, req.body, 'SUCCESS', null);
    res.json({ success: true, message: 'تم تعديل بيانات الموظف بنجاح' });
}));

router.delete('/employees/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT emp_name FROM employees WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM employees WHERE id = @id');
    await logActivity(req, 'DELETE', 'employees', req.params.id, `حذف موظف: ${existing.recordset[0].emp_name}`, null, null, 'SUCCESS', null);
    res.json({ success: true, message: 'تم حذف الموظف بنجاح' });
}));

router.patch('/employees/:id/toggle', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT status FROM employees WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الموظف غير موجود' });
    const newStatus = existing.recordset[0].status === 'active' ? 'inactive' : 'active';
    await pool.request().input('id', sql.Int, req.params.id).input('st', sql.NVarChar, newStatus).query('UPDATE employees SET status = @st WHERE id = @id');
    res.json({ success: true, message: newStatus === 'active' ? 'تم تنشيط الموظف' : 'تم إيقاف الموظف', data: { status: newStatus } });
}));

// ─────────────────────────────────────────────────────────────
// LOANS (EMP_LOANS)
// ─────────────────────────────────────────────────────────────

router.get('/loans', asyncHandler(async (req, res) => {
    const { emp_id, status, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (emp_id) { where += ` AND l.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    if (status) { where += ` AND l.status = @st`; request.input('st', sql.NVarChar, status); }
    if (q) { where += ` AND (e.emp_name LIKE @q OR e.emp_code LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    const result = await request.query(`
        SELECT l.*, e.emp_name, e.emp_code, e.department
        FROM emp_loans l
        LEFT JOIN employees e ON e.id = l.emp_id
        WHERE ${where}
        ORDER BY l.id DESC`);
    res.json({ success: true, data: result.recordset });
}));

router.post('/loans', asyncHandler(async (req, res) => {
    const { emp_id, loan_date, amount, monthly_installment, reason } = req.body;
    if (!emp_id) return res.status(400).json({ success: false, message: 'الموظف مطلوب' });
    if (!amount || num(amount) <= 0) return res.status(400).json({ success: false, message: 'مبلغ السلفة مطلوب ويجب أن يكون أكبر من صفر' });
    const pool = await getPool();
    const empCheck = await pool.request().input('eid', sql.Int, emp_id).query('SELECT emp_name FROM employees WHERE id = @eid');
    if (!empCheck.recordset[0]) return res.status(400).json({ success: false, message: 'الموظف غير موجود' });
    const result = await pool.request()
        .input('eid', sql.Int, emp_id)
        .input('ld', sql.NVarChar, loan_date || new Date().toISOString().slice(0, 10))
        .input('amt', sql.Decimal(18, 4), num(amount))
        .input('mi', sql.Decimal(18, 4), num(monthly_installment) || 0)
        .input('reason', sql.NVarChar, reason || null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO emp_loans (emp_id, loan_date, amount, monthly_installment, paid_amount, reason, status, created_at)
                OUTPUT INSERTED.id
                VALUES (@eid, @ld, @amt, @mi, 0, @reason, 'active', @now)`);
    const newId = result.recordset[0].id;
    await logActivity(req, 'CREATE', 'emp_loans', newId, `سلفة جديدة للموظف ${empCheck.recordset[0].emp_name} بقيمة ${amount}`, null, req.body, 'SUCCESS', null);
    res.json({ success: true, message: 'تم إنشاء السلفة بنجاح', data: { id: newId } });
}));

router.put('/loans/:id', asyncHandler(async (req, res) => {
    const { loan_date, amount, monthly_installment, reason, status } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_loans WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'السلفة غير موجودة' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('ld', sql.NVarChar, loan_date || existing.recordset[0].loan_date)
        .input('amt', sql.Decimal(18, 4), amount !== undefined ? num(amount) : existing.recordset[0].amount)
        .input('mi', sql.Decimal(18, 4), monthly_installment !== undefined ? num(monthly_installment) : (existing.recordset[0].monthly_installment || 0))
        .input('reason', sql.NVarChar, reason !== undefined ? reason : existing.recordset[0].reason)
        .input('st', sql.NVarChar, status || existing.recordset[0].status)
        .query(`UPDATE emp_loans SET loan_date=@ld, amount=@amt, monthly_installment=@mi, reason=@reason, status=@st WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل السلفة بنجاح' });
}));

router.post('/loans/:id/repay', asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!amount || num(amount) <= 0) return res.status(400).json({ success: false, message: 'مبلغ السداد مطلوب' });
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_loans WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'السلفة غير موجودة' });
    const loan = existing.recordset[0];
    if (loan.status === 'settled') return res.status(400).json({ success: false, message: 'السلفة مسددة بالفعل' });
    const newPaid = num(loan.paid_amount) + num(amount);
    const remaining = num(loan.amount) - newPaid;
    const newStatus = remaining <= 0 ? 'settled' : 'active';
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('paid', sql.Decimal(18, 4), newPaid)
        .input('st', sql.NVarChar, newStatus)
        .query(`UPDATE emp_loans SET paid_amount = @paid, status = @st WHERE id = @id`);
    const msg = newStatus === 'settled' ? 'تم سداد السلفة بالكامل' : `تم سداد ${amount} ج.م — المتبقي: ${remaining.toFixed(2)} ج.م`;
    await logActivity(req, 'UPDATE', 'emp_loans', req.params.id, `سداد سلفة ${amount} ج.م`, null, { amount: num(amount), paid_amount: newPaid, remaining }, 'SUCCESS', null);
    res.json({ success: true, message: msg, data: { paid_amount: newPaid, remaining: Math.max(remaining, 0), status: newStatus } });
}));

router.delete('/loans/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_loans WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'السلفة غير موجودة' });
    if (num(existing.recordset[0].paid_amount) > 0) return res.status(400).json({ success: false, message: 'لا يمكن حذف سلفة بها سدادات' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM emp_loans WHERE id = @id');
    res.json({ success: true, message: 'تم حذف السلفة بنجاح' });
}));

// ─────────────────────────────────────────────────────────────
// PAYROLL (SALARY_SLIPS)
// ─────────────────────────────────────────────────────────────

router.get('/payroll', asyncHandler(async (req, res) => {
    const { period, status, emp_id } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (period) { where += ` AND s.period = @per`; request.input('per', sql.NVarChar, period); }
    if (status) { where += ` AND s.status = @st`; request.input('st', sql.NVarChar, status); }
    if (emp_id) { where += ` AND s.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    const result = await request.query(`
        SELECT s.*, e.emp_name, e.emp_code, e.department, e.job_title
        FROM salary_slips s
        LEFT JOIN employees e ON e.id = s.emp_id
        WHERE ${where}
        ORDER BY s.id DESC`);
    res.json({ success: true, data: result.recordset });
}));

router.get('/payroll/periods', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT DISTINCT period FROM salary_slips ORDER BY period DESC`);
    res.json({ success: true, data: result.recordset.map(r => r.period) });
}));

router.post('/payroll/generate', asyncHandler(async (req, res) => {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: 'الفترة مطلوبة (مثال: 2026-07)' });
    const pool = await getPool();
    const existing = await pool.request().input('per', sql.NVarChar, period).query('SELECT COUNT(*) as cnt FROM salary_slips WHERE period = @per');
    if (existing.recordset[0].cnt > 0) return res.status(400).json({ success: false, message: 'مسير الرواتب لهذه الفترة موجود بالفعل' });
    const employees = await pool.request().query(`SELECT * FROM employees WHERE status = 'active' AND basic_salary > 0`);
    if (employees.recordset.length === 0) return res.status(400).json({ success: false, message: 'لا يوجد موظفين نشطين لإعداد مسير الرواتب' });
    let created = 0;
    for (const emp of employees.recordset) {
        const basicSalary = num(emp.basic_salary);
        const loansDeduction = 0;
        const loanRes = await pool.request()
            .input('eid', sql.Int, emp.id)
            .query(`SELECT ISNULL(SUM(monthly_installment), 0) as total FROM emp_loans WHERE emp_id = @eid AND status = 'active' AND monthly_installment > 0`);
        const loanDeduct = num(loanRes.recordset[0].total);
        const netSalary = basicSalary - loanDeduct;
        const slipNo = `PS-${period}-${emp.emp_code}`;
        await pool.request()
            .input('sn', sql.NVarChar, slipNo)
            .input('per', sql.NVarChar, period)
            .input('eid', sql.Int, emp.id)
            .input('bs', sql.Decimal(18, 4), basicSalary)
            .input('allow', sql.Decimal(18, 4), 0)
            .input('ded', sql.Decimal(18, 4), 0)
            .input('loans', sql.Decimal(18, 4), loanDeduct)
            .input('net', sql.Decimal(18, 4), netSalary)
            .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
            .query(`INSERT INTO salary_slips (slip_no, period, emp_id, basic_salary, allowances, deductions, loans, net_salary, status, created_at)
                    VALUES (@sn, @per, @eid, @bs, @allow, @ded, @loans, @net, 'draft', @now)`);
        created++;
    }
    await logActivity(req, 'CREATE', 'salary_slips', null, `إنشاء مسير رواتب ${period} — ${created} موظف`, null, { period, count: created }, 'SUCCESS', null);
    res.json({ success: true, message: `تم إنشاء مسير رواتب ${period} لـ ${created} موظف بنجاح`, data: { count: created } });
}));

router.put('/payroll/:id', asyncHandler(async (req, res) => {
    const { allowances, deductions, notes } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM salary_slips WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'تسجيل الرواتب غير موجود' });
    const slip = existing.recordset[0];
    if (slip.status === 'paid') return res.status(400).json({ success: false, message: 'لا يمكن تعديل راتب مدفوع' });
    const newAllow = allowances !== undefined ? num(allowances) : num(slip.allowances);
    const newDed = deductions !== undefined ? num(deductions) : num(slip.deductions);
    const netSalary = num(slip.basic_salary) + newAllow - newDed - num(slip.loans);
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('allow', sql.Decimal(18, 4), newAllow)
        .input('ded', sql.Decimal(18, 4), newDed)
        .input('net', sql.Decimal(18, 4), netSalary)
        .input('notes', sql.NVarChar, notes !== undefined ? notes : slip.notes)
        .query(`UPDATE salary_slips SET allowances=@allow, deductions=@ded, net_salary=@net, notes=@notes WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الراتب بنجاح', data: { net_salary: netSalary } });
}));

router.post('/payroll/:id/post', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT s.*, e.emp_name FROM salary_slips s LEFT JOIN employees e ON e.id = s.emp_id WHERE s.id = @id`);
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'تسجيل الرواتب غير موجود' });
    const slip = existing.recordset[0];
    if (slip.status === 'paid') return res.status(400).json({ success: false, message: 'تم ترحيل هذا الراتب بالفعل' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('st', sql.NVarChar, 'paid')
        .query(`UPDATE salary_slips SET status = @st WHERE id = @id`);
    await logActivity(req, 'UPDATE', 'salary_slips', req.params.id, `ترحيل راتب ${slip.emp_name} — ${slip.net_salary} ج.م`, null, { net_salary: slip.net_salary }, 'SUCCESS', null);
    res.json({ success: true, message: `تم ترحيل راتب ${slip.emp_name} بنجاح` });
}));

router.post('/payroll/:id/cancel', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM salary_slips WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'تسجيل الرواتب غير موجود' });
    if (existing.recordset[0].status === 'draft') return res.status(400).json({ success: false, message: 'الراتب في حالة مسودة بالفعل' });
    await pool.request().input('id', sql.Int, req.params.id).query(`UPDATE salary_slips SET status = 'draft' WHERE id = @id`);
    res.json({ success: true, message: 'تم إرجاع الراتب إلى المسودة' });
}));

router.delete('/payroll/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM salary_slips WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'تسجيل الرواتب غير موجود' });
    if (existing.recordset[0].status === 'paid') return res.status(400).json({ success: false, message: 'لا يمكن حذف راتب مدفوع' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM salary_slips WHERE id = @id');
    res.json({ success: true, message: 'تم حذف تسجيل الراتب بنجاح' });
}));

// ─────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────

router.get('/attendance', asyncHandler(async (req, res) => {
    const { emp_id, date_from, date_to, status, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (emp_id) { where += ` AND a.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    if (date_from) { where += ` AND a.att_date >= @df`; request.input('df', sql.NVarChar, date_from); }
    if (date_to) { where += ` AND a.att_date <= @dt`; request.input('dt', sql.NVarChar, date_to); }
    if (status) { where += ` AND a.status = @st`; request.input('st', sql.NVarChar, status); }
    if (q) { where += ` AND (e.emp_name LIKE @q OR e.emp_code LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    const result = await request.query(`
        SELECT a.*, e.emp_name, e.emp_code, e.department
        FROM emp_attendance a
        LEFT JOIN employees e ON e.id = a.emp_id
        WHERE ${where}
        ORDER BY a.att_date DESC, e.emp_code ASC`);
    res.json({ success: true, data: result.recordset });
}));

router.get('/attendance/summary', asyncHandler(async (req, res) => {
    const { month } = req.query;
    if (!month) return res.json({ success: true, data: [] });
    const pool = await getPool();
    const result = await pool.request().input('m', sql.NVarChar, month + '%').query(`
        SELECT e.id as emp_id, e.emp_code, e.emp_name, e.department,
            COUNT(a.id) as total_days,
            SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) as present_days,
            SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) as absent_days,
            SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) as late_days,
            SUM(CASE WHEN a.status='leave' THEN 1 ELSE 0 END) as leave_days,
            ISNULL(SUM(a.late_minutes), 0) as total_late_minutes,
            ISNULL(SUM(a.overtime_minutes), 0) as total_overtime_minutes
        FROM employees e
        LEFT JOIN emp_attendance a ON a.emp_id = e.id AND a.att_date LIKE @m
        WHERE e.status = 'active'
        GROUP BY e.id, e.emp_code, e.emp_name, e.department
        ORDER BY e.emp_code`);
    res.json({ success: true, data: result.recordset });
}));

router.post('/attendance', asyncHandler(async (req, res) => {
    const { emp_id, att_date, check_in, check_out, status, late_minutes, overtime_minutes, notes } = req.body;
    if (!emp_id) return res.status(400).json({ success: false, message: 'الموظف مطلوب' });
    if (!att_date) return res.status(400).json({ success: false, message: 'التاريخ مطلوب' });
    const pool = await getPool();
    const empCheck = await pool.request().input('eid', sql.Int, emp_id).query('SELECT emp_name FROM employees WHERE id = @eid');
    if (!empCheck.recordset[0]) return res.status(400).json({ success: false, message: 'الموظف غير موجود' });
    const existing = await pool.request().input('eid', sql.Int, emp_id).input('dt', sql.NVarChar, att_date).query('SELECT id FROM emp_attendance WHERE emp_id = @eid AND att_date = @dt');
    if (existing.recordset[0]) return res.status(400).json({ success: false, message: 'تم تسجيل حضور هذا الموظف في هذا التاريخ بالفعل' });
    const result = await pool.request()
        .input('eid', sql.Int, emp_id)
        .input('dt', sql.NVarChar, att_date)
        .input('ci', sql.NVarChar, check_in || null)
        .input('co', sql.NVarChar, check_out || null)
        .input('st', sql.NVarChar, status || 'present')
        .input('lm', sql.Int, late_minutes || 0)
        .input('om', sql.Int, overtime_minutes || 0)
        .input('notes', sql.NVarChar, notes || null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO emp_attendance (emp_id, att_date, check_in, check_out, status, late_minutes, overtime_minutes, notes, created_at)
                OUTPUT INSERTED.id VALUES (@eid, @dt, @ci, @co, @st, @lm, @om, @notes, @now)`);
    res.json({ success: true, message: 'تم تسجيل الحضور بنجاح', data: { id: result.recordset[0].id } });
}));

router.post('/attendance/bulk', asyncHandler(async (req, res) => {
    const { records } = req.body;
    if (!records || !records.length) return res.status(400).json({ success: false, message: 'لا توجد سجلات' });
    const pool = await getPool();
    let created = 0, skipped = 0;
    for (const r of records) {
        const existing = await pool.request().input('eid', sql.Int, r.emp_id).input('dt', sql.NVarChar, r.att_date).query('SELECT id FROM emp_attendance WHERE emp_id = @eid AND att_date = @dt');
        if (existing.recordset[0]) { skipped++; continue; }
        await pool.request()
            .input('eid', sql.Int, r.emp_id)
            .input('dt', sql.NVarChar, r.att_date)
            .input('ci', sql.NVarChar, r.check_in || null)
            .input('co', sql.NVarChar, r.check_out || null)
            .input('st', sql.NVarChar, r.status || 'present')
            .input('lm', sql.Int, r.late_minutes || 0)
            .input('om', sql.Int, r.overtime_minutes || 0)
            .input('notes', sql.NVarChar, r.notes || null)
            .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
            .query(`INSERT INTO emp_attendance (emp_id, att_date, check_in, check_out, status, late_minutes, overtime_minutes, notes, created_at)
                    VALUES (@eid, @dt, @ci, @co, @st, @lm, @om, @notes, @now)`);
        created++;
    }
    res.json({ success: true, message: `تم تسجيل ${created} سجل حضور (${skipped} مكرر تم تخطيه)`, data: { created, skipped } });
}));

router.put('/attendance/:id', asyncHandler(async (req, res) => {
    const { check_in, check_out, status, late_minutes, overtime_minutes, notes } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_attendance WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'سجل الحضور غير موجود' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('ci', sql.NVarChar, check_in !== undefined ? check_in : existing.recordset[0].check_in)
        .input('co', sql.NVarChar, check_out !== undefined ? check_out : existing.recordset[0].check_out)
        .input('st', sql.NVarChar, status || existing.recordset[0].status)
        .input('lm', sql.Int, late_minutes !== undefined ? late_minutes : existing.recordset[0].late_minutes)
        .input('om', sql.Int, overtime_minutes !== undefined ? overtime_minutes : existing.recordset[0].overtime_minutes)
        .input('notes', sql.NVarChar, notes !== undefined ? notes : existing.recordset[0].notes)
        .query(`UPDATE emp_attendance SET check_in=@ci, check_out=@co, status=@st, late_minutes=@lm, overtime_minutes=@om, notes=@notes WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل سجل الحضور' });
}));

router.delete('/attendance/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_attendance WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'سجل الحضور غير موجود' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM emp_attendance WHERE id = @id');
    res.json({ success: true, message: 'تم حذف سجل الحضور' });
}));

// ─────────────────────────────────────────────────────────────
// VACATIONS
// ─────────────────────────────────────────────────────────────

router.get('/vacations', asyncHandler(async (req, res) => {
    const { emp_id, status, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (emp_id) { where += ` AND v.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    if (status) { where += ` AND v.status = @st`; request.input('st', sql.NVarChar, status); }
    if (q) { where += ` AND (e.emp_name LIKE @q OR e.emp_code LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    const result = await request.query(`
        SELECT v.*, e.emp_name, e.emp_code, e.department
        FROM emp_vacations v
        LEFT JOIN employees e ON e.id = v.emp_id
        WHERE ${where}
        ORDER BY v.id DESC`);
    res.json({ success: true, data: result.recordset });
}));

router.get('/vacations/balance', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const year = new Date().getFullYear().toString();
    const result = await pool.request().input('y', sql.NVarChar, year + '%').query(`
        SELECT e.id as emp_id, e.emp_code, e.emp_name, e.department,
            21 as annual_balance,
            ISNULL(SUM(CASE WHEN v.status='approved' THEN v.days ELSE 0 END), 0) as days_taken,
            21 - ISNULL(SUM(CASE WHEN v.status='approved' THEN v.days ELSE 0 END), 0) as remaining
        FROM employees e
        LEFT JOIN emp_vacations v ON v.emp_id = e.id AND v.vac_type = 'annual' AND v.created_at LIKE @y
        WHERE e.status = 'active'
        GROUP BY e.id, e.emp_code, e.emp_name, e.department
        ORDER BY e.emp_code`);
    res.json({ success: true, data: result.recordset });
}));

router.post('/vacations', asyncHandler(async (req, res) => {
    const { emp_id, vac_type, start_date, end_date, days, reason } = req.body;
    if (!emp_id) return res.status(400).json({ success: false, message: 'الموظف مطلوب' });
    if (!start_date || !end_date) return res.status(400).json({ success: false, message: 'تاريخ البداية والنهاية مطلوبان' });
    const pool = await getPool();
    const empCheck = await pool.request().input('eid', sql.Int, emp_id).query('SELECT emp_name FROM employees WHERE id = @eid');
    if (!empCheck.recordset[0]) return res.status(400).json({ success: false, message: 'الموظف غير موجود' });
    const calcDays = days || Math.max(1, Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1);
    const result = await pool.request()
        .input('eid', sql.Int, emp_id)
        .input('vt', sql.NVarChar, vac_type || 'annual')
        .input('sd', sql.NVarChar, start_date)
        .input('ed', sql.NVarChar, end_date)
        .input('days', sql.Int, calcDays)
        .input('reason', sql.NVarChar, reason || null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO emp_vacations (emp_id, vac_type, start_date, end_date, days, reason, status, created_at)
                OUTPUT INSERTED.id VALUES (@eid, @vt, @sd, @ed, @days, @reason, 'pending', @now)`);
    res.json({ success: true, message: 'تم تقديم طلب الإجازة بنجاح', data: { id: result.recordset[0].id } });
}));

router.put('/vacations/:id', asyncHandler(async (req, res) => {
    const { vac_type, start_date, end_date, days, reason, notes } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_vacations WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'طلب الإجازة غير موجود' });
    if (existing.recordset[0].status !== 'pending') return res.status(400).json({ success: false, message: 'لا يمكن تعديل طلب معتمد أو مرفوض' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('vt', sql.NVarChar, vac_type || existing.recordset[0].vac_type)
        .input('sd', sql.NVarChar, start_date || existing.recordset[0].start_date)
        .input('ed', sql.NVarChar, end_date || existing.recordset[0].end_date)
        .input('days', sql.Int, days || existing.recordset[0].days)
        .input('reason', sql.NVarChar, reason !== undefined ? reason : existing.recordset[0].reason)
        .input('notes', sql.NVarChar, notes !== undefined ? notes : existing.recordset[0].notes)
        .query(`UPDATE emp_vacations SET vac_type=@vt, start_date=@sd, end_date=@ed, days=@days, reason=@reason, notes=@notes WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل طلب الإجازة' });
}));

router.patch('/vacations/:id/approve', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_vacations WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'طلب الإجازة غير موجود' });
    if (existing.recordset[0].status !== 'pending') return res.status(400).json({ success: false, message: 'هذا الطلب معتمد أو مرفوض بالفعل' });
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('by', sql.NVarChar, req.user ? req.user.name || 'Admin' : 'System')
        .input('at', sql.NVarChar, now)
        .query(`UPDATE emp_vacations SET status='approved', approved_by=@by, approved_at=@at WHERE id=@id`);
    res.json({ success: true, message: 'تم اعتماد الإجازة' });
}));

router.patch('/vacations/:id/reject', asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_vacations WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'طلب الإجازة غير موجود' });
    if (existing.recordset[0].status !== 'pending') return res.status(400).json({ success: false, message: 'هذا الطلب معتمد أو مرفوض بالفعل' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('notes', sql.NVarChar, reason || 'مرفوض')
        .query(`UPDATE emp_vacations SET status='rejected', notes=@notes WHERE id=@id`);
    res.json({ success: true, message: 'تم رفض الإجازة' });
}));

router.delete('/vacations/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_vacations WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'طلب الإجازة غير موجود' });
    if (existing.recordset[0].status === 'approved') return res.status(400).json({ success: false, message: 'لا يمكن حذف إجازة معتمدة' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM emp_vacations WHERE id = @id');
    res.json({ success: true, message: 'تم حذف طلب الإجازة' });
}));

// ─────────────────────────────────────────────────────────────
// PENALTIES
// ─────────────────────────────────────────────────────────────

router.get('/penalties', asyncHandler(async (req, res) => {
    const { emp_id, status, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (emp_id) { where += ` AND p.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    if (status) { where += ` AND p.status = @st`; request.input('st', sql.NVarChar, status); }
    if (q) { where += ` AND (e.emp_name LIKE @q OR e.emp_code LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    const result = await request.query(`
        SELECT p.*, e.emp_name, e.emp_code, e.department
        FROM emp_penalties p
        LEFT JOIN employees e ON e.id = p.emp_id
        WHERE ${where}
        ORDER BY p.id DESC`);
    res.json({ success: true, data: result.recordset });
}));

router.post('/penalties', asyncHandler(async (req, res) => {
    const { emp_id, penalty_type, penalty_date, amount, reason } = req.body;
    if (!emp_id) return res.status(400).json({ success: false, message: 'الموظف مطلوب' });
    if (!penalty_type) return res.status(400).json({ success: false, message: 'نوع الجزاء مطلوب' });
    if (!penalty_date) return res.status(400).json({ success: false, message: 'التاريخ مطلوب' });
    const pool = await getPool();
    const empCheck = await pool.request().input('eid', sql.Int, emp_id).query('SELECT emp_name FROM employees WHERE id = @eid');
    if (!empCheck.recordset[0]) return res.status(400).json({ success: false, message: 'الموظف غير موجود' });
    const result = await pool.request()
        .input('eid', sql.Int, emp_id)
        .input('pt', sql.NVarChar, penalty_type)
        .input('pd', sql.NVarChar, penalty_date)
        .input('amt', sql.Decimal(18, 4), num(amount))
        .input('reason', sql.NVarChar, reason || null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO emp_penalties (emp_id, penalty_type, penalty_date, amount, reason, status, created_at)
                OUTPUT INSERTED.id VALUES (@eid, @pt, @pd, @amt, @reason, 'active', @now)`);
    res.json({ success: true, message: 'تم تسجيل الجزاء بنجاح', data: { id: result.recordset[0].id } });
}));

router.put('/penalties/:id', asyncHandler(async (req, res) => {
    const { penalty_type, penalty_date, amount, reason, status } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_penalties WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الجزاء غير موجود' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('pt', sql.NVarChar, penalty_type || existing.recordset[0].penalty_type)
        .input('pd', sql.NVarChar, penalty_date || existing.recordset[0].penalty_date)
        .input('amt', sql.Decimal(18, 4), amount !== undefined ? num(amount) : existing.recordset[0].amount)
        .input('reason', sql.NVarChar, reason !== undefined ? reason : existing.recordset[0].reason)
        .input('st', sql.NVarChar, status || existing.recordset[0].status)
        .query(`UPDATE emp_penalties SET penalty_type=@pt, penalty_date=@pd, amount=@amt, reason=@reason, status=@st WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل الجزاء' });
}));

router.delete('/penalties/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_penalties WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'الجزاء غير موجود' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM emp_penalties WHERE id = @id');
    res.json({ success: true, message: 'تم حذف الجزاء' });
}));

// ─────────────────────────────────────────────────────────────
// REWARDS
// ─────────────────────────────────────────────────────────────

router.get('/rewards', asyncHandler(async (req, res) => {
    const { emp_id, status, q } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let where = '1=1';
    if (emp_id) { where += ` AND r.emp_id = @eid`; request.input('eid', sql.Int, emp_id); }
    if (status) { where += ` AND r.status = @st`; request.input('st', sql.NVarChar, status); }
    if (q) { where += ` AND (e.emp_name LIKE @q OR e.emp_code LIKE @q)`; request.input('q', sql.NVarChar, `%${q}%`); }
    const result = await request.query(`
        SELECT r.*, e.emp_name, e.emp_code, e.department
        FROM emp_rewards r
        LEFT JOIN employees e ON e.id = r.emp_id
        WHERE ${where}
        ORDER BY r.id DESC`);
    res.json({ success: true, data: result.recordset });
}));

router.post('/rewards', asyncHandler(async (req, res) => {
    const { emp_id, reward_type, reward_date, amount, reason } = req.body;
    if (!emp_id) return res.status(400).json({ success: false, message: 'الموظف مطلوب' });
    if (!reward_type) return res.status(400).json({ success: false, message: 'نوع المكافأة مطلوب' });
    if (!reward_date) return res.status(400).json({ success: false, message: 'التاريخ مطلوب' });
    const pool = await getPool();
    const empCheck = await pool.request().input('eid', sql.Int, emp_id).query('SELECT emp_name FROM employees WHERE id = @eid');
    if (!empCheck.recordset[0]) return res.status(400).json({ success: false, message: 'الموظف غير موجود' });
    const result = await pool.request()
        .input('eid', sql.Int, emp_id)
        .input('rt', sql.NVarChar, reward_type)
        .input('rd', sql.NVarChar, reward_date)
        .input('amt', sql.Decimal(18, 4), num(amount))
        .input('reason', sql.NVarChar, reason || null)
        .input('now', sql.NVarChar, new Date().toISOString().slice(0, 19).replace('T', ' '))
        .query(`INSERT INTO emp_rewards (emp_id, reward_type, reward_date, amount, reason, status, created_at)
                OUTPUT INSERTED.id VALUES (@eid, @rt, @rd, @amt, @reason, 'active', @now)`);
    res.json({ success: true, message: 'تم تسجيل المكافأة بنجاح', data: { id: result.recordset[0].id } });
}));

router.put('/rewards/:id', asyncHandler(async (req, res) => {
    const { reward_type, reward_date, amount, reason, status } = req.body;
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_rewards WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'المكافأة غير موجودة' });
    await pool.request()
        .input('id', sql.Int, req.params.id)
        .input('rt', sql.NVarChar, reward_type || existing.recordset[0].reward_type)
        .input('rd', sql.NVarChar, reward_date || existing.recordset[0].reward_date)
        .input('amt', sql.Decimal(18, 4), amount !== undefined ? num(amount) : existing.recordset[0].amount)
        .input('reason', sql.NVarChar, reason !== undefined ? reason : existing.recordset[0].reason)
        .input('st', sql.NVarChar, status || existing.recordset[0].status)
        .query(`UPDATE emp_rewards SET reward_type=@rt, reward_date=@rd, amount=@amt, reason=@reason, status=@st WHERE id=@id`);
    res.json({ success: true, message: 'تم تعديل المكافأة' });
}));

router.delete('/rewards/:id', asyncHandler(async (req, res) => {
    const pool = await getPool();
    const existing = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM emp_rewards WHERE id = @id');
    if (!existing.recordset[0]) return res.status(404).json({ success: false, message: 'المكافأة غير موجودة' });
    await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM emp_rewards WHERE id = @id');
    res.json({ success: true, message: 'تم حذف المكافأة' });
}));

// ─────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────

router.get('/stats', asyncHandler(async (req, res) => {
    const pool = await getPool();
    let empTotal = 0, empActive = 0, loanTotal = 0, loanAmount = 0, loanPaid = 0, payrollPeriod = '-', payrollCount = 0, payrollNet = 0;
    try {
        const empCount = await pool.request().query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM employees`);
        empTotal = empCount.recordset[0].total || 0;
        empActive = empCount.recordset[0].active || 0;
    } catch (e) { console.error('[HR Stats] employees error:', e.message); }
    try {
        const loans = await pool.request().query(`SELECT COUNT(*) as total, ISNULL(SUM(amount),0) as total_amount, ISNULL(SUM(paid_amount),0) as total_paid FROM emp_loans WHERE status='active'`);
        loanTotal = loans.recordset[0].total || 0;
        loanAmount = num(loans.recordset[0].total_amount);
        loanPaid = num(loans.recordset[0].total_paid);
    } catch (e) { console.error('[HR Stats] loans error:', e.message); }
    try {
        const payroll = await pool.request().query(`SELECT TOP 1 period, COUNT(*) as count, ISNULL(SUM(net_salary),0) as total_net FROM salary_slips GROUP BY period ORDER BY MAX(id) DESC`);
        if (payroll.recordset[0]) {
            payrollPeriod = payroll.recordset[0].period || '-';
            payrollCount = payroll.recordset[0].count || 0;
            payrollNet = num(payroll.recordset[0].total_net);
        }
    } catch (e) { console.error('[HR Stats] payroll error:', e.message); }
    res.json({
        success: true,
        data: {
            employees: { total: empTotal, active: empActive },
            loans: { total: loanTotal, total_amount: loanAmount, total_paid: loanPaid },
            payroll: { period: payrollPeriod, count: payrollCount, total_net: payrollNet }
        }
    });
}));

module.exports = router;
