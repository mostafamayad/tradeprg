const fs = require('fs');
let code = fs.readFileSync('routes/accounting.js', 'utf8');

// Income statement restructure
const incOld = `        // Revenue groups (root '4')
        var revGroups = [
            { match: function (c) { return c.indexOf('41') === 0 || c === '4'; }, name: 'إيرادات المبيعات' },
            { match: function (c) { return c.indexOf('42') === 0; }, name: 'إيرادات أخرى' },
            { match: function (c) { return c.indexOf('43') === 0; }, name: 'زيادة وتسويات المخزون' },
            { match: function (c) { return c.indexOf('44') === 0; }, name: 'مردودات المشتريات' }
        ];

        // Cost of Sales groups (root '5')
        var cogsGroups = [
            { match: function (c) { return c.indexOf('51') === 0 || c === '5'; }, name: 'تكلفة البضاعة المباعة' },
            { match: function (c) { return c.indexOf('52') === 0; }, name: 'المشتريات' }
        ];

        // Expense groups (root '6')
        var expGroups = [
            { match: function (c) { return c.indexOf('61') === 0 || c === '6'; }, name: 'مصروفات البيع والتوزيع' },
            { match: function (c) { return c.indexOf('62') === 0; }, name: 'المصروفات العمومية والإدارية' },
            { match: function (c) { return c.indexOf('63') === 0; }, name: 'المصروفات التشغيلية' },
            { match: function (c) { return c.indexOf('64') === 0; }, name: 'المصروفات المالية' },
            { match: function (c) { return c.indexOf('65') === 0; }, name: 'خسائر وانخفاضات' },
            { match: function (c) { return c.indexOf('66') === 0; }, name: 'الإهلاك والإطفاء' },
            { match: function (c) { return c.indexOf('53') === 0; }, name: 'مصروفات التشغيل' },
            { match: function (c) { return c.indexOf('54') === 0; }, name: 'خسائر توالف مخزون' },
            { match: function (c) { return c.indexOf('55') === 0; }, name: 'مصروفات عامة وإدارية' }
        ];

        var revData = buildSection(byRoot['4'] || [], revGroups, false);
        var cogsData = buildSection(byRoot['5'] || [], cogsGroups, true);
        var expData = buildSection(byRoot['6'] || [], expGroups, true);

        var totalRevenue = revData.totals.closing;
        var totalCogs = cogsData.totals.closing;
        var totalExpenses = expData.totals.closing;
        var netIncome = Math.round((totalRevenue - totalCogs - totalExpenses) * 100) / 100;

        res.json({
            success: true,
            date: to || new Date().toISOString().split('T')[0],
            from: from || null,
            to: to || null,
            revenue: { name: 'الإيرادات', groups: revData.groups, totals: revData.totals },
            costOfSales: { name: 'تكلفة المبيعات', groups: cogsData.groups, totals: cogsData.totals },
            expenses: { name: 'المصروفات', groups: expData.groups, totals: expData.totals },
            netIncome: netIncome,
            totals: {
                totalRevenue: totalRevenue,
                totalCostOfSales: totalCogs,
                totalExpenses: totalExpenses,
                netIncome: netIncome
            }
        });`;

