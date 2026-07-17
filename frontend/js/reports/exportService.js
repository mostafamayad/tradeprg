(function () {
    'use strict';

    var ExportService = {};

    ExportService.exportReport = function (type, opts) {
        if (type === 'csv' || type === 'excel') {
            ExportService.csv(opts.filename || 'report', opts.headers || [], opts.rows || []);
        } else if (type === 'pdf') {
            console.warn('PDF export not yet implemented');
        }
    };

    ExportService.csv = function (filename, headers, rows) {
        if (window.exportStyledExcel) {
            // Strip .csv or .xlsx if present, as the utility adds it
            var cleanFilename = filename.replace(/\.(csv|xlsx)$/i, '');
            
            window.exportStyledExcel({
                filename: cleanFilename,
                title: cleanFilename, // Can be overridden if needed
                headers: headers,
                data: rows
            });
        } else {
            // Fallback
            var csv = '\uFEFF';
            csv += headers.join(',') + '\r\n';
            for (var i = 0; i < rows.length; i++) {
                var cols = [];
                for (var j = 0; j < rows[i].length; j++) {
                    var val = String(rows[i][j] || '');
                    if (val.indexOf(',') >= 0 || val.indexOf('"') >= 0 || val.indexOf('\n') >= 0) {
                        val = '"' + val.replace(/"/g, '""') + '"';
                    }
                    cols.push(val);
                }
                csv += cols.join(',') + '\r\n';
            }

            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename + (filename.indexOf('.csv') === -1 ? '.csv' : '');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }
    };

    window.ExportService = ExportService;
})();
