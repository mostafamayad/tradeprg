let rolesCache = [];
let permissionsCache = [];
let usersCache = [];
let _vuEventsBound = false;
let _permSearchTerm = '';
let _vuCollapsedModules = {};

async function loadRoles() {
    try {
        const res = await fetch('/api/rbac/roles', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } });
        const json = await res.json();
        if (json.success) rolesCache = json.data;
        return rolesCache;
    } catch (e) { return []; }
}

async function loadPermissions() {
    try {
        const res = await fetch('/api/rbac/permissions/grouped', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } });
        const json = await res.json();
        if (json.success) permissionsCache = json.data;
        return permissionsCache;
    } catch (e) { return {}; }
}

async function loadUsers() {
    try {
        const res = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } });
        const json = await res.json();
        if (json.success) usersCache = json.data;
        return usersCache;
    } catch (e) { return []; }
}

const MODULE_NAMES = {
    'dashboard': '\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645',
    'sales': '\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
    'sales_returns': '\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
    'purchases': '\u0627\u0644\u0645\u0634\u062a\u0631\u064a\u0627\u062a',
    'purchase_returns': '\u0645\u0631\u062a\u062c\u0639\u0627\u062a \u0627\u0644\u0645\u0634\u062a\u0631\u064a\u0627\u062a',
    'customers': '\u0627\u0644\u0639\u0645\u0644\u0627\u0621',
    'collections': '\u0627\u0644\u062a\u062d\u0635\u064a\u0644\u0627\u062a',
    'suppliers': '\u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646',
    'payments': '\u0645\u062f\u0641\u0648\u0639\u0627\u062a \u0627\u0644\u0645\u0648\u0631\u062f\u064a\u0646',
    'products': '\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a',
    'inventory': '\u0627\u0644\u0645\u062e\u0632\u0648\u0646',
    'stores': '\u0627\u0644\u0645\u062e\u0627\u0632\u0646',
    'reps': '\u0627\u0644\u0645\u0646\u062f\u0648\u0628\u064a\u0646',
    'treasury': '\u0627\u0644\u062e\u0632\u064a\u0646\u0629',
    'accounting': '\u0627\u0644\u0645\u062d\u0627\u0633\u0628\u0629',
    'accounts': '\u062f\u0644\u064a\u0644 \u0627\u0644\u062d\u0633\u0627\u0628\u0627\u062a',
    'reports': '\u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631',
    'users': '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646',
    'settings': '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',
    'logs': '\u0633\u062c\u0644 \u0627\u0644\u0639\u0645\u0644\u064a\u0627\u062a',
    'commission': '\u0627\u0644\u0639\u0645\u0648\u0644\u0627\u062a',
    'fiscal_periods': '\u0627\u0644\u0641\u062a\u0631\u0627\u062a \u0627\u0644\u0645\u0627\u0644\u064a\u0629',
    'hr': '\u0634\u0624\u0648\u0646 \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646',
    'journals': '\u0642\u064a\u0648\u062f \u0627\u0644\u064a\u0648\u0645\u064a\u0629',
    'special': '\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u062e\u0627\u0635\u0629'
};

function getActionLabel(code) {
    const map = {
        'view': '\u0639\u0631\u0636',
        'create': '\u0625\u0636\u0627\u0641\u0629',
        'update': '\u062a\u0639\u062f\u064a\u0644',
        'delete': '\u062d\u0630\u0641',
        'approve': '\u0627\u0639\u062a\u0645\u0627\u062f',
        'print': '\u0637\u0628\u0627\u0639\u0629',
        'export': '\u062a\u0635\u062f\u064a\u0631',
        'block': '\u062d\u0638\u0631',
        'adjust': '\u062a\u0633\u0648\u064a\u0629',
        'transfer': '\u062a\u062d\u0648\u064a\u0644',
        'journals': '\u0642\u064a\u0648\u062f \u064a\u0648\u0645\u064a\u0629',
        'trial_balance': '\u0645\u064a\u0632\u0627\u0646 \u0645\u0631\u0627\u062c\u0639\u0629',
        'income_statement': '\u0642\u0627\u0626\u0645\u0629 \u062f\u062e\u0644',
        'balance_sheet': '\u0645\u064a\u0632\u0627\u0646\u064a\u0629 \u0639\u0645\u0648\u0645\u064a\u0629',
        'ledger': '\u0623\u0633\u062a\u0627\u0630 \u0639\u0627\u0645',
        'manage': '\u0625\u062f\u0627\u0631\u0629',
        'close': '\u0625\u063a\u0644\u0627\u0642',
        'reopen': '\u0625\u0639\u0627\u062f\u0629 \u0641\u062a\u062d',
        'roles': '\u0623\u062f\u0648\u0627\u0631 \u0648\u0635\u0644\u0627\u062d\u064a\u0627\u062a',
        'sales': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0645\u0628\u064a\u0639\u0627\u062a',
        'purchases': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0645\u0634\u062a\u0631\u064a\u0627\u062a',
        'inventory': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0645\u062e\u0632\u0648\u0646',
        'profit': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0623\u0631\u0628\u0627\u062d',
        'customers': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0639\u0645\u0644\u0627\u0621',
        'suppliers': '\u062a\u0642\u0627\u0631\u064a\u0631 \u0645\u0648\u0631\u062f\u064a\u0646',
        'count': '\u062c\u0631\u062f',
        'disposal': '\u062a\u0648\u0627\u0644\u0641',
        'damaged': '\u0645\u062e\u0644\u0641\u0627\u062a',
        'reverse': '\u0639\u0643\u0633',
        'discount_approve': '\u0627\u0639\u062a\u0645\u0627\u062f \u062e\u0635\u0645',
        'post': '\u062a\u0631\u062d\u064a\u0644',
        'edit': '\u062a\u062d\u0631\u064a\u0631',
        'company_settings': '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0634\u0631\u0643\u0629',
        'system_settings': '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645',
        'database_backup': '\u0646\u0633\u062e \u0627\u062d\u062a\u064a\u0627\u0637\u064a',
        'database_restore': '\u0627\u0633\u062a\u0639\u0627\u062f\u0629 \u0646\u0633\u062e\u0629',
        'license_manage': '\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u062a\u0631\u062e\u064a\u0635',
        'view_logs': '\u0639\u0631\u0636 \u0633\u062c\u0644',
        'export_data': '\u062a\u0635\u062f\u064a\u0631 \u0628\u064a\u0627\u0646\u0627\u062a',
        'import_data': '\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0628\u064a\u0627\u0646\u0627\u062a',
        'fiscal_year': '\u0625\u062f\u0627\u0631\u0629 \u0633\u0646\u0629 \u0645\u0627\u0644\u064a\u0629',
        'delete_journal': '\u062d\u0630\u0641 \u0642\u064a\u062f',
        'reverse_journal': '\u0639\u0643\u0633 \u0642\u064a\u062f',
        'edit_chart_of_accounts': '\u062a\u0639\u062f\u064a\u0644 \u062f\u0644\u064a\u0644 \u062d\u0633\u0627\u0628\u0627\u062a',
        'close_period': '\u0625\u063a\u0644\u0627\u0642 \u0641\u062a\u0631\u0629',
        'reopen_period': '\u0625\u0639\u0627\u062f\u0629 \u0641\u062a\u062d \u0641\u062a\u0631\u0629'
    };
    const parts = code.split('.');
    const action = parts.length > 1 ? parts.slice(1).join('.') : code;
    return map[action] || action;
}

