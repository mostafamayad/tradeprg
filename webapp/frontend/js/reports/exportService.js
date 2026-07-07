(function () {
    'use strict';

    var ExportService = {};

    ExportService.csv = function (filename, headers, rows) {
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
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    };

    window.ExportService = ExportService;
})();
