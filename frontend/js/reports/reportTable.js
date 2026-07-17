(function () {
    'use strict';

    var ReportTable = {};

    function cellStyle(c) {
        var s = '';
        if (c.width) s += 'width:' + c.width + ';';
        if (c.align) s += 'text-align:' + c.align + ';';
        return s ? ' style="' + s + '"' : '';
    }

    function buildHead(columns) {
        var h = '<thead><tr>';
        for (var i = 0; i < columns.length; i++) {
            var c = columns[i];
            h += '<th' + cellStyle(c) + (c.className ? ' class="' + c.className + '"' : '') + '>' + ReportUtils.esc(c.label) + '</th>';
        }
        h += '</tr></thead>';
        return h;
    }

    function buildBody(columns, data, onRowClick) {
        var h = '<tbody>';
        for (var i = 0; i < data.length; i++) {
            var row = data[i];
            var trClass = row._className || '';
            var trClick = '';
            if (onRowClick) {
                trClick = ' style="cursor:pointer" onclick="ReportTable._handleRowClick(' + i + ', this)"';
            } else if (row._onclick) {
                trClick = ' onclick="' + row._onclick + '"';
            }
            h += '<tr class="' + trClass + '"' + trClick + ' data-rpt-row="' + i + '">';
            for (var j = 0; j < columns.length; j++) {
                var c = columns[j];
                var val = row[c.key] !== undefined ? row[c.key] : '';
                if (c.formatter) {
                    val = c.formatter(val, row, i);
                } else if (typeof val === 'number') {
                    val = ReportUtils.fmt(val);
                } else {
                    val = ReportUtils.esc(val);
                }
                h += '<td' + cellStyle(c) + (c.colspan && row[c.colspan] ? ' colspan="' + row[c.colspan] + '"' : '') + (c.tdClass ? ' class="' + c.tdClass + '"' : '') + '>' + val + '</td>';
            }
            h += '</tr>';
        }
        h += '</tbody>';
        return h;
    }

    ReportTable._rowData = null;
    ReportTable._onRowClick = null;

    ReportTable._handleRowClick = function (index, el) {
        if (ReportTable._onRowClick && ReportTable._rowData && ReportTable._rowData[index]) {
            ReportTable._onRowClick(ReportTable._rowData[index], index, el);
        }
    };

    ReportTable.render = function (container, columns, data, opts) {
        opts = opts || {};
        var tblClass = opts.tableClass || 'data-table';
        var tblStyle = opts.tableStyle || 'width:100%';

        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;

        if (opts.state) {
            var colspan = columns.length;
            if (opts.state === 'loading') {
                container.innerHTML = '<table class="' + tblClass + '" style="' + tblStyle + '"><tbody><tr><td colspan="' + colspan + '" style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem"></i><p style="margin-top:8px">جاري التحميل...</p></td></tr></tbody></table>';
                return;
            }
            if (opts.state === 'empty') {
                container.innerHTML = '<table class="' + tblClass + '" style="' + tblStyle + '"><tbody><tr><td colspan="' + colspan + '" style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-inbox" style="font-size:2rem"></i><p style="margin-top:8px">' + ReportUtils.esc(opts.emptyMessage || 'لا توجد نتائج') + '</p></td></tr></tbody></table>';
                return;
            }
            if (opts.state === 'error') {
                container.innerHTML = '<table class="' + tblClass + '" style="' + tblStyle + '"><tbody><tr><td colspan="' + colspan + '" style="text-align:center;padding:40px;color:var(--danger-color)"><i class="fa-solid fa-circle-exclamation" style="font-size:2rem"></i><p style="margin-top:8px">' + ReportUtils.esc(opts.errorMessage || 'حدث خطأ') + '</p></td></tr></tbody></table>';
                return;
            }
        }

        if (!data || data.length === 0) {
            ReportTable.render(container, columns, data, Object.assign({}, opts, { state: 'empty', emptyMessage: opts.emptyMessage }));
            return;
        }

        ReportTable._rowData = data;
        ReportTable._onRowClick = opts.onRowClick || null;
        ReportTable._columns = columns;

        var html = '<table class="' + tblClass + '" style="' + tblStyle + '">';
        html += buildHead(columns);
        html += buildBody(columns, data, opts.onRowClick);
        html += '</table>';
        container.innerHTML = html;
    };

    ReportTable.buildSummary = function (container, items) {
        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;
        var h = '<div style="display:flex;gap:24px;flex-wrap:wrap;padding:12px 0;border-top:2px solid var(--border-color);font-weight:700">';
        for (var i = 0; i < items.length; i++) {
            h += '<span>' + ReportUtils.esc(items[i].label) + ': <span style="color:var(--primary-color)">' + items[i].value + '</span></span>';
        }
        h += '</div>';
        container.innerHTML = h;
    };

    window.ReportTable = ReportTable;
})();
