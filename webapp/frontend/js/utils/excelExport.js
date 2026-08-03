(function () {
    'use strict';

    /**
     * exportStyledExcel
     * @param {Object} config
     * @param {string} config.filename
     * @param {string} config.title
     * @param {string} config.subtitle (optional)
     * @param {Array<string>} config.headers
     * @param {Array<Array<any>>} config.data
     * @param {Array<any>} config.totals (optional)
     * @param {Array<number>} config.colWidths (optional)
     */
    window.exportStyledExcel = async function (config) {
        if (typeof ExcelJS === 'undefined') {
            alert('مكتبة ExcelJS غير محملة');
            return;
        }
        
        var workbook = new ExcelJS.Workbook();
        workbook.creator = 'TradePro ERP';
        workbook.lastModifiedBy = 'TradePro ERP';
        workbook.created = new Date();
        workbook.modified = new Date();
        
        var worksheet = workbook.addWorksheet(config.title || 'Sheet 1', {
            views: [{ rightToLeft: true }] // RTL
        });

        // Add Company Name
        var coName = '';
        try {
            var settings = window.AppData && window.AppData.settings;
            if (settings) {
                coName = settings.company_name || settings.name || 'TradePro ERP';
            }
        } catch (e) {}

        var r1 = worksheet.addRow([coName]);
        r1.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF1E293B' } };
        
        var r2 = worksheet.addRow([config.title || 'تقرير']);
        r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFDC2626' } };
        
        if (config.subtitle) {
            var r3 = worksheet.addRow([config.subtitle]);
            r3.font = { name: 'Arial', size: 11, italic: true, color: { argb: 'FF475569' } };
            worksheet.addRow([]); // empty row
        } else {
            worksheet.addRow([]);
        }

        // Add Headers
        var headerRow = worksheet.addRow(config.headers);
        headerRow.eachCell(function(cell) {
            cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
                right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
            };
        });

        // Add Data
        config.data.forEach(function (rowData) {
            var row = worksheet.addRow(rowData);
            row.eachCell(function(cell, colNumber) {
                cell.font = { name: 'Arial', size: 11, color: { argb: 'FF1F2937' } };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                };
                
                // If it's a number, format it
                if (typeof cell.value === 'number') {
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { horizontal: 'left' };
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            });
        });

        // Add Totals
        if (config.totals && config.totals.length > 0) {
            var totalRow = worksheet.addRow(config.totals);
            totalRow.eachCell(function(cell) {
                cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF991B1B' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                cell.border = {
                    top: { style: 'medium', color: { argb: 'FFDC2626' } },
                    left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                    bottom: { style: 'medium', color: { argb: 'FFDC2626' } },
                    right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                };
                if (typeof cell.value === 'number') {
                    cell.numFmt = '#,##0.00';
                    cell.alignment = { horizontal: 'left' };
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            });
        }

        // Adjust Column Widths
        if (config.colWidths) {
            config.colWidths.forEach(function(w, i) {
                worksheet.getColumn(i + 1).width = w;
            });
        } else {
            worksheet.columns.forEach(function(column) {
                column.width = 20;
            });
        }

        // Freeze Panes (Header row)
        var freezeRow = config.subtitle ? 5 : 4;
        worksheet.views[0].state = 'frozen';
        worksheet.views[0].xSplit = 0;
        worksheet.views[0].ySplit = freezeRow;

        // Save
        var buffer = await workbook.xlsx.writeBuffer();
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, config.filename + '.xlsx');
    };

})();
