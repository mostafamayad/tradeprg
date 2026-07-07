(function () {
    'use strict';

    var ReportFilters = {};

    ReportFilters.dateRange = function (container, config) {
        config = config || {};
        var fromId = config.fromId || 'rpt-from';
        var toId = config.toId || 'rpt-to';
        var fromLabel = config.fromLabel || 'من تاريخ';
        var toLabel = config.toLabel || 'إلى تاريخ';
        var fromVal = config.fromValue || '';
        var toVal = config.toValue || ReportUtils.todayStr();
        var onChange = config.onChange || null;

        var html = '<div class="page-filter-bar">' +
            '<div class="form-group"><label>' + ReportUtils.esc(fromLabel) + '</label><input type="date" id="' + fromId + '" class="form-control" value="' + fromVal + '"></div>' +
            '<div class="form-group"><label>' + ReportUtils.esc(toLabel) + '</label><input type="date" id="' + toId + '" class="form-control" value="' + toVal + '"></div>';

        if (config.extraFilters) {
            for (var i = 0; i < config.extraFilters.length; i++) {
                var f = config.extraFilters[i];
                var fhtml = f.html || '';
                if (f.type === 'select') {
                    var opts = '';
                    for (var k = 0; k < (f.options || []).length; k++) {
                        var o = f.options[k];
                        opts += '<option value="' + ReportUtils.esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + ReportUtils.esc(o.label) + '</option>';
                    }
                    fhtml = '<select id="' + (f.id || '') + '" class="form-control">' + opts + '</select>';
                } else if (f.type === 'text') {
                    fhtml = '<input type="text" id="' + (f.id || '') + '" class="form-control" placeholder="' + ReportUtils.esc(f.placeholder || '') + '" value="' + ReportUtils.esc(f.value || '') + '">';
                } else if (f.type === 'checkbox') {
                    fhtml = '<label style="display:flex;align-items:center;gap:6px;padding-top:6px"><input type="checkbox" id="' + (f.id || '') + '"' + (f.checked ? ' checked' : '') + '> ' + ReportUtils.esc(f.checkLabel || '') + '</label>';
                }
                html += '<div class="form-group">' + (f.label ? '<label>' + ReportUtils.esc(f.label) + '</label>' : '') + fhtml + '</div>';
            }
        }

        html += '<div class="form-group" style="display:flex;gap:8px;align-items:flex-end">';

        if (config.hideRefresh !== true) {
            html += '<button class="btn btn-primary" id="' + (config.refreshId || 'rpt-refresh') + '"><i class="fa-solid fa-rotate"></i> عرض</button>';
        }
        if (config.hidePrint !== true) {
            html += '<button class="btn btn-outline" id="' + (config.printId || 'rpt-print') + '" class="no-print"><i class="fa-solid fa-print"></i> طباعة</button>';
        }
        if (config.hideCsv !== true) {
            html += '<button class="btn btn-outline" id="' + (config.csvId || 'rpt-csv') + '" class="no-print"><i class="fa-solid fa-file-csv"></i> Excel</button>';
        }

        html += '</div></div>';

        if (container) {
            if (typeof container === 'string') container = document.getElementById(container);
            if (container) container.innerHTML = html;
        }

        return {
            fromId: fromId,
            toId: toId,
            getFrom: function () { return document.getElementById(fromId) ? document.getElementById(fromId).value : ''; },
            getTo: function () { return document.getElementById(toId) ? document.getElementById(toId).value : ''; }
        };
    };

    ReportFilters.buildFilterBarCSS = function (prefix) {
        return '\
            .' + prefix + '-filter-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: flex-end; }\
            .' + prefix + '-filter-bar .form-group { margin-bottom: 0; }\
            .' + prefix + '-filter-bar input, .' + prefix + '-filter-bar select { padding: 6px 10px; font-size: 0.9rem; }\
            .' + prefix + '-table-wrap { overflow-x: auto; }\
            .' + prefix + '-table-wrap .data-table th, .' + prefix + '-table-wrap .data-table td { white-space: nowrap; font-size: 0.85rem; }\
            .' + prefix + '-total-row td { font-weight: 700; border-top: 2px solid var(--border-color); }\
            @media print { .no-print { display: none !important; } }\
        ';
    };

    window.ReportFilters = ReportFilters;
})();
