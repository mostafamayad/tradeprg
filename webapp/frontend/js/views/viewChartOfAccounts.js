(function () {
    'use strict';

    const fmt = (n) => {
        const v = Number(n || 0);
        return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    async function apiGet(endpoint) {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api' + endpoint, {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        return await res.json();
    }

    const treeState = {};

    function toggleNode(nodeId) {
        const children = document.getElementById('coa-children-' + nodeId);
        const icon = document.getElementById('coa-icon-' + nodeId);
        if (!children) return;
        const isHidden = children.style.display === 'none';
        children.style.display = isHidden ? 'block' : 'none';
        if (icon) {
            icon.className = 'fa-solid ' + (isHidden ? 'fa-chevron-down' : 'fa-chevron-left');
        }
        treeState[nodeId] = isHidden;
    }

    function renderTree(roots) {
        const root = document.getElementById('coa-root');
        if (!root) return;

        root.innerHTML = '<div class="page-card" style="min-height:400px"><div class="page-card-header"><div class="page-card-title"><i class="fa-solid fa-sitemap"></i> دليل الحسابات</div></div><div class="page-table-wrap" style="overflow-x:auto"><div class="coa-tree" id="coa-tree-container"></div></div></div>';

        const container = document.getElementById('coa-tree-container');
        if (!container || !roots || roots.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-open" style="font-size:3rem;color:var(--text-muted);margin-bottom:16px"></i><h3>لا توجد حسابات</h3><p style="color:var(--text-muted)">لم يتم إنشاء أي حساب بعد. قم بتهيئة شجرة الحسابات من لوحة الإعدادات.</p></div>';
            return;
        }

        const stack = [];
        for (let i = roots.length - 1; i >= 0; i--) {
            stack.push({ node: roots[i], parentEl: container, depth: 0 });
        }

        while (stack.length > 0) {
            const { node, parentEl, depth } = stack.pop();

            const nodeDiv = document.createElement('div');
            nodeDiv.className = 'coa-node depth-' + Math.min(depth, 5);

            const row = document.createElement('div');
            row.className = 'coa-node-row';

            const hasChildren = node.children && node.children.length > 0;

            const toggleSpan = document.createElement('span');
            toggleSpan.className = 'coa-toggle';
            if (hasChildren) {
                toggleSpan.innerHTML = '<i class="fa-solid fa-chevron-left" id="coa-icon-' + node.id + '"></i>';
                toggleSpan.onclick = (function (id) { return function () { toggleNode(id); }; })(node.id);
            } else {
                toggleSpan.innerHTML = '<span style="display:inline-block;width:16px"></span>';
            }
            row.appendChild(toggleSpan);

            const codeSpan = document.createElement('span');
            codeSpan.className = 'coa-code';
            codeSpan.textContent = node.account_code || '';
            row.appendChild(codeSpan);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'coa-name';
            nameSpan.textContent = node.account_name || '';
            row.appendChild(nameSpan);

            const balSpan = document.createElement('span');
            balSpan.className = 'coa-balance';
            const bal = Number(node.current_balance || 0);
            balSpan.textContent = fmt(bal) + ' ج.م';
            balSpan.style.color = (node.account_type === 'asset' || node.account_type === 'expense')
                ? (bal >= 0 ? 'var(--success-color, #059669)' : 'var(--danger-color, #dc2626)')
                : (bal >= 0 ? 'var(--danger-color, #dc2626)' : 'var(--success-color, #059669)');
            row.appendChild(balSpan);

            nodeDiv.appendChild(row);

            if (hasChildren) {
                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'coa-children';
                childrenDiv.id = 'coa-children-' + node.id;
                childrenDiv.style.display = depth < 1 ? 'block' : 'none';
                nodeDiv.appendChild(childrenDiv);

                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], parentEl: childrenDiv, depth: depth + 1 });
                }
            }

            parentEl.appendChild(nodeDiv);
        }
    }

    function injectStyles() {
        if (document.getElementById('coa-tree-styles')) return;
        const style = document.createElement('style');
        style.id = 'coa-tree-styles';
        style.textContent = `
            .coa-tree { font-size: 0.9rem; }
            .coa-node { }
            .coa-node-row {
                display: flex; align-items: center; padding: 10px 14px;
                cursor: pointer; border-radius: 6px; gap: 12px;
                border-bottom: 1px solid var(--border-color, #e5e7eb);
            }
            .coa-node-row:hover { background: var(--bg-body, #f8fafc); }
            .coa-toggle { width: 20px; text-align: center; color: var(--text-muted, #6b7280); cursor: pointer; flex-shrink:0; }
            .coa-code {
                font-family: 'Courier New', monospace; color: var(--primary-color, #7c3aed);
                font-weight: 600; min-width: 60px; flex-shrink:0; direction:ltr; text-align:left;
            }
            .coa-name { flex: 1; font-weight: 500; }
            .coa-balance { font-family: 'Courier New', monospace; font-weight: 600; min-width: 120px; text-align: right; direction: ltr; }

            .depth-0 > .coa-node-row { font-weight: 700; border-bottom: 2px solid var(--border-color, #e5e7eb); padding: 14px 14px; }
            .depth-0 > .coa-node-row .coa-code { font-size: 1rem; }
            .depth-1 > .coa-node-row { padding-right: 30px; }
            .depth-2 > .coa-node-row { padding-right: 55px; }
            .depth-3 > .coa-node-row { padding-right: 80px; }
            .depth-4 > .coa-node-row { padding-right: 105px; }
            .depth-5 > .coa-node-row { padding-right: 130px; }

            .coa-children { display: none; }
            .coa-children:first-of-type { display: block; }
        `;
        document.head.appendChild(style);
    }

    window.loadChartOfAccounts = async function () {
        const root = document.getElementById('coa-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل شجرة الحسابات...</p></div>';

        try {
            const res = await apiGet('/accounting/accounts/tree');
            if (res.success && res.data) {
                renderTree(res.data);
            } else {
                root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--warning-color,#f59e0b);margin-bottom:16px"></i><h3>فشل تحميل البيانات</h3><p style="color:var(--text-muted)">' + esc(res.message || 'خطأ غير معروف') + '</p></div>';
            }
        } catch (err) {
            root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ في الاتصال</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        }
    };

})();
