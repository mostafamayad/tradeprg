(function () {
    'use strict';

    const ACCOUNT_TYPES = [
        { value: 'asset', label: 'أصل' },
        { value: 'liability', label: 'خصم' },
        { value: 'equity', label: 'حق ملكية' },
        { value: 'revenue', label: 'إيراد' },
        { value: 'expense', label: 'مصروف' }
    ];

    const fmt = (n) => {
        const v = Number(n || 0);
        return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let cachedTreeData = null;

    async function apiFetch(endpoint, method, body) {
        const token = localStorage.getItem('auth_token');
        const opt = { method, headers: { 'Content-Type': 'application/json' } };
        if (token) opt.headers['Authorization'] = 'Bearer ' + token;
        if (body) opt.body = JSON.stringify(body);
        const res = await fetch('/api' + endpoint, opt);
        return await res.json();
    }

    function toggleNode(nodeId) {
        const children = document.getElementById('coa-children-' + nodeId);
        const icon = document.getElementById('coa-icon-' + nodeId);
        if (!children) return;
        const isHidden = children.style.display === 'none';
        children.style.display = isHidden ? 'block' : 'none';
        if (icon) {
            icon.className = 'fa-solid ' + (isHidden ? 'fa-chevron-down' : 'fa-chevron-left');
        }
    }

    function flattenTree(nodes, depth) {
        let result = [];
        for (const n of nodes) {
            result.push({ ...n, _depth: depth });
            if (n.children && n.children.length > 0) {
                result = result.concat(flattenTree(n.children, depth + 1));
            }
        }
        return result;
    }

    function renderTree(roots) {
        cachedTreeData = roots;
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
            nodeDiv.className = 'coa-node depth-' + Math.min(depth, 5) + (node.is_active === 0 ? ' coa-inactive-node' : '');

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

            var toggleBtn = document.createElement('span');
            toggleBtn.className = 'coa-toggle-btn';
            var isActive = node.is_active !== 0;
            if (node.system_code) {
                toggleBtn.innerHTML = '<i class="fa-solid fa-toggle-on" style="color:var(--text-muted,#9ca3af);cursor:default" title="حساب نظامي"></i>';
            } else {
                toggleBtn.innerHTML = '<i class="fa-solid ' + (isActive ? 'fa-toggle-on coa-active' : 'fa-toggle-off coa-inactive') + '" style="cursor:pointer;font-size:1.1rem" title="' + (isActive ? 'تعطيل' : 'تفعيل') + '"></i>';
                toggleBtn.onclick = (function (id, active) { return function (e) { e.stopPropagation(); toggleAccountStatus(id, active); }; })(node.id, isActive);
            }
            row.appendChild(toggleBtn);

            var editBtn = document.createElement('span');
            editBtn.className = 'coa-edit';
            if (node.system_code) {
                editBtn.innerHTML = '<i class="fa-solid fa-ban" style="color:var(--text-muted,#9ca3af)" title="حساب نظامي لا يمكن تعديله"></i>';
            } else {
                editBtn.innerHTML = '<i class="fa-solid fa-pen" style="color:var(--primary-color,#7c3aed);cursor:pointer" title="تعديل"></i>';
                editBtn.onclick = (function (id) { return function (e) { e.stopPropagation(); showEditAccountModal(id); }; })(node.id);
            }
            row.appendChild(editBtn);

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
            .coa-edit { width: 24px; text-align: center; flex-shrink:0; }
            .coa-toggle-btn { width: 28px; text-align: center; flex-shrink:0; }
            .coa-toggle-btn .coa-active { color: var(--success-color, #059669); }
            .coa-toggle-btn .coa-inactive { color: var(--text-muted, #9ca3af); }
            .coa-inactive-node .coa-node-row { opacity: 0.55; }
            .coa-inactive-node .coa-node-row .coa-name { text-decoration: line-through; }
            .depth-0 > .coa-node-row { font-weight: 700; border-bottom: 2px solid var(--border-color, #e5e7eb); padding: 14px 14px; }
            .depth-0 > .coa-node-row .coa-code { font-size: 1rem; }
            .depth-1 > .coa-node-row { padding-right: 30px; }
            .depth-2 > .coa-node-row { padding-right: 55px; }
            .depth-3 > .coa-node-row { padding-right: 80px; }
            .depth-4 > .coa-node-row { padding-right: 105px; }
            .depth-5 > .coa-node-row { padding-right: 130px; }
            .coa-children { display: none; }
            .coa-children:first-of-type { display: block; }
            .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .form-grid-full { grid-column: 1 / -1; }
        `;
        document.head.appendChild(style);
    }

    function showAddAccountModal() {
        const modal = document.getElementById('global-modal');
        if (!modal) return;

        const titleEl = document.getElementById('modal-title');
        const bodyEl = document.getElementById('modal-body');
        const saveBtn = document.getElementById('btn-modal-save');

        titleEl.textContent = 'إضافة حساب جديد';

        let parentOptions = '<option value="">-- بدون أب (حساب رئيسي) --</option>';
        if (cachedTreeData) {
            const flat = flattenTree(cachedTreeData, 0);
            for (const acc of flat) {
                const indent = '\u00A0\u00A0'.repeat(acc._depth);
                const sysTag = acc.system_code ? ' [نظامي]' : '';
                parentOptions += '<option value="' + acc.id + '">' + indent + esc(acc.account_code) + ' - ' + esc(acc.account_name) + sysTag + '</option>';
            }
        }

        bodyEl.innerHTML = `
            <div class="form-grid-2">
                <div class="form-group">
                    <label>كود الحساب <span style="color:var(--danger-color)">*</span></label>
                    <input type="text" id="f-acc-code" placeholder="مثال: 1.2.3" maxlength="50">
                </div>
                <div class="form-group">
                    <label>نوع الحساب <span style="color:var(--danger-color)">*</span></label>
                    <select id="f-acc-type">
                        ${ACCOUNT_TYPES.map(t => '<option value="' + t.value + '">' + t.label + '</option>').join('')}
                    </select>
                </div>
                <div class="form-group form-grid-full">
                    <label>اسم الحساب <span style="color:var(--danger-color)">*</span></label>
                    <input type="text" id="f-acc-name" placeholder="الاسم العربي للحساب" maxlength="255">
                </div>
                <div class="form-group form-grid-full">
                    <label>الحساب الأب</label>
                    <select id="f-acc-parent">${parentOptions}</select>
                </div>
            </div>
            <div id="f-acc-error" style="color:var(--danger-color,#dc2626);margin-top:12px;display:none"></div>
        `;

        const parentSelect = document.getElementById('f-acc-parent');
        const typeSelect = document.getElementById('f-acc-type');

        parentSelect.addEventListener('change', function () {
            const val = this.value;
            if (val && cachedTreeData) {
                const flat = flattenTree(cachedTreeData, 0);
                const parent = flat.find(a => a.id === Number(val));
                if (parent && parent.account_type) {
                    typeSelect.value = parent.account_type;
                }
            }
        });

        const modalOverlay = modal;

        function onSave() {
            const code = document.getElementById('f-acc-code').value.trim();
            const name = document.getElementById('f-acc-name').value.trim();
            const type = document.getElementById('f-acc-type').value;
            const parentId = document.getElementById('f-acc-parent').value;

            if (!code || !name) {
                const errEl = document.getElementById('f-acc-error');
                errEl.textContent = 'كود الحساب واسم الحساب مطلوبان';
                errEl.style.display = 'block';
                return;
            }

            const errorEl = document.getElementById('f-acc-error');
            errorEl.style.display = 'none';

            saveBtn.disabled = true;
            saveBtn.textContent = 'جاري الحفظ...';

            apiFetch('/accounting/accounts', 'POST', {
                account_code: code,
                account_name: name,
                account_type: type,
                parent_id: parentId || null
            }).then(function (res) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'حفظ البيانات';
                if (res.success) {
                    modalOverlay.classList.remove('open');
                    renderAgain();
                } else {
                    errorEl.textContent = res.message || 'حدث خطأ أثناء الحفظ';
                    errorEl.style.display = 'block';
                }
            }).catch(function (err) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'حفظ البيانات';
                errorEl.textContent = err.message || 'خطأ في الاتصال';
                errorEl.style.display = 'block';
            });
        }

        saveBtn.onclick = onSave;

        var closeButtons = modalOverlay.querySelectorAll('.btn-close-modal');
        for (var i = 0; i < closeButtons.length; i++) {
            closeButtons[i].onclick = function () {
                saveBtn.onclick = null;
                modalOverlay.classList.remove('open');
            };
        }

        modalOverlay.classList.add('open');
    }

    function showEditAccountModal(accountId) {
        var modal = document.getElementById('global-modal');
        if (!modal) return;

        var titleEl = document.getElementById('modal-title');
        var bodyEl = document.getElementById('modal-body');
        var saveBtn = document.getElementById('btn-modal-save');

        apiFetch('/accounting/accounts/' + accountId, 'GET').then(function (account) {
            if (!account.success || !account.data) {
                alert(account.message || 'فشل تحميل بيانات الحساب');
                return;
            }

            var acc = account.data;
            titleEl.textContent = 'تعديل حساب: ' + acc.account_name;

            var parentOptions = '<option value="">-- بدون أب (حساب رئيسي) --</option>';
            if (cachedTreeData) {
                var flat = flattenTree(cachedTreeData, 0).filter(function (a) { return a.id !== accountId && !a.system_code; });
                for (var i = 0; i < flat.length; i++) {
                    var indent = '\u00A0\u00A0'.repeat(flat[i]._depth);
                    var selected = flat[i].id === Number(acc.parent_id) ? ' selected' : '';
                    parentOptions += '<option value="' + flat[i].id + '"' + selected + '>' + indent + esc(flat[i].account_code) + ' - ' + esc(flat[i].account_name) + '</option>';
                }
            }

            bodyEl.innerHTML = '\
                <div class="form-grid-2">\
                    <div class="form-group">\
                        <label>كود الحساب <span style="color:var(--danger-color)">*</span></label>\
                        <input type="text" id="f-acc-code" value="' + esc(acc.account_code) + '" maxlength="50">\
                    </div>\
                    <div class="form-group">\
                        <label>نوع الحساب <span style="color:var(--danger-color)">*</span></label>\
                        <select id="f-acc-type">\
                            ' + ACCOUNT_TYPES.map(function (t) { return '<option value="' + t.value + '"' + (t.value === acc.account_type ? ' selected' : '') + '>' + t.label + '</option>'; }).join('') + '\
                        </select>\
                    </div>\
                    <div class="form-group form-grid-full">\
                        <label>اسم الحساب <span style="color:var(--danger-color)">*</span></label>\
                        <input type="text" id="f-acc-name" value="' + esc(acc.account_name) + '" maxlength="255">\
                    </div>\
                    <div class="form-group form-grid-full">\
                        <label>الحساب الأب</label>\
                        <select id="f-acc-parent">' + parentOptions + '</select>\
                    </div>\
                </div>\
                <div id="f-acc-error" style="color:var(--danger-color,#dc2626);margin-top:12px;display:none"></div>\
            ';

            var parentSelect = document.getElementById('f-acc-parent');
            var typeSelect = document.getElementById('f-acc-type');

            parentSelect.addEventListener('change', function () {
                var val = this.value;
                if (val && cachedTreeData) {
                    var flat = flattenTree(cachedTreeData, 0);
                    var parent = flat.find(function (a) { return a.id === Number(val); });
                    if (parent && parent.account_type) {
                        typeSelect.value = parent.account_type;
                    }
                }
            });

            function onSave() {
                var code = document.getElementById('f-acc-code').value.trim();
                var name = document.getElementById('f-acc-name').value.trim();
                var type = document.getElementById('f-acc-type').value;
                var parentId = document.getElementById('f-acc-parent').value;

                if (!code || !name) {
                    var errEl = document.getElementById('f-acc-error');
                    errEl.textContent = 'كود الحساب واسم الحساب مطلوبان';
                    errEl.style.display = 'block';
                    return;
                }

                var errorEl = document.getElementById('f-acc-error');
                errorEl.style.display = 'none';

                saveBtn.disabled = true;
                saveBtn.textContent = 'جاري الحفظ...';

                apiFetch('/accounting/accounts/' + accountId, 'PUT', {
                    account_code: code,
                    account_name: name,
                    account_type: type,
                    parent_id: parentId || null
                }).then(function (res) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'حفظ البيانات';
                    if (res.success) {
                        modal.classList.remove('open');
                        renderAgain();
                    } else {
                        errorEl.textContent = res.message || 'حدث خطأ أثناء الحفظ';
                        errorEl.style.display = 'block';
                    }
                }).catch(function (err) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'حفظ البيانات';
                    errorEl.textContent = err.message || 'خطأ في الاتصال';
                    errorEl.style.display = 'block';
                });
            }

            saveBtn.onclick = onSave;

            var closeButtons = modal.querySelectorAll('.btn-close-modal');
            for (var j = 0; j < closeButtons.length; j++) {
                closeButtons[j].onclick = function () {
                    saveBtn.onclick = null;
                    modal.classList.remove('open');
                };
            }

            modal.classList.add('open');
        });
    }

    function toggleAccountStatus(accountId, currentlyActive) {
        var msg = currentlyActive ? 'هل أنت متأكد من تعطيل هذا الحساب؟' : 'هل أنت متأكد من تفعيل هذا الحساب؟';
        if (!window.confirm(msg)) return;

        apiFetch('/accounting/accounts/' + accountId + '/toggle', 'PATCH').then(function (res) {
            if (res.success) {
                if (cachedTreeData) {
                    var all = flattenTree(cachedTreeData, 0);
                    for (var i = 0; i < all.length; i++) {
                        if (all[i].id === accountId) {
                            all[i].is_active = currentlyActive ? 0 : 1;
                            break;
                        }
                    }
                }
                renderAgain();
            } else {
                alert(res.message || 'حدث خطأ');
            }
        }).catch(function (err) {
            alert(err.message || 'خطأ في الاتصال');
        });
    }

    function renderAgain() {
        const root = document.getElementById('coa-root');
        if (!root) return;
        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل شجرة الحسابات...</p></div>';
        apiFetch('/accounting/accounts/tree', 'GET').then(function (res) {
            if (res.success && res.data) renderTree(res.data);
        });
    }

    window.loadChartOfAccounts = async function () {
        const root = document.getElementById('coa-root');
        if (!root) return;
        if (root.dataset.bound) return;
        root.dataset.bound = '1';

        injectStyles();

        root.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem"></i><p style="margin-top:12px">جاري تحميل شجرة الحسابات...</p></div>';

        try {
            const res = await apiFetch('/accounting/accounts/tree', 'GET');
            if (res.success && res.data) {
                renderTree(res.data);
            } else {
                root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--warning-color,#f59e0b);margin-bottom:16px"></i><h3>فشل تحميل البيانات</h3><p style="color:var(--text-muted)">' + esc(res.message || 'خطأ غير معروف') + '</p></div>';
            }
        } catch (err) {
            root.innerHTML = '<div class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:3rem;color:var(--danger-color,#dc2626);margin-bottom:16px"></i><h3>خطأ في الاتصال</h3><p style="color:var(--text-muted)">' + esc(err.message) + '</p></div>';
        }
    };

    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('btn-add-account');
        if (btn) {
            btn.addEventListener('click', function () {
                if (!cachedTreeData) {
                    apiFetch('/accounting/accounts/tree', 'GET').then(function (res) {
                        if (res.success) {
                            cachedTreeData = res.data;
                        }
                        showAddAccountModal();
                    });
                } else {
                    showAddAccountModal();
                }
            });
        }
    });

})();
