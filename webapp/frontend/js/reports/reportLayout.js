(function () {
    'use strict';

    var counter = 0;

    function uniqueId(prefix) {
        return prefix + '-' + (++counter);
    }

    var ReportLayout = {};

    ReportLayout.create = function (containerId, config) {
        var root = document.getElementById(containerId);
        if (!root) return null;

        config = config || {};
        var title = config.title || '';
        var subtitle = config.subtitle || '';

        var filterId = config.filterId || uniqueId('rpt-filter');
        var tableId = config.tableId || uniqueId('rpt-table');
        var summaryId = config.summaryId || uniqueId('rpt-summary');
        var actionsId = config.actionsId || uniqueId('rpt-actions');
        var toolbarId = config.toolbarId || uniqueId('rpt-toolbar');

        root.innerHTML =
            '<div class="page-section">' +
                '<div class="page-card">' +
                    '<div class="page-card-header">' +
                        '<div class="page-card-title">' + (config.icon ? '<i class="fa-solid fa-' + config.icon + '"></i> ' : '') + ReportUtils.esc(title) + '</div>' +
                        (config.headerButtons || '') +
                    '</div>' +
                    (subtitle ? '<p class="page-subtitle" style="margin-top:-16px;margin-bottom:16px">' + ReportUtils.esc(subtitle) + '</p>' : '') +
                    '<div id="' + filterId + '"></div>' +
                    '<div class="page-toolbar" id="' + toolbarId + '"></div>' +
                    '<div class="page-table-wrap" id="' + tableId + '"></div>' +
                    '<div id="' + summaryId + '"></div>' +
                    '<div id="' + actionsId + '"></div>' +
                '</div>' +
            '</div>';

        return {
            filterId: filterId,
            tableId: tableId,
            summaryId: summaryId,
            actionsId: actionsId,
            toolbarId: toolbarId
        };
    };

    ReportLayout.injectStyles = function (viewId, cssRules) {
        var id = viewId + '-styles';
        if (document.getElementById(id)) return;
        var s = document.createElement('style');
        s.id = id;
        s.textContent = cssRules;
        document.head.appendChild(s);
    };

    ReportLayout.getIds = function (containerId) {
        return {
            filter: containerId + '-filter',
            table: containerId + '-table',
            summary: containerId + '-summary',
            actions: containerId + '-actions',
            toolbar: containerId + '-toolbar'
        };
    };

    window.ReportLayout = ReportLayout;
})();
