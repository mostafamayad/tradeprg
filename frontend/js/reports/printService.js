(function () {
    'use strict';

    var PrintService = {};

    PrintService.popupHtml = function (title, rowsHtml, columns) {
        var h = '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>' + ReportUtils.esc(title) + '</title>';
        h += '<style>\
            body { font-family: "Segoe UI", Arial, sans-serif; margin: 30px; color: #222; font-size: 12px; }\
            h2 { text-align: center; margin-bottom: 8px; }\
            .period { text-align: center; margin-bottom: 20px; color: #555; font-size: 13px; }\
            table { width: 100%; border-collapse: collapse; }\
            th { background: #f0f0f0; padding: 6px 8px; border: 1px solid #ccc; text-align: center; font-size: 11px; }\
            td { padding: 4px 8px; border: 1px solid #ccc; text-align: center; }\
            .total-row td { font-weight: bold; border-top: 2px solid #000; }\
            @media print { body { margin: 15px; } }\
        </style></head><body>';
        h += '<h2>' + ReportUtils.esc(title) + '</h2>';
        if (columns) {
            h += '<table><thead><tr>';
            for (var i = 0; i < columns.length; i++) {
                h += '<th>' + ReportUtils.esc(columns[i]) + '</th>';
            }
            h += '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
        }
        h += '<script>window.onload=function(){window.print();}<\/script></body></html>';
        return h;
    };

    PrintService.popup = function (title, rowsHtml, columns) {
        var w = window.open('', '_blank', 'width=1000,height=700');
        if (!w) {
            window.showAlert('الرجاء السماح للنوافذ المنبثقة', { title: 'تنبيه', type: 'warning' });
            return;
        }
        w.document.write(PrintService.popupHtml(title, rowsHtml, columns));
        w.document.close();
    };

    PrintService.cssPrint = function () {
        window.print();
    };

    window.PrintService = PrintService;
})();
