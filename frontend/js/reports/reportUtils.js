(function () {
    'use strict';

    var ReportUtils = {};

    ReportUtils.r2 = function (n) {
        return Math.round(Number(n || 0) * 100) / 100;
    };

    ReportUtils.fmt = function (n) {
        return ReportUtils.r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    ReportUtils.esc = function (v) {
        return String(v || '').replace(/[&<>"']/g, function (m) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m;
        });
    };

    ReportUtils.todayStr = function () {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    ReportUtils.apiFetch = function (endpoint, params) {
        var token = localStorage.getItem('auth_token');
        var q = '';
        if (params) {
            var parts = [];
            for (var k in params) {
                if (params[k] !== '' && params[k] !== null && params[k] !== undefined) {
                    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
                }
            }
            if (parts.length) q = '?' + parts.join('&');
        }
        var opt = { method: 'GET', headers: {} };
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        return fetch('/api' + endpoint + q, opt).then(function (r) {
            if (r.status === 401) {
                localStorage.removeItem('auth_token');
                window.location.hash = '#login';
                throw new Error('انتهت الجلسة، الرجاء تسجيل الدخول مجددًا');
            }
            return r.json();
        });
    };

    window.ReportUtils = ReportUtils;
})();