function getModuleDisplayName(module) {
    return MODULE_NAMES[module] || module;
}

function _vuOpenModal(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('active'); document.body.style.overflow = 'hidden'; }
}

function _vuCloseModal(id) {
    var el = document.getElementById(id);
    if (el) { el.classList.remove('active'); document.body.style.overflow = ''; }
}

async function viewUsers(mainEl) {
    const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
    const canCreate = hasPerm('users.create');
    const canEdit = hasPerm('users.edit');
    const canDelete = hasPerm('users.delete');
    const canManageRoles = hasPerm('users.assign_permissions');

    await Promise.all([loadRoles(), loadUsers()]);

    mainEl.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 class="page-title">\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a</h1>
        <p class="page-subtitle">\u0625\u062f\u0627\u0631\u0629 \u0645\u0633\u062a\u062e\u062f\u0645\u064a \u0627\u0644\u0646\u0638\u0627\u0645 \u0648\u062a\u0639\u064a\u064a\u0646 \u0627\u0644\u0623\u062f\u0648\u0627\u0631 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0644\u0643\u0644 \u0645\u0633\u062a\u062e\u062f\u0645</p>
      </div>
      ${canCreate ? `<button class="btn btn-primary" id="vu-btn-add"><i class="fa-solid fa-user-plus"></i> \u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u062a\u062e\u062f\u0645</button>` : ''}
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <h3><i class="fa-solid fa-shield-halved"></i> \u0627\u0644\u0623\u062f\u0648\u0627\u0631 \u0648\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-outline" id="vu-import-role-btn"><i class="fa-solid fa-file-import"></i> \u0627\u0633\u062a\u064a\u0631\u0627\u062f</button>
          <button class="btn btn-sm btn-outline" id="vu-compare-roles-btn"><i class="fa-solid fa-not-equal"></i> \u0645\u0642\u0627\u0631\u0646\u0629</button>
        </div>
      </div>
      <div class="card-body" id="vu-roles-list" style="display:flex;flex-wrap:wrap;gap:8px;padding:12px"></div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="data-table" id="users-table">
          <thead>
            <tr>
              <th>\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645</th>
              <th>\u0627\u0644\u0627\u0633\u0645 \u0628\u0627\u0644\u0643\u0627\u0645\u0644</th>
              <th>\u0627\u0644\u0623\u062f\u0648\u0627\u0631</th>
              <th>\u062d\u0627\u0644\u0629 \u0627\u0644\u062d\u0633\u0627\u0628</th>
              <th style="width:220px">\u0627\u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a</th>
            </tr>
          </thead>
          <tbody id="users-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="modal-overlay" id="user-modal">
      <div class="modal-content" style="max-width:600px">
        <div class="modal-header">
          <h3 id="user-modal-title">\u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u062a\u062e\u062f\u0645</h3>
          <button class="icon-btn" id="vu-close-user"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>\u0627\u0644\u0628\u0631\u064a\u062f \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a</label>
              <input type="email" id="user-email" class="form-control" required>
            </div>
            <div class="form-group">
              <label>\u0627\u0644\u0627\u0633\u0645 \u0628\u0627\u0644\u0643\u0627\u0645\u0644</label>
              <input type="text" id="user-name" class="form-control" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group" id="password-field-group">
              <label>\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631</label>
              <input type="password" id="user-password" class="form-control" minlength="6">
              <small style="color:#888">6 \u0623\u062d\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644</small>
            </div>
          </div>
          <div class="form-group">
            <label>\u0627\u0644\u0623\u062f\u0648\u0627\u0631</label>
            <div id="user-roles-checkboxes" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="vu-cancel-user">\u0625\u0644\u063a\u0627\u0621</button>
          <button class="btn btn-primary" id="vu-save-user">\u062d\u0641\u0638</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="perm-modal">
      <div class="modal-content" style="max-width:900px">
        <div class="modal-header">
          <h3 id="perm-modal-title">\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645</h3>
          <button class="icon-btn" id="vu-close-perm"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <input type="text" id="perm-search-input" class="form-control" placeholder="\u0628\u062d\u062b \u0639\u0646 \u0635\u0644\u0627\u062d\u064a\u0629..." style="flex:1;min-width:150px" oninput="_permSearchTerm=this.value;renderPermGrid()">
            <span id="vu-perm-count-badge" style="background:#7c3aed;border-radius:6px;padding:6px 12px;font-size:0.8rem;color:#fff;display:flex;align-items:center;white-space:nowrap;font-weight:600">0 / 0</span>
            <button class="btn btn-sm btn-outline" id="vu-select-all" title="\u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0643\u0644"><i class="fa-solid fa-check-double"></i> \u0627\u0644\u0643\u0644</button>
            <button class="btn btn-sm btn-outline" id="vu-deselect-all" title="\u0625\u0644\u063a\u0627\u0621 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0643\u0644"><i class="fa-solid fa-xmark"></i> \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0643\u0644</button>
          </div>
          <div id="perm-modal-body" style="max-height:55vh;overflow-y:auto"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="vu-cancel-perm">\u0625\u063a\u0644\u0627\u0642</button>
          <button class="btn btn-primary" id="vu-save-perm">\u062d\u0641\u0638 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="history-modal">
      <div class="modal-content" style="max-width:700px">
        <div class="modal-header">
          <h3 id="history-modal-title">\u0633\u062c\u0644 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u062f\u0648\u0631</h3>
          <button class="icon-btn" id="vu-close-history"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="modal-body" id="history-modal-body" style="max-height:60vh;overflow-y:auto"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="vu-cancel-history">\u0625\u063a\u0644\u0627\u0642</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="compare-modal">
      <div class="modal-content" style="max-width:900px">
        <div class="modal-header">
          <h3>\u0645\u0642\u0627\u0631\u0646\u0629 \u0627\u0644\u0623\u062f\u0648\u0627\u0631</h3>
          <button class="icon-btn" id="vu-close-compare"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="modal-body" id="compare-modal-body" style="max-height:60vh;overflow-y:auto"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="vu-cancel-compare">\u0625\u063a\u0644\u0627\u0642</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="password-modal">
      <div class="modal-content" style="max-width:450px">
        <div class="modal-header">
          <h3>\u062a\u063a\u064a\u064a\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631</h3>
          <button class="icon-btn" id="vu-close-pwd"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group" id="pwd-current-group" style="display:none">
            <label>\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062d\u0627\u0644\u064a\u0629</label>
            <input type="password" id="pwd-current" class="form-control">
          </div>
          <div class="form-group">
            <label>\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062c\u062f\u064a\u062f\u0629</label>
            <input type="password" id="pwd-new" class="form-control" minlength="6">
            <small style="color:#888">6 \u0623\u062d\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644</small>
          </div>
          <div class="form-group">
            <label>\u062a\u0623\u0643\u064a\u062f \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631</label>
            <input type="password" id="pwd-confirm" class="form-control">
            <small id="pwd-match" style="color:#e53e3e;display:none">\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0645\u062a\u0637\u0627\u0628\u0642\u0629</small>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="vu-cancel-pwd">\u0625\u0644\u063a\u0627\u0621</button>
          <button class="btn btn-primary" id="vu-save-pwd" disabled>\u062d\u0641\u0638</button>
        </div>
      </div>
    </div>`;

    renderRolesList();
    renderUsersTable();
    bindViewUsersEvents(mainEl);
    startPermissionsPolling();
}

let _permPollInterval = null;

function startPermissionsPolling() {
    if (_permPollInterval) clearInterval(_permPollInterval);
    _permPollInterval = setInterval(async () => {
        try {
            // Skip polling while permissions modal is open (user is editing)
            var modal = document.getElementById('perm-modal');
            if (modal && modal.classList.contains('active')) return;

            const user = JSON.parse(localStorage.getItem('auth_user') || '{}');
            const ver = user.permissions_version || 0;
            const res = await fetch('/api/rbac/check-permissions-version?version=' + ver, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
            });
            const json = await res.json();
            if (json.success && json.data.changed) {
                clearInterval(_permPollInterval);
                _permPollInterval = null;
                if (typeof window.showAlert === 'function') {
                    await window.showAlert('\u062a\u0645 \u062a\u063a\u064a\u064a\u0631 \u0635\u0644\u0627\u062d\u064a\u0627\u062a\u0643 \u0648\u0633\u064a \u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u062e\u0631\u0648\u062c\u0643 \u0644\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a', {
                        title: '\u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a',
                        type: 'danger',
                        confirmText: '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c'
                    });
                }
                window.logout();
            }
        } catch (e) {}
    }, 15000);
}

function renderRolesList() {
    var container = document.getElementById('vu-roles-list');
    if (!container) return;
    container.innerHTML = rolesCache.map(function(r) {
        var pct = Math.round((r.permission_count / 121) * 100);
        var barColor = pct > 80 ? '#22c55e' : pct > 40 ? '#eab308' : '#ef4444';
        var isSA = r.name === 'super_admin';
        return '<div class="vu-role-card" data-role-id="' + r.id + '" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;min-width:180px;flex:1">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
            '<strong style="font-size:0.85rem;color:' + (isSA ? '#7c3aed' : '#1e293b') + '">' + escapeHtml(r.display_name) + '</strong>' +
            (isSA ? '<span class="badge badge-warning" style="font-size:10px">\u0646\u0638\u0627\u0645\u064a</span>' : '') +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
            '<span style="font-size:0.75rem;color:#64748b;font-weight:600">' + r.permission_count + ' / 121</span>' +
            '<div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px"><div style="width:' + pct + '%;height:100%;background:' + barColor + ';border-radius:2px;transition:width 0.3s"></div></div>' +
            '</div>' +
            (!isSA ? '<div style="display:flex;gap:4px;margin-top:6px">' +
                '<button class="vu-role-clone btn btn-sm btn-outline" data-role-id="' + r.id + '" title="\u0646\u0633\u062e \u0627\u0644\u062f\u0648\u0631" style="font-size:0.7rem;padding:2px 8px"><i class="fa-solid fa-copy"></i></button>' +
                '<button class="vu-role-export btn btn-sm btn-outline" data-role-id="' + r.id + '" title="\u062a\u0635\u062f\u064a\u0631" style="font-size:0.7rem;padding:2px 8px"><i class="fa-solid fa-file-export"></i></button>' +
                '<button class="vu-role-history btn btn-sm btn-outline" data-role-id="' + r.id + '" title="\u0633\u062c\u0644 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a" style="font-size:0.7rem;padding:2px 8px"><i class="fa-solid fa-clock-rotate-left"></i></button>' +
                '<button class="vu-role-compare btn btn-sm btn-outline" data-role-id="' + r.id + '" title="\u0645\u0642\u0627\u0631\u0646\u0629" style="font-size:0.7rem;padding:2px 8px"><i class="fa-solid fa-not-equal"></i></button>' +
                '</div>' : '') +
            '</div>';
    }).join('');
}

function bindViewUsersEvents(mainEl) {
    if (_vuEventsBound) return;
    _vuEventsBound = true;

    mainEl.addEventListener('click', function(e) {
        var btn = e.target.closest('#vu-btn-add, #vu-close-user, #vu-cancel-user, #vu-save-user, #vu-close-perm, #vu-cancel-perm, #vu-save-perm, #vu-close-pwd, #vu-cancel-pwd, #vu-save-pwd, #vu-close-history, #vu-cancel-history, #vu-close-compare, #vu-cancel-compare, #vu-import-role-btn, #vu-compare-roles-btn');
        if (!btn) btn = e.target.closest('.vu-edit, .vu-perms, .vu-pwd, .vu-toggle, .vu-delete, .vu-role-clone, .vu-role-export, .vu-role-history, .vu-role-compare');
        if (!btn) return;
        var id = btn.id;
        if (id === 'vu-btn-add') { e.preventDefault(); openUserModal(null); return; }
        if (id === 'vu-close-user' || id === 'vu-cancel-user') { e.preventDefault(); closeUserModal(); return; }
        if (id === 'vu-save-user') { e.preventDefault(); saveUser(); return; }
        if (id === 'vu-close-perm' || id === 'vu-cancel-perm') { e.preventDefault(); closePermModal(); return; }
        if (id === 'vu-save-perm') { e.preventDefault(); savePerms(); return; }
        if (id === 'vu-select-all') { e.preventDefault(); selectAllPerms(); return; }
        if (id === 'vu-deselect-all') { e.preventDefault(); deselectAllPerms(); return; }
        if (id === 'vu-close-pwd' || id === 'vu-cancel-pwd') { e.preventDefault(); closePasswordModal(); return; }
        if (id === 'vu-save-pwd') { e.preventDefault(); savePassword(); return; }
        if (id === 'vu-close-history' || id === 'vu-cancel-history') { e.preventDefault(); _vuCloseModal('history-modal'); return; }
        if (id === 'vu-close-compare' || id === 'vu-cancel-compare') { e.preventDefault(); _vuCloseModal('compare-modal'); return; }
        if (id === 'vu-import-role-btn') { e.preventDefault(); importRole(); return; }
        if (id === 'vu-compare-roles-btn') { e.preventDefault(); openCompareModal(); return; }
        if (btn.classList.contains('vu-edit')) { e.preventDefault(); openUserModal(parseInt(btn.dataset.id)); return; }
        if (btn.classList.contains('vu-perms')) { e.preventDefault(); openPermModal(parseInt(btn.dataset.id)); return; }
        if (btn.classList.contains('vu-pwd')) { e.preventDefault(); openPasswordModal(parseInt(btn.dataset.id)); return; }
        if (btn.classList.contains('vu-toggle')) { e.preventDefault(); toggleUserStatus(parseInt(btn.dataset.id)); return; }
        if (btn.classList.contains('vu-delete')) { e.preventDefault(); deleteUser(parseInt(btn.dataset.id)); return; }
        if (btn.classList.contains('vu-role-clone')) { e.preventDefault(); cloneRole(parseInt(btn.dataset.roleId)); return; }
        if (btn.classList.contains('vu-role-export')) { e.preventDefault(); exportRole(parseInt(btn.dataset.roleId)); return; }
        if (btn.classList.contains('vu-role-history')) { e.preventDefault(); openRoleHistory(parseInt(btn.dataset.roleId)); return; }
        if (btn.classList.contains('vu-role-compare')) { e.preventDefault(); openCompareModal(parseInt(btn.dataset.roleId)); return; }
    });

    mainEl.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal-overlay')) {
            const id = e.target.id;
            if (id === 'user-modal') closeUserModal();
            else if (id === 'perm-modal') closePermModal();
            else if (id === 'password-modal') closePasswordModal();
            else if (id === 'history-modal') _vuCloseModal('history-modal');
            else if (id === 'compare-modal') _vuCloseModal('compare-modal');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (document.getElementById('user-modal')?.classList.contains('active')) closeUserModal();
            else if (document.getElementById('perm-modal')?.classList.contains('active')) closePermModal();
            else if (document.getElementById('password-modal')?.classList.contains('active')) closePasswordModal();
            else if (document.getElementById('history-modal')?.classList.contains('active')) _vuCloseModal('history-modal');
            else if (document.getElementById('compare-modal')?.classList.contains('active')) _vuCloseModal('compare-modal');
        }
    });

    $('pwd-new')?.addEventListener('input', checkPwdMatch);
    $('pwd-confirm')?.addEventListener('input', checkPwdMatch);

    function $(id) { return document.getElementById(id); }
}

function checkPwdMatch() {
    const pwd = document.getElementById('pwd-new')?.value || '';
    const confirm = document.getElementById('pwd-confirm')?.value || '';
    const matchEl = document.getElementById('pwd-match');
    const saveBtn = document.getElementById('vu-save-pwd');
    if (!matchEl || !saveBtn) return;
    if (confirm.length === 0) { matchEl.style.display = 'none'; saveBtn.disabled = true; }
    else if (pwd !== confirm) { matchEl.style.display = 'block'; saveBtn.disabled = true; }
    else if (pwd.length < 6) { matchEl.style.display = 'none'; saveBtn.disabled = true; }
    else { matchEl.style.display = 'none'; saveBtn.disabled = false; }
}

async function renderUsersTable() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    await loadUsers();
    const S = {
        active: '\u0646\u0634\u0637',
        inactive: '\u0645\u0648\u0642\u0648\u0641',
        edit: '\u062a\u0639\u062f\u064a\u0644',
        permissions: '\u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a',
        changePwd: '\u062a\u063a\u064a\u064a\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631',
        disable: '\u062a\u0639\u0637\u064a\u0644',
        enable: '\u062a\u0641\u0639\u064a\u0644',
        del: '\u062d\u0630\u0641',
        user: '\u0645\u0633\u062a\u062e\u062f\u0645'
    };
    tbody.innerHTML = usersCache.map(u => {
        const isSuper = u.is_super_admin;
        const active = u.is_active;
        const roleBadges = u.role_names ? u.role_names.split(', ').map(r => `<span class="badge badge-info">${escapeHtml(r)}</span>`).join(' ') : `<span class="badge">${S.user}</span>`;
        const ce = hasPerm('users.edit');
        const cd = hasPerm('users.delete');
        const cm = hasPerm('users.assign_permissions');
        return `<tr>
          <td>${escapeHtml(u.username)} ${isSuper ? '<span class="badge badge-warning" title="\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645"><i class="fa-solid fa-shield-halved"></i></span>' : ''}</td>
          <td>${escapeHtml(u.full_name)}</td>
          <td>${roleBadges}</td>
          <td>${active ? '<span class="text-success">' + S.active + '</span>' : '<span class="text-danger">' + S.inactive + '</span>'}</td>
          <td class="actions-cell" style="white-space:nowrap">
            ${ce && !isSuper ? `<button class="icon-btn btn-edit vu-edit" data-id="${u.id}" title="${S.edit}"><i class="fa-solid fa-user-pen"></i></button>` : ''}
            ${cm && !isSuper ? `<button class="icon-btn vu-perms" data-id="${u.id}" title="${S.permissions}"><i class="fa-solid fa-shield"></i></button>` : ''}
            <button class="icon-btn vu-pwd" data-id="${u.id}" title="${S.changePwd}"><i class="fa-solid fa-key"></i></button>
            ${ce && !isSuper ? `<button class="icon-btn ${active ? 'btn-toggle-active' : 'btn-toggle-inactive'} vu-toggle" data-id="${u.id}" title="${active ? S.disable : S.enable}"><i class="fa-solid fa-power-off"></i></button>` : ''}
            ${cd && !isSuper ? `<button class="icon-btn btn-delete vu-delete" data-id="${u.id}" title="${S.del}"><i class="fa-solid fa-trash"></i></button>` : ''}
          </td>
        </tr>`;
    }).join('');
}

let editingUserId = null;

async function openUserModal(id) {
    editingUserId = id;
    const titleEl = document.getElementById('user-modal-title');
    const emailEl = document.getElementById('user-email');
    const nameEl = document.getElementById('user-name');
    const pwdEl = document.getElementById('user-password');
    const pwdGroup = document.getElementById('password-field-group');
    const saveBtn = document.getElementById('vu-save-user');

    const isEdit = !!id;
    titleEl.textContent = isEdit ? '\u062a\u0639\u062f\u064a\u0644 \u0645\u0633\u062a\u062e\u062f\u0645' : '\u0625\u0636\u0627\u0641\u0629 \u0645\u0633\u062a\u062e\u062f\u0645';
    pwdEl.required = !isEdit;
    pwdGroup.style.display = isEdit ? 'none' : 'block';
    emailEl.disabled = isEdit;
    saveBtn.textContent = isEdit ? '\u062a\u062d\u062f\u064a\u062b' : '\u0625\u0636\u0627\u0641\u0629';

    emailEl.value = '';
    nameEl.value = '';
    pwdEl.value = '';

    await loadRoles();
    const container = document.getElementById('user-roles-checkboxes');
    container.innerHTML = rolesCache.map(r => `
      <label class="checkbox-inline" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:#f8f9fa;border-radius:6px;cursor:pointer">
        <input type="checkbox" class="role-checkbox" value="${r.id}" ${r.is_system && r.name === 'super_admin' ? 'disabled' : ''}>
        <span>${escapeHtml(r.display_name)}</span>
        ${r.is_system ? '<span class="badge badge-warning" style="font-size:10px">\u0646\u0638\u0627\u0645\u064a</span>' : ''}
      </label>
    `).join('');

    if (id) {
        const user = usersCache.find(u => u.id === id);
        if (user) {
            emailEl.value = user.username;
            nameEl.value = user.full_name;
            try {
                const res = await fetch('/api/rbac/users/' + id + '/permissions', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } });
                const json = await res.json();
                if (json.success && json.data.roles) {
                    json.data.roles.forEach(r => {
                        const cb = container.querySelector(`.role-checkbox[value="${r.id}"]`);
                        if (cb) cb.checked = true;
                    });
                }
            } catch (e) { console.error('openUserModal fetch error', e); }
        }
    }

    _vuOpenModal('user-modal');
}

function closeUserModal() {
    _vuCloseModal('user-modal');
    editingUserId = null;
}

async function saveUser() {
    const email = document.getElementById('user-email').value.trim();
    const name = document.getElementById('user-name').value.trim();
    const password = document.getElementById('user-password').value;
    const roleCheckboxes = document.querySelectorAll('.role-checkbox:checked:not([disabled])');
    const role_ids = Array.from(roleCheckboxes).map(cb => parseInt(cb.value));

    if (!email || !name || (!editingUserId && !password)) {
        if (typeof showToast === 'function') showToast('\u064a\u0631\u062c\u0649 \u0645\u0644\u0621 \u062c\u0645\u064a\u0639 \u0627\u0644\u062d\u0642\u0648\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629', 'error');
        return;
    }

    try {
        let url = '/api/users';
        let method = 'POST';
        let body = { email, name, role_ids };

        if (editingUserId) {
            url = '/api/users/' + editingUserId;
            method = 'PUT';
            body = { name, email, role_ids };
        } else {
            body.password = password;
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') },
            body: JSON.stringify(body)
        });
        const json = await res.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast(json.message, 'success');
            closeUserModal();
            renderUsersTable();
        } else {
            if (typeof showToast === 'function') showToast(json.message, 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u062d\u0641\u0638 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645', 'error');
    }
}

let permUserId = null;
let _permGroupedCache = null;
let _permUserIdsCache = [];

async function openPermModal(userId) {
    try {
        permUserId = userId;
        const titleEl = document.getElementById('perm-modal-title');
        const body = document.getElementById('perm-modal-body');
        if (!titleEl || !body) return;

        const user = usersCache.find(u => u.id === userId);
        titleEl.textContent = '\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645: ' + escapeHtml(user ? user.full_name : '');
        body.innerHTML = '<div class="loading">\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644...</div>';
        _vuOpenModal('perm-modal');

        const [grouped, userPerms] = await Promise.all([
            loadPermissions(),
            fetch('/api/rbac/users/' + userId + '/permissions', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }).then(r => r.json())
        ]);

        const userPermIds = userPerms.success && userPerms.data ? (userPerms.data.permission_ids || []) : [];
        _permGroupedCache = grouped;
        _permUserIdsCache = userPermIds;

        if (userPerms.success && userPerms.data && userPerms.data.is_super_admin) {
            body.innerHTML = `<div style="text-align:center;padding:40px">
              <i class="fa-solid fa-shield-halved" style="font-size:48px;color:#d69e2e;margin-bottom:16px"></i>
              <h3>\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645</h3>
              <p style="color:#888">\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0644\u062f\u064a\u0647 \u0635\u0644\u0627\u062d\u064a\u0629 \u0643\u0627\u0645\u0644\u0629 \u0639\u0644\u0649 \u062c\u0645\u064a\u0639 \u0623\u062c\u0632\u0627\u0621 \u0627\u0644\u0646\u0638\u0627\u0645</p>
            </div>`;
            document.getElementById('vu-save-perm').style.display = 'none';
            document.getElementById('perm-search-input').style.display = 'none';
            document.getElementById('vu-perm-count-badge').style.display = 'none';
            document.getElementById('vu-select-all').style.display = 'none';
            document.getElementById('vu-deselect-all').style.display = 'none';
            return;
        }
        document.getElementById('vu-save-perm').style.display = 'inline-flex';
        document.getElementById('perm-search-input').style.display = '';
        document.getElementById('vu-perm-count-badge').style.display = '';
        document.getElementById('vu-select-all').style.display = '';
        document.getElementById('vu-deselect-all').style.display = '';

        renderPermGrid();
    } catch (e) {
        console.error('openPermModal error', e);
        const body = document.getElementById('perm-modal-body');
        if (body) body.innerHTML = '<div style="text-align:center;padding:40px;color:#e53e3e"><i class="fa-solid fa-circle-exclamation" style="font-size:48px;margin-bottom:16px"></i><h3>\u062e\u0637\u0623 \u0641\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a</h3><p>' + e.message + '</p></div>';
    }
}

function updateModuleCollapse(module) {
    var stored = _vuCollapsedModules || {};
    return stored[module] !== true;
}

function toggleModuleCollapse(module) {
    if (!_vuCollapsedModules) _vuCollapsedModules = {};
    _vuCollapsedModules[module] = !(_vuCollapsedModules[module] !== true);
    var items = document.querySelector('#perm-modal-body .perm-items[data-module="' + module + '"]');
    var icon = document.querySelector('#perm-modal-body .perm-module-toggle[data-module="' + module + '"]');
    if (items) items.style.display = _vuCollapsedModules[module] ? 'none' : 'flex';
    if (icon) icon.className = _vuCollapsedModules[module] ? 'fa-solid fa-chevron-left perm-module-toggle' : 'fa-solid fa-chevron-down perm-module-toggle';
}

function renderPermGrid() {
    var body = document.getElementById('perm-modal-body');
    if (!body) return;
    var grouped = _permGroupedCache;
    var userPermIds = _permUserIdsCache;
    var search = (_permSearchTerm || '').toLowerCase().trim();

    _vuCollapsedModules = _vuCollapsedModules || {};

    var totalCount = 0;
    var checkedCount = 0;
    var html = '<div class="perm-grid">';
    for (var module in grouped) {
        var perms = grouped[module];
        var filtered = search ? perms.filter(function(p) {
            return p.code.toLowerCase().indexOf(search) >= 0 ||
                   p.display_name.toLowerCase().indexOf(search) >= 0;
        }) : perms;
        if (filtered.length === 0 && search) continue;

        var moduleChecked = filtered.every(function(p) { return userPermIds.indexOf(p.id) >= 0; });
        var moduleAny = filtered.some(function(p) { return userPermIds.indexOf(p.id) >= 0; });
        var moduleCount = filtered.length;
        var moduleCheckedCount = filtered.filter(function(p) { return userPermIds.indexOf(p.id) >= 0; }).length;
        var isCollapsed = !_vuCollapsedModules[module];
        html += '<div class="perm-module">' +
            '<div class="perm-module-header" data-module="' + module + '" onclick="toggleModuleCollapse(\'' + module + '\')" style="cursor:pointer">' +
            '<span><i class="fa-solid fa-chevron-down perm-module-toggle" data-module="' + module + '" style="font-size:0.65rem;margin-left:6px;color:#94a3b8"></i><strong>' + getModuleDisplayName(module) + '</strong> <span style="font-size:0.7rem;color:#94a3b8;font-weight:400">(' + moduleCheckedCount + '/' + moduleCount + ')</span></span>' +
            '<label class="checkbox-inline" style="margin-right:auto;cursor:pointer" onclick="event.stopPropagation()">' +
            '<input type="checkbox" class="select-all-module" data-module="' + module + '" ' + (moduleChecked && filtered.length > 0 ? 'checked' : '') + '>' +
            '<small>(\u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0643\u0644)</small>' +
            '</label></div><div class="perm-items" data-module="' + module + '" style="display:' + (isCollapsed ? 'flex' : 'none') + '">';

        for (var pi in filtered) {
            var p = filtered[pi];
            var checked = userPermIds.indexOf(p.id) >= 0;
            if (checked) checkedCount++;
            totalCount++;
            html += '<label class="perm-item ' + (checked ? 'checked' : '') + '" title="' + (p.description || p.code) + '">' +
                '<input type="checkbox" class="perm-checkbox" data-module="' + module + '" value="' + p.id + '" ' + (checked ? 'checked' : '') + '>' +
                '<span>' + getActionLabel(p.code) + '</span></label>';
        }
        html += '</div></div>';
    }
    html += '</div>';
    body.innerHTML = html;

    updatePermCount();
    _vuAttachPermEvents(body);
}

function _vuAttachPermEvents(body) {
    body.querySelectorAll('.select-all-module').forEach(function(cb) {
        cb.addEventListener('change', function() {
            var m = this.dataset.module;
            body.querySelectorAll('.perm-checkbox[data-module="' + m + '"]').forEach(function(pc) {
                pc.checked = this.checked;
                pc.closest('.perm-item').classList.toggle('checked', this.checked);
                if (this.checked && _permUserIdsCache.indexOf(parseInt(pc.value)) < 0) _permUserIdsCache.push(parseInt(pc.value));
                else if (!this.checked) _permUserIdsCache = _permUserIdsCache.filter(function(id) { return id !== parseInt(pc.value); });
            }.bind(this));
            updatePermCount();
        });
    });

    body.querySelectorAll('.perm-checkbox').forEach(function(cb) {
        cb.addEventListener('change', function() {
            this.closest('.perm-item').classList.toggle('checked', this.checked);
            var val = parseInt(this.value);
            if (this.checked && _permUserIdsCache.indexOf(val) < 0) _permUserIdsCache.push(val);
            else if (!this.checked) _permUserIdsCache = _permUserIdsCache.filter(function(id) { return id !== val; });
            var m = this.dataset.module;
            var all = body.querySelectorAll('.perm-checkbox[data-module="' + m + '"]');
            var selectAll = body.querySelector('.select-all-module[data-module="' + m + '"]');
            if (selectAll) selectAll.checked = Array.from(all).every(function(c) { return c.checked; });
            updatePermCount();
        });
    });
}

function selectAllPerms() {
    var body = document.getElementById('perm-modal-body');
    if (!body) return;
    var allPerms = _permGroupedCache;
    var ids = [];
    for (var mod in allPerms) {
        allPerms[mod].forEach(function(p) { if (!p.disabled) ids.push(p.id); });
    }
    _permUserIdsCache = ids;
    body.querySelectorAll('.perm-checkbox').forEach(function(cb) { cb.checked = true; cb.closest('.perm-item').classList.add('checked'); });
    body.querySelectorAll('.select-all-module').forEach(function(cb) { cb.checked = true; });
    updatePermCount();
}

function deselectAllPerms() {
    var body = document.getElementById('perm-modal-body');
    if (!body) return;
    _permUserIdsCache = [];
    body.querySelectorAll('.perm-checkbox').forEach(function(cb) { cb.checked = false; cb.closest('.perm-item').classList.remove('checked'); });
    body.querySelectorAll('.select-all-module').forEach(function(cb) { cb.checked = false; });
    updatePermCount();
}

function updatePermCount() {
    var body = document.getElementById('perm-modal-body');
    if (!body) return;
    var checked = body.querySelectorAll('.perm-checkbox:checked').length;
    var total = body.querySelectorAll('.perm-checkbox').length;
    var badge = document.getElementById('vu-perm-count-badge');
    if (badge) badge.textContent = checked + ' / ' + total;
}

function closePermModal() {
    _vuCloseModal('perm-modal');
    permUserId = null;
    _permGroupedCache = null;
    _permUserIdsCache = [];
    _permSearchTerm = '';
    _vuCollapsedModules = {};
    var inp = document.getElementById('perm-search-input');
    if (inp) inp.value = '';
}

async function savePerms() {
    if (!permUserId) return;

    var currentUser = JSON.parse(localStorage.getItem('auth_user') || '{}');
    var isOwnPerms = currentUser.id === permUserId;
    var checkboxes = document.querySelectorAll('.perm-checkbox:checked');
    var permission_ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (typeof window.showConfirm === 'function') {
        var ok = await window.showConfirm('\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0641\u0638 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a\u061f', {
            title: '\u062d\u0641\u0638 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a',
            confirmText: '\u062d\u0641\u0638',
            type: 'warning'
        });
        if (!ok) return;
    }

    try {
        const userPerms = await fetch('/api/rbac/users/' + permUserId + '/permissions', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }).then(r => r.json());
        if (!userPerms.success) { if (typeof showToast === 'function') showToast('\u062e\u0637\u0623', 'error'); return; }

        const userRoles = userPerms.data.roles || [];
        if (userRoles.length === 0) {
            if (typeof showToast === 'function') showToast('\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0644\u064a\u0633 \u0644\u062f\u064a\u0647 \u0623\u062f\u0648\u0627\u0631. \u064a\u0631\u062c\u0649 \u062a\u0639\u064a\u064a\u0646 \u062f\u0648\u0631 \u0623\u0648\u0644\u0627\u064b.', 'warning');
            return;
        }

        for (const role of userRoles) {
            const res = await fetch('/api/rbac/roles/' + role.id + '/permissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') },
                body: JSON.stringify({ permission_ids })
            });
            const json = await res.json();
            if (!json.success) {
                if (typeof showToast === 'function') showToast(json.message, 'error');
                return;
            }
        }

        closePermModal();
        if (typeof showToast === 'function') showToast('\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0628\u0646\u062c\u0627\u062d', 'success');

        // Only logout current user if editing their own permissions (to refresh JWT)
        if (isOwnPerms) {
            if (typeof window.showAlert === 'function') {
                await window.showAlert('\u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0635\u0644\u0627\u062d\u064a\u0627\u062a\u0643 \u0648\u0633\u064a \u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u062e\u0631\u0648\u062c\u0643 \u0644\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a', {
                    title: '\u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a',
                    type: 'danger',
                    confirmText: '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c'
                });
            }
            window.logout();
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u062d\u0641\u0638 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a', 'error');
    }
}

async function cloneRole(roleId) {
    if (typeof window.showConfirm === 'function') {
        var ok = await window.showConfirm('\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u0646\u0633\u062e \u0647\u0630\u0627 \u0627\u0644\u062f\u0648\u0631\u061f', {
            title: '\u0646\u0633\u062e \u0627\u0644\u062f\u0648\u0631',
            confirmText: '\u0646\u0633\u062e',
            type: 'info'
        });
        if (!ok) return;
    }
    try {
        const res = await fetch('/api/rbac/roles/' + roleId + '/clone', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const json = await res.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast(json.message, 'success');
            await loadRoles();
            renderRolesList();
        } else {
            if (typeof showToast === 'function') showToast(json.message, 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u0646\u0633\u062e \u0627\u0644\u062f\u0648\u0631', 'error');
    }
}

async function exportRole(roleId) {
    try {
        const res = await fetch('/api/rbac/roles/' + roleId + '/export', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const json = await res.json();
        if (!json.success) {
            if (typeof showToast === 'function') showToast(json.message, 'error');
            return;
        }
        var blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'role_' + json.data.role.name + '_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showToast === 'function') showToast('\u062a\u0645 \u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u062f\u0648\u0631 \u0628\u0646\u062c\u0627\u062d', 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u062f\u0648\u0631', 'error');
    }
}

async function importRole() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async function(e) {
        var file = e.target.files[0];
        if (!file) return;
        try {
            var text = await file.text();
            var data = JSON.parse(text);
            if (!data.role || !data.permissions) {
                if (typeof showToast === 'function') showToast('\u0645\u0644\u0641 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d', 'error');
                return;
            }
            var res = await fetch('/api/rbac/roles/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') },
                body: JSON.stringify({ role: data.role, permissions: data.permissions })
            });
            var json = await res.json();
            if (json.success) {
                if (typeof showToast === 'function') showToast(json.message, 'success');
                await loadRoles();
                renderRolesList();
            } else {
                if (typeof showToast === 'function') showToast(json.message, 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('\u062e\u0637\u0623 \u0641\u064a \u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0645\u0644\u0641', 'error');
        }
    };
    input.click();
}

async function openRoleHistory(roleId) {
    var titleEl = document.getElementById('history-modal-title');
    var body = document.getElementById('history-modal-body');
    if (!titleEl || !body) return;
    var role = rolesCache.find(function(r) { return r.id === roleId; });
    titleEl.textContent = '\u0633\u062c\u0644 \u062a\u0639\u062f\u064a\u0644\u0627\u062a: ' + (role ? role.display_name : '');
    body.innerHTML = '<div class="loading">\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644...</div>';
    _vuOpenModal('history-modal');

    try {
        var res = await fetch('/api/rbac/roles/' + roleId + '/history?limit=50', {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        var json = await res.json();
        if (!json.success || !json.data || json.data.length === 0) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:#888"><i class="fa-solid fa-clock-rotate-left" style="font-size:40px;margin-bottom:12px;opacity:0.4"></i><p>\u0644\u0627 \u062a\u0648\u062c\u062f \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0645\u0633\u062c\u0644\u0629</p></div>';
            return;
        }
        var html = '<table class="data-table"><thead><tr><th>\u0627\u0644\u062a\u0627\u0631\u064a\u062e</th><th>\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645</th><th>\u0627\u0644\u0625\u062c\u0631\u0627\u0621</th><th>\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644</th></tr></thead><tbody>';
        json.data.forEach(function(log) {
            var details = '';
            try {
                var d = JSON.parse(log.details || '{}');
                if (d.added && d.added.length) details += '<div style="color:#22c55e">+ ' + d.added.join(', ') + '</div>';
                if (d.removed && d.removed.length) details += '<div style="color:#ef4444">- ' + d.removed.join(', ') + '</div>';
            } catch(e) { details = escapeHtml(log.details || ''); }
            html += '<tr><td style="font-size:0.8rem;white-space:nowrap">' + new Date(log.created_at).toLocaleDateString('ar-EG') + '</td>' +
                '<td>' + escapeHtml(log.actor_name || '') + '</td>' +
                '<td>' + escapeHtml(log.action || '') + '</td>' +
                '<td style="font-size:0.75rem">' + details + '</td></tr>';
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#e53e3e">\u062e\u0637\u0623 \u0641\u064a \u062a\u062d\u0645\u064a\u0644 \u0633\u062c\u0644 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a</div>';
    }
}

var _compareRoleIds = [];

async function openCompareModal(preSelectedId) {
    var body = document.getElementById('compare-modal-body');
    if (!body) return;
    
    if (preSelectedId && _compareRoleIds.length === 0) {
        _compareRoleIds = [preSelectedId];
    } else if (preSelectedId && _compareRoleIds.length === 1) {
        if (_compareRoleIds[0] === preSelectedId) {
            if (typeof showToast === 'function') showToast('\u0627\u062e\u062a\u0631 \u062f\u0648\u0631\u064a\u0646 \u0645\u062e\u062a\u0644\u0641\u064a\u0646', 'warning');
            return;
        }
        _compareRoleIds.push(preSelectedId);
    }

    var html = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">';
    html += '<div style="flex:1"><label style="font-size:0.8rem;color:#64748b">\u0627\u0644\u062f\u0648\u0631 \u0627\u0644\u0623\u0648\u0644</label><select id="vu-compare-a" class="form-control" style="width:100%">' +
        rolesCache.filter(function(r) { return r.name !== 'super_admin'; }).map(function(r) {
            return '<option value="' + r.id + '" ' + (_compareRoleIds[0] === r.id ? 'selected' : '') + '>' + escapeHtml(r.display_name) + ' (' + r.permission_count + ')</option>';
        }).join('') + '</select></div>';
    html += '<div style="color:#94a3b8;font-size:1.2rem;padding-top:18px"><i class="fa-solid fa-xmark"></i></div>';
    html += '<div style="flex:1"><label style="font-size:0.8rem;color:#64748b">\u0627\u0644\u062f\u0648\u0631 \u0627\u0644\u062b\u0627\u0646\u064a</label><select id="vu-compare-b" class="form-control" style="width:100%">' +
        rolesCache.filter(function(r) { return r.name !== 'super_admin'; }).map(function(r) {
            return '<option value="' + r.id + '" ' + (_compareRoleIds[1] === r.id ? 'selected' : '') + '>' + escapeHtml(r.display_name) + ' (' + r.permission_count + ')</option>';
        }).join('') + '</select></div>';
    html += '<div style="padding-top:18px"><button class="btn btn-primary btn-sm" id="vu-do-compare"><i class="fa-solid fa-not-equal"></i> \u0642\u0627\u0631\u0646</button></div>';
    html += '</div>';
    html += '<div id="vu-compare-results" style="max-height:50vh;overflow-y:auto"></div>';
    body.innerHTML = html;
    _vuOpenModal('compare-modal');

    if (_compareRoleIds.length === 2) {
        doCompare();
    }

    body.querySelector('#vu-do-compare')?.addEventListener('click', function() {
        var a = parseInt(document.getElementById('vu-compare-a').value);
        var b = parseInt(document.getElementById('vu-compare-b').value);
        if (a === b) {
            if (typeof showToast === 'function') showToast('\u0627\u062e\u062a\u0631 \u062f\u0648\u0631\u064a\u0646 \u0645\u062e\u062a\u0644\u0641\u064a\u0646', 'warning');
            return;
        }
        _compareRoleIds = [a, b];
        doCompare();
    });
}

async function doCompare() {
    var resultsEl = document.getElementById('vu-compare-results');
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div class="loading">\u062c\u0627\u0631\u064a \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0629...</div>';

    try {
        var [resA, resB] = await Promise.all([
            fetch('/api/rbac/roles/' + _compareRoleIds[0] + '/permissions', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }).then(function(r) { return r.json(); }),
            fetch('/api/rbac/roles/' + _compareRoleIds[1] + '/permissions', { headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') } }).then(function(r) { return r.json(); })
        ]);

        var roleA = rolesCache.find(function(r) { return r.id === _compareRoleIds[0]; });
        var roleB = rolesCache.find(function(r) { return r.id === _compareRoleIds[1]; });
        var idsA = resA.data || [];
        var idsB = resB.data || [];
        var setB = {};
        idsB.forEach(function(id) { setB[id] = true; });

        var onlyInA = idsA.filter(function(id) { return !setB[id]; });
        var onlyInB = idsB.filter(function(id) { return idsA.indexOf(id) < 0; });
        var inBoth = idsA.filter(function(id) { return setB[id]; });

        var allPerms = await loadPermissions();
        var flatPerms = [];
        for (var mod in allPerms) { allPerms[mod].forEach(function(p) { flatPerms[p.id] = p; }); }

        var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">';
        html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">' +
            '<h4 style="font-size:0.85rem;color:#166534;margin-bottom:8px"><i class="fa-solid fa-check-circle" style="color:#22c55e"></i> ' + escapeHtml(roleA ? roleA.display_name : '') + '</h4>' +
            '<div style="font-size:0.75rem;color:#64748b;margin-bottom:8px"><strong>' + onlyInA.length + '</strong> \u0635\u0644\u0627\u062d\u064a\u0629 \u0641\u0631\u064a\u062f\u0629</div>' +
            onlyInA.map(function(id) { var p = flatPerms[id]; return '<div style="padding:3px 6px;background:#dcfce7;border-radius:4px;margin:2px 0;font-size:0.7rem;color:#166534">' + (p ? getActionLabel(p.code) : 'ID:' + id) + '</div>'; }).join('') +
            '</div>';

        html += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">' +
            '<h4 style="font-size:0.85rem;color:#475569;margin-bottom:8px"><i class="fa-solid fa-check-double" style="color:#64748b"></i> \u0645\u0634\u062a\u0631\u0643</h4>' +
            '<div style="font-size:0.75rem;color:#64748b;margin-bottom:8px"><strong>' + inBoth.length + '</strong> \u0635\u0644\u0627\u062d\u064a\u0629 \u0645\u0634\u062a\u0631\u0643\u0629</div>' +
            inBoth.map(function(id) { var p = flatPerms[id]; return '<div style="padding:3px 6px;background:#f1f5f9;border-radius:4px;margin:2px 0;font-size:0.7rem;color:#475569">' + (p ? getActionLabel(p.code) : 'ID:' + id) + '</div>'; }).join('') +
            '</div>';

        html += '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px">' +
            '<h4 style="font-size:0.85rem;color:#991b1b;margin-bottom:8px"><i class="fa-solid fa-circle-xmark" style="color:#ef4444"></i> ' + escapeHtml(roleB ? roleB.display_name : '') + '</h4>' +
            '<div style="font-size:0.75rem;color:#64748b;margin-bottom:8px"><strong>' + onlyInB.length + '</strong> \u0635\u0644\u0627\u062d\u064a\u0629 \u0641\u0631\u064a\u062f\u0629</div>' +
            onlyInB.map(function(id) { var p = flatPerms[id]; return '<div style="padding:3px 6px;background:#fee2e2;border-radius:4px;margin:2px 0;font-size:0.7rem;color:#991b1b">' + (p ? getActionLabel(p.code) : 'ID:' + id) + '</div>'; }).join('') +
            '</div>';
        html += '</div>';

        resultsEl.innerHTML = html;
    } catch (e) {
        resultsEl.innerHTML = '<div style="text-align:center;padding:20px;color:#e53e3e">\u062e\u0637\u0623 \u0641\u064a \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0629</div>';
    }
}

let pwdUserId = null;

function openPasswordModal(userId) {
    pwdUserId = userId;
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || '{}');
    const isSelf = currentUser.id === userId;

    const currentPwdGroup = document.getElementById('pwd-current-group');
    if (currentPwdGroup) currentPwdGroup.style.display = isSelf ? 'block' : 'none';
    document.getElementById('pwd-current').value = '';
    document.getElementById('pwd-new').value = '';
    document.getElementById('pwd-confirm').value = '';
    document.getElementById('pwd-match').style.display = 'none';
    document.getElementById('vu-save-pwd').disabled = true;
    _vuOpenModal('password-modal');
}

function closePasswordModal() {
    _vuCloseModal('password-modal');
    pwdUserId = null;
}

async function savePassword() {
    const currentUser = JSON.parse(localStorage.getItem('auth_user') || '{}');
    const isSelf = currentUser.id === pwdUserId;
    const currentPwd = document.getElementById('pwd-current')?.value || '';
    const pwd = document.getElementById('pwd-new').value;
    const confirm = document.getElementById('pwd-confirm').value;

    if (isSelf && !currentPwd) {
        if (typeof showToast === 'function') showToast('\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0627\u0644\u062d\u0627\u0644\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629', 'error');
        return;
    }
    if (!pwd || pwd.length < 6) {
        if (typeof showToast === 'function') showToast('\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 6 \u0623\u062d\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644', 'error');
        return;
    }
    if (pwd !== confirm) {
        if (typeof showToast === 'function') showToast('\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0645\u062a\u0637\u0627\u0628\u0642\u0629', 'error');
        return;
    }

    try {
        const body = { password: pwd };
        if (isSelf) body.current_password = currentPwd;

        const res = await fetch('/api/users/' + pwdUserId + '/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') },
            body: JSON.stringify(body)
        });
        const json = await res.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast('\u062a\u0645 \u062a\u063a\u064a\u064a\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u0628\u0646\u062c\u0627\u062d', 'success');
            closePasswordModal();
        } else {
            if (typeof showToast === 'function') showToast(json.message, 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u062a\u063a\u064a\u064a\u0631 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631', 'error');
    }
}

async function toggleUserStatus(userId) {
    try {
        const res = await fetch('/api/users/' + userId + '/toggle-status', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const json = await res.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast(json.message, 'success');
        } else {
            if (typeof showToast === 'function') showToast(json.message, 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623', 'error');
    }
    renderUsersTable();
}

async function deleteUser(userId) {
    if (typeof window.showConfirm === 'function') {
        var confirmed = await window.showConfirm(
            '\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u061f',
            { title: '\u062d\u0630\u0641 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645', confirmText: '\u062d\u0630\u0641', type: 'danger' }
        );
        if (!confirmed) return;
    } else {
        if (!confirm('\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u061f')) return;
    }
    try {
        const res = await fetch('/api/users/' + userId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const json = await res.json();
        if (json.success) {
            if (typeof showToast === 'function') showToast(json.message, 'success');
        } else {
            if (typeof showToast === 'function') showToast(json.message, 'error');
        }
    } catch (e) {
        if (typeof showToast === 'function') showToast('\u062d\u062f\u062b \u062e\u0637\u0623 \u0641\u064a \u062d\u0630\u0641 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645', 'error');
    }
    renderUsersTable();
}

window.viewUsers = viewUsers;