const incNew = `        // Net Sales groups (root '4')
        var netSalesGroups = [
            { match: function (c) { return c.indexOf('41') === 0 || c === '4'; }, name: 'إيرادات المبيعات' },
            { match: function (c) { return c.indexOf('44') === 0; }, name: 'مردودات المشتريات' }
        ];
        
        var otherIncomeGroups = [
            { match: function (c) { return c.indexOf('42') === 0; }, name: 'إيرادات أخرى' },
            { match: function (c) { return c.indexOf('43') === 0; }, name: 'زيادة وتسويات المخزون' }
        ];

        // Cost of Sales groups (root '5')
        var cogsGroups = [
            { match: function (c) { return c.indexOf('51') === 0 || c === '5'; }, name: 'تكلفة البضاعة المباعة' },
            { match: function (c) { return c.indexOf('52') === 0; }, name: 'المشتريات' }
        ];

        // Operating Expense groups (root '6')
        var opExpGroups = [
            { match: function (c) { return c.indexOf('61') === 0 || c === '6'; }, name: 'مصروفات البيع والتوزيع' },
            { match: function (c) { return c.indexOf('62') === 0; }, name: 'المصروفات العمومية والإدارية' },
            { match: function (c) { return c.indexOf('63') === 0; }, name: 'المصروفات التشغيلية' },
            { match: function (c) { return c.indexOf('66') === 0; }, name: 'الإهلاك والإطفاء' },
            { match: function (c) { return c.indexOf('53') === 0; }, name: 'مصروفات التشغيل' },
            { match: function (c) { return c.indexOf('55') === 0; }, name: 'مصروفات عامة وإدارية' }
        ];

        // Other Expense groups
        var otherExpGroups = [
            { match: function (c) { return c.indexOf('64') === 0; }, name: 'المصروفات المالية' },
            { match: function (c) { return c.indexOf('65') === 0; }, name: 'خسائر وانخفاضات' },
            { match: function (c) { return c.indexOf('54') === 0; }, name: 'خسائر توالف مخزون' }
        ];

        // Split root '4' accounts into Net Sales vs Other Income
        var accs4 = byRoot['4'] || [];
        var accsNetSales = [];
        var accsOtherInc = [];
        accs4.forEach(a => {
            var c = normCode(a.account_code);
            if (c.indexOf('42') === 0 || c.indexOf('43') === 0) accsOtherInc.push(a);
            else accsNetSales.push(a);
        });

        // Split root '6' and '5' into OP vs Other Exp
        var accs6 = byRoot['6'] || [];
        var accs5 = byRoot['5'] || [];
        
        var accsOpExp = [];
        var accsOtherExp = [];
        var accsCogs = [];
        
        accs5.forEach(a => {
            var c = normCode(a.account_code);
            if (c.indexOf('51') === 0 || c === '5' || c.indexOf('52') === 0) accsCogs.push(a);
            else if (c.indexOf('54') === 0) accsOtherExp.push(a);
            else accsOpExp.push(a);
        });
        
        accs6.forEach(a => {
            var c = normCode(a.account_code);
            if (c.indexOf('64') === 0 || c.indexOf('65') === 0) accsOtherExp.push(a);
            else accsOpExp.push(a);
        });

        var netSalesData = buildSection(accsNetSales, netSalesGroups, false);
        var otherIncData = buildSection(accsOtherInc, otherIncomeGroups, false);
        var cogsData = buildSection(accsCogs, cogsGroups, true);
        var opExpData = buildSection(accsOpExp, opExpGroups, true);
        var otherExpData = buildSection(accsOtherExp, otherExpGroups, true);

        var totalNetSales = netSalesData.totals.closing;
        var totalCogs = cogsData.totals.closing;
        var grossProfit = Math.round((totalNetSales - totalCogs) * 100) / 100;
        
        var totalOpExp = opExpData.totals.closing;
        var operatingProfit = Math.round((grossProfit - totalOpExp) * 100) / 100;
        
        var totalOtherInc = otherIncData.totals.closing;
        var totalOtherExp = otherExpData.totals.closing;
        var netProfit = Math.round((operatingProfit + totalOtherInc - totalOtherExp) * 100) / 100;

        res.json({
            success: true,
            date: to || new Date().toISOString().split('T')[0],
            from: from || null,
            to: to || null,
            netSales: { name: 'صافي المبيعات', groups: netSalesData.groups, totals: netSalesData.totals },
            costOfSales: { name: 'تكلفة المبيعات', groups: cogsData.groups, totals: cogsData.totals },
            operatingExpenses: { name: 'المصروفات التشغيلية', groups: opExpData.groups, totals: opExpData.totals },
            otherIncome: { name: 'إيرادات أخرى', groups: otherIncData.groups, totals: otherIncData.totals },
            otherExpenses: { name: 'مصروفات أخرى', groups: otherExpData.groups, totals: otherExpData.totals },
            totals: {
                totalNetSales: totalNetSales,
                totalCostOfSales: totalCogs,
                grossProfit: grossProfit,
                totalOperatingExpenses: totalOpExp,
                operatingProfit: operatingProfit,
                totalOtherIncome: totalOtherInc,
                totalOtherExpenses: totalOtherExp,
                netProfit: netProfit
            }
        });`;

code = code.replace(incOld, incNew);
fs.writeFileSync('routes/accounting.js', code);
console.log("INCOME STATEMENT SUCCESS");
