(function () {
    'use strict';

    var Pagination = {};

    Pagination.render = function (container, opts) {
        opts = opts || {};
        var page = opts.page || 1;
        var pageSize = opts.pageSize || 20;
        var total = opts.total || 0;
        var totalPages = Math.ceil(total / pageSize) || 1;
        var onChange = opts.onChange || function () {};

        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;

        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        var h = '<div class="pagination-bar" style="display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 0;margin-top:8px">';

        h += '<button class="btn btn-outline btn-sm" data-pg-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>';
        h += '<i class="fa-solid fa-chevron-right"></i> السابق</button>';

        h += '<span style="font-size:0.9rem">الصفحة ' + page + ' من ' + totalPages + ' (إجمالي ' + total + ')</span>';

        h += '<button class="btn btn-outline btn-sm" data-pg-page="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>';
        h += 'التالي <i class="fa-solid fa-chevron-left"></i></button>';

        h += '</div>';

        container.innerHTML = h;

        container.querySelectorAll('[data-pg-page]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                var p = parseInt(this.getAttribute('data-pg-page'));
                if (p >= 1 && p <= totalPages) {
                    onChange(p);
                }
            });
        });
    };

    window.Pagination = Pagination;
})();
