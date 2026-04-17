const state = {
  processes: [],
  currentLogsUid: null,
  logsSource: null,
  pendingImports: [],
};

// Initialize Theme (will be called at the end)

// Elements
const processListEl = document.getElementById('process-list');
const refreshBtn = document.getElementById('refresh-btn');
const logsModal = document.getElementById('logs-modal');
const modalTitle = document.getElementById('modal-title');
const logsContainer = document.getElementById('logs-container');
const refreshLogsBtn = document.getElementById('refresh-logs-btn');

// ─── Edit Process Modal ─────────────────────────────────────────────────────
window.openEditModal = async function (uid) {
  try {
    const config = await apiCall(`/api/processes/${uid}/export`);

    document.getElementById('edit-uid').value = config.uid || '';
    document.getElementById('edit-title').value = config.title || '';
    document.getElementById('edit-description').value = config.description || '';
    document.getElementById('edit-command').value = config.command || '';
    document.getElementById('edit-cwd').value = config.cwd || '';
    document.getElementById('edit-autostart').checked = !!config.autostart;
    document.getElementById('edit-autorestart').checked = config.autorestart !== false;

    // Args
    const argsList = document.getElementById('edit-args-list');
    argsList.innerHTML = '';
    if (config.args && config.args.length > 0) {
      config.args.forEach(arg => addEditArgumentField(arg));
    } else {
      addEditArgumentField();
    }

    // Env
    const envList = document.getElementById('edit-env-list');
    envList.innerHTML = '';
    if (config.env) {
      Object.entries(config.env).forEach(([k, v]) => addEditEnvVarField(k, v));
    }

    document.getElementById('edit-modal').classList.add('active');
  } catch (err) {
    showToast(`Failed to load config: ${err.message}`, 'error');
  }
};

window.closeEditModal = function () {
  document.getElementById('edit-modal').classList.remove('active');
  document.getElementById('edit-process-form').reset();
};

window.addEditArgumentField = function (value = '') {
  const container = document.getElementById('edit-args-list');
  const div = document.createElement('div');
  div.className = 'arg-entry';
  div.innerHTML = `
    <input type="text" class="arg-input" value="${value}" placeholder="Argument">
    <button type="button" class="remove-arg-btn" onclick="this.parentElement.remove()" title="Remove Argument">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  container.appendChild(div);
  if (!value) div.querySelector('input').focus();
};

window.addEditEnvVarField = function (key = '', value = '') {
  const container = document.getElementById('edit-env-list');
  const div = document.createElement('div');
  div.className = 'env-entry';
  div.innerHTML = `
    <input type="text" class="env-key" value="${key}" placeholder="Key (e.g. PORT)">
    <input type="text" class="env-value" value="${value}" placeholder="Value">
    <button type="button" class="remove-arg-btn" onclick="this.parentElement.remove()" title="Remove Variable">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  container.appendChild(div);
  if (!key) div.querySelector('.env-key').focus();
};

document.getElementById('edit-process-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);

  const argInputs = e.target.querySelectorAll('.arg-input');
  const args = Array.from(argInputs).map(i => i.value.trim()).filter(v => v !== '');

  const envKeys = e.target.querySelectorAll('.env-key');
  const envVals = e.target.querySelectorAll('.env-value');
  const env = {};
  envKeys.forEach((keyInput, idx) => {
    const k = keyInput.value.trim();
    if (k) env[k] = envVals[idx].value || '';
  });

  const data = {
    title: formData.get('title'),
    description: formData.get('description'),
    command: formData.get('command'),
    args: args,
    env: env,
    cwd: formData.get('cwd'),
    autostart: formData.get('autostart') === 'on',
    autorestart: formData.get('autorestart') === 'on',
  };

  // const submitBtn = e.target.querySelector('button[type="submit"]');
  // const origHtml = submitBtn.innerHTML;
  // submitBtn.disabled = true;
  // submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

  try {
    const res = await apiCall(`/api/processes/${formData.get('uid')}`, 'PUT', data);
    closeEditModal();
    fetchProcesses();
    showToast('Process updated successfully.', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    // submitBtn.disabled = false;
    // submitBtn.innerHTML = origHtml;
  }
});

// ─── Add Process Modal ──────────────────────────────────────────────────────
function openAddModal() {
  document.getElementById('add-modal').classList.add('active');
  // Reset arguments list and add one empty field
  const argsList = document.getElementById('args-list');
  argsList.innerHTML = '';
  addArgumentField();

  // Reset env list
  const envList = document.getElementById('env-list');
  envList.innerHTML = '';
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('active');
  document.getElementById('add-process-form').reset();
}

window.addArgumentField = function (value = '') {
  const container = document.getElementById('args-list');
  const div = document.createElement('div');
  div.className = 'arg-entry';
  div.innerHTML = `
    <input type="text" class="arg-input" value="${value}" placeholder="Argument">
    <button type="button" class="remove-arg-btn" onclick="this.parentElement.remove()" title="Remove Argument">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  container.appendChild(div);
  div.querySelector('input').focus();
};

window.addEnvVarField = function (key = '', value = '') {
  const container = document.getElementById('env-list');
  const div = document.createElement('div');
  div.className = 'env-entry';
  div.innerHTML = `
    <input type="text" class="env-key" value="${key}" placeholder="Key (e.g. PORT)">
    <input type="text" class="env-value" value="${value}" placeholder="Value">
    <button type="button" class="remove-arg-btn" onclick="this.parentElement.remove()" title="Remove Variable">
      <i class="fa-solid fa-trash"></i>
    </button>
  `;
  container.appendChild(div);
  div.querySelector('.env-key').focus();
};

document.getElementById('add-process-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  // Collect arguments from individual inputs
  const argInputs = e.target.querySelectorAll('.arg-input');
  const args = Array.from(argInputs)
    .map(input => input.value.trim())
    .filter(val => val !== '');

  // Collect env vars from individual inputs
  const envKeys = e.target.querySelectorAll('.env-key');
  const envVals = e.target.querySelectorAll('.env-value');
  const env = {};
  envKeys.forEach((keyInput, index) => {
    const key = keyInput.value.trim();
    const val = envVals[index].value || '';
    if (key) {
      env[key] = val;
    }
  });

  const data = {
    uid: formData.get('uid'),
    title: formData.get('title'),
    description: formData.get('description'),
    command: formData.get('command'),
    args: args,
    env: env, // Send as object
    cwd: formData.get('cwd'),
    autostart: formData.get('autostart') === 'on',
    autorestart: formData.get('autorestart') === 'on',
  };

  // const submitBtn = e.target.querySelector('button[type="submit"]');
  // submitBtn.disabled = true;
  // submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating...';

  try {
    const res = await fetch('/api/processes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create process');
    }

    closeAddModal();
    fetchProcesses(); // Refresh the list
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    // submitBtn.disabled = false;
    // submitBtn.textContent = 'Create Process';
  }
});

// Initialize
initTheme();
fetchProcesses();
startRealTimeUpdates();

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  startRealTimeUpdates();
});

async function apiCall(url, method = 'GET', body = null) {
  try {
    // Fallback to localhost:9000 if the user opens the HTML file directly
    let fetchUrl = url;
    if (window.location.protocol === 'file:' && url.startsWith('/')) {
      fetchUrl = 'http://localhost:9000' + url;
    }

    // Provide full URL support so it doesn't break
    const response = await fetch(fetchUrl, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'API Error');
    return data;
  } catch (error) {
    console.error('API Error:', error);
    // Don't show alert for background tasks
    if (error.name !== 'AbortError') {
      console.warn(`Error connecting to API. Did you navigate to http://localhost:9000 ?`);
    }
    throw error;
  }
}

// ─── Theme Management ─────────────────────────────────────────────────────
window.toggleTheme = function () {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeIcon(isLight);
};

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;

  const isLight = savedTheme === 'light' || (!savedTheme && prefersLight);

  if (isLight) {
    document.body.classList.add('light-mode');
  }

  updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
  const icon = document.querySelector('#theme-toggle i');
  if (icon) {
    icon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

async function fetchProcesses() {
  try {
    const data = await apiCall('/api/processes');
    state.processes = data.processes || [];
    renderProcesses();
  } catch (e) {
    console.error('Failed to fetch processes:', e);
  }
}

function startRealTimeUpdates() {
  if (state.evtSource) {
    state.evtSource.close();
  }

  refreshBtn.disabled = true;
  refreshBtn.style.cursor = 'default';
  refreshBtn.innerHTML = '<span class="pulse-dot" style="display:inline-block; margin-right:8px; vertical-align:middle; position:relative; top:-1px"></span> Live';

  let sseUrl = '/api/processes/events';
  if (window.location.protocol === 'file:') {
    sseUrl = 'http://localhost:9000/api/processes/events';
  }

  const evtSource = new EventSource(sseUrl);
  state.evtSource = evtSource;

  evtSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    state.processes = data.processes || [];
    renderProcesses();
  };

  evtSource.onopen = () => {
    console.log("SSE connection opened");
  };

  evtSource.onerror = (err) => {
    console.error("EventSource failed:", err);
    processListEl.innerHTML = `<div class="loading-state" style="color: var(--danger)">
      <i class="fa-solid fa-triangle-exclamation"></i> Realtime connection lost. Reconnecting...
    </div>`;

    // Provide a way to manually reconnect if error persists
    refreshBtn.disabled = false;
    refreshBtn.style.cursor = 'pointer';
    refreshBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Reconnect';
  };
}

function getBadgeHtml(stateStr) {
  let cls = 'stopped';
  if (stateStr === 'running') cls = 'running';
  if (stateStr === 'disabled') cls = 'disabled';
  if (stateStr === 'finished') cls = 'finished';
  if (stateStr === 'error' || stateStr === 'crashed') cls = 'error';
  return `<span class="badge ${cls}">${stateStr}</span>`;
}

function processAction(uid, action) {
  return async () => {
    try {
      await apiCall(`/api/processes/${uid}/${action}`, 'POST');
    } catch (e) {
      // Error handled in apiCall
    }
  };
}

function formatUptime(dateString) {
  if (!dateString) return '-';
  const start = new Date(dateString);
  const now = new Date();
  const diffSecs = Math.floor((now - start) / 1000);

  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ${diffSecs % 60}s`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`;
  return `${Math.floor(diffSecs / 86400)}d ${Math.floor((diffSecs % 86400) / 3600)}h`;
}

function renderProcesses() {
  if (state.processes.length === 0) {
    processListEl.innerHTML = `<div class="loading-state">No processes found. Check config.</div>`;
    return;
  }

  let tableHtml = `
    <table class="process-table glass-panel">
      <thead>
        <tr>
          <th>UID</th>
          <th>Title</th>
          <th>Status</th>
          <th>PID</th>
          <th>Uptime</th>
          <th>Restarts</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  state.processes.forEach(proc => {
    const isRunning = proc.state === 'running';
    const isDisabled = proc.state === 'disabled';
    const uptime = (isRunning && proc.startedAt) ? formatUptime(proc.startedAt) : '-';

    tableHtml += `
        <tr>
          <td class="col-uid"><span class="uid-text">${proc.uid}</span></td>
          <td class="col-title">${proc.title || proc.uid}</td>
          <td class="col-status">${getBadgeHtml(proc.state)}</td>
          <td class="col-pid">${proc.pid || '-'}</td>
          <td class="col-uptime">${uptime}</td>
          <td class="col-restarts">${proc.restartCount || 0}</td>
          <td class="col-actions">
            <div class="table-actions">
              <button class="btn secondary-btn icon-btn" onclick="openEditModal('${proc.uid}')" title="Edit">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn success-btn icon-btn" onclick="triggerAction('${proc.uid}', 'start')" title="Start" ${isRunning || isDisabled ? 'disabled' : ''}>
                <i class="fa-solid fa-play"></i>
              </button>
              <button class="btn warning-btn icon-btn" onclick="triggerAction('${proc.uid}', 'restart')" title="Restart" ${!isRunning || isDisabled ? 'disabled' : ''}>
                <i class="fa-solid fa-rotate-right"></i>
              </button>
              <button class="btn danger-btn icon-btn" onclick="triggerAction('${proc.uid}', 'stop')" title="Stop" ${!isRunning ? 'disabled' : ''}>
                <i class="fa-solid fa-stop"></i>
              </button>
              <button class="btn ${isDisabled ? 'primary-btn' : 'secondary-btn'} icon-btn" onclick="triggerAction('${proc.uid}', '${isDisabled ? 'enable' : 'disable'}')" title="${isDisabled ? 'Enable' : 'Disable'}">
                <i class="fa-solid ${isDisabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
              </button>
              <button class="btn secondary-btn icon-btn view-logs-btn" onclick="openLogs('${proc.uid}')" title="Logs">
                <i class="fa-solid fa-file-lines"></i> Logs
              </button>
              <button class="btn secondary-btn icon-btn" onclick="exportConfig('${proc.uid}')" title="Export Config">
                <i class="fa-solid fa-file-arrow-down"></i>
              </button>
              <button class="btn danger-btn icon-btn" onclick="triggerAction('${proc.uid}', 'remove')" title="Remove Process">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
    `;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  processListEl.innerHTML = tableHtml;
}

// Ensure action functions are in global scope for inline onclick handler
window.triggerAction = async function (uid, action) {
  if (action === 'remove') {
    const confirmed = await showConfirm(
      'Remove Process',
      `Are you sure you want to PERMANENTLY remove process "${uid}"?\nThis will stop the process and delete its configuration.`
    );
    if (!confirmed) return;
  }

  try {
    const btn = event.currentTarget;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    btn.disabled = true;

    if (action === 'remove') {
      await apiCall(`/api/processes/${uid}`, 'DELETE');
      fetchProcesses(); // Refresh the list entirely on removal
    } else {
      await apiCall(`/api/processes/${uid}/${action}`, 'POST');
    }
    // UI will naturally update within 1s via SSE for non-removal actions
  } catch (e) {
    // Re-rendering to revert loader on error will happen automatically via SSE
    showToast(`Failed to perform action ${action}: ${e.message}`, 'error');
  }
};

window.triggerAllAction = async function (action) {
  const confirmed = await showConfirm(
    'Bulk Action',
    `Are you sure you want to ${action} ALL processes?`
  );
  if (!confirmed) return;

  try {
    const btn = event.currentTarget;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${action}ing...`;
    btn.disabled = true;

    await apiCall(`/api/processes/all/${action}`, 'POST');

    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }, 1000);
  } catch (e) {
    showToast(`Failed to ${action} all processes: ${e.message}`, 'error');
  }
};

// ─── Export / Import Logic ────────────────────────────────────────────────
window.exportConfig = async function (uid) {
  try {
    const config = await apiCall(`/api/processes/${uid}/export`);
    downloadJson(`${uid}.json`, config);
    showToast(`Configuration for ${uid} exported.`, 'success');
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  }
};

window.exportAllConfigs = async function () {
  try {
    const configs = await apiCall('/api/processes/all/export');
    downloadJson('supervisor-export.json', configs);
    showToast('All configurations exported.', 'success');
  } catch (err) {
    showToast(`Bulk export failed: ${err.message}`, 'error');
  }
};

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.triggerImport = function () {
  document.getElementById('import-input').click();
};

window.reloadConfigs = async function () {
  const confirmed = await showConfirm(
    'Reload Configs',
    'Are you sure you want to reload all configurations from disk?\nThis will sync with current files and restart processes if core settings changed.'
  );
  if (!confirmed) return;

  try {
    const btn = event.currentTarget;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reloading...';
    btn.disabled = true;

    const summary = await apiCall('/api/processes/all/reload', 'POST');

    let msg = 'Reload complete.';
    if (summary.added.length) msg += `\n- Added: ${summary.added.join(', ')}`;
    if (summary.updated.length) msg += `\n- Updated: ${summary.updated.join(', ')}`;
    if (summary.removed.length) msg += `\n- Removed: ${summary.removed.join(', ')}`;
    if (summary.error.length) msg += `\n- Errors: ${summary.error.length}`;

    showToast(msg, 'success');
    fetchProcesses();

    btn.innerHTML = origHtml;
    btn.disabled = false;
  } catch (err) {
    showToast(`Reload failed: ${err.message}`, 'error');
  }
};

window.handleImport = async function (event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const processes = Array.isArray(data) ? data : [data];

      state.pendingImports = processes;
      openImportModal();
      renderImportList();
    } catch (err) {
      showToast(`Import failed: Invalid JSON. ${err.message}`, 'error');
    } finally {
      event.target.value = ''; // Reset input
    }
  };
  reader.readAsText(file);
};

window.openImportModal = function () {
  document.getElementById('import-modal').classList.add('active');
  document.getElementById('import-select-all').checked = true;
};

window.closeImportModal = function () {
  document.getElementById('import-modal').classList.remove('active');
  state.pendingImports = [];
};

window.renderImportList = function () {
  const container = document.getElementById('import-list');
  const summary = document.getElementById('import-count-summary');
  container.innerHTML = '';

  const processes = state.pendingImports;
  summary.innerText = `${processes.length} process(es) found`;

  processes.forEach((proc, index) => {
    const item = document.createElement('div');
    item.className = 'import-item';
    item.innerHTML = `
      <input type="checkbox" id="import-check-${index}" checked onchange="updateImportSummary()">
      <label for="import-check-${index}">
        <div class="import-item-main">
          ${proc.uid} <span style="font-weight: normal; opacity: 0.7;">(${proc.title || 'No Title'})</span>
        </div>
        <div class="import-item-sub">
          <i class="fa-solid fa-terminal"></i> ${proc.command} ${proc.args ? proc.args.join(' ') : ''}
        </div>
      </label>
    `;
    container.appendChild(item);
  });
  updateImportSummary();
};

window.toggleImportSelectAll = function (checked) {
  const checks = document.querySelectorAll('#import-list input[type="checkbox"]');
  checks.forEach(c => c.checked = checked);
  updateImportSummary();
};

window.updateImportSummary = function () {
  const checks = document.querySelectorAll('#import-list input[type="checkbox"]:checked');
  const summary = document.getElementById('import-count-summary');
  summary.innerText = `${checks.length} of ${state.pendingImports.length} selected`;
  document.getElementById('import-select-all').checked = checks.length === state.pendingImports.length;
};

window.confirmImport = async function () {
  const container = document.getElementById('import-list');
  const rows = container.querySelectorAll('.import-item');
  const selectedConfigs = [];

  rows.forEach((row, index) => {
    const checked = row.querySelector('input').checked;
    if (checked) {
      selectedConfigs.push(state.pendingImports[index]);
    }
  });

  if (selectedConfigs.length === 0) {
    showToast('No processes selected for import.', 'info');
    return;
  }

  try {
    const res = await apiCall('/api/processes/import', 'POST', selectedConfigs);

    const successCount = res.succeded.length;
    const failCount = res.failed.length;

    let msg = `Import complete: ${successCount} succeded.`;
    if (failCount > 0) {
      msg += `\n${failCount} failed (likely duplicate UIDs).`;
    }

    showToast(msg, successCount > 0 ? 'success' : 'error');
    closeImportModal();
    fetchProcesses();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
};

window.toggleRealTime = function () {
  startRealTimeUpdates();
};

window.openLogs = function (uid) {
  state.currentLogsUid = uid;
  modalTitle.innerText = `Logs: ${uid}`;
  logsContainer.innerText = '';
  logsModal.classList.add('active');

  // Configure Download Button
  const downloadBtn = document.getElementById('download-logs-btn');
  downloadBtn.onclick = () => {
    let downloadUrl = `/api/processes/${uid}/logs/download`;
    if (window.location.protocol === 'file:') {
      downloadUrl = `http://localhost:9000${downloadUrl}`;
    }
    window.location.href = downloadUrl;
  };

  let sseUrl = `/api/processes/${uid}/logs/events`;
  if (window.location.protocol === 'file:') {
    sseUrl = `http://localhost:9000/api/processes/${uid}/logs/events`;
  }

  const logsSource = new EventSource(sseUrl);
  state.logsSource = logsSource;

  logsSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const lineEl = document.createElement('div');
      lineEl.style.marginBottom = '2px';
      lineEl.innerText = `${data.timestamp} - ${data.line}`;
      logsContainer.appendChild(lineEl);

      // Auto scroll to bottom
      const modalBody = logsContainer.parentElement;
      modalBody.scrollTop = modalBody.scrollHeight;
    } catch (e) {
      console.error('Failed to parse log entry:', e);
    }
  };

  logsSource.onerror = () => {
    console.error('Log stream connection lost');
    const errEl = document.createElement('div');
    errEl.style.color = 'var(--danger)';
    errEl.innerText = 'Connection to log stream lost. Reconnecting...';
    logsContainer.appendChild(errEl);
  };
};

window.closeLogs = function () {
  logsModal.classList.remove('active');
  state.currentLogsUid = null;
  if (state.logsSource) {
    state.logsSource.close();
    state.logsSource = null;
  }
};

// ─── Custom Confirmation ───────────────────────────────────────────────────
let confirmResolve = null;

window.showConfirm = function (title, message) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-message').innerText = message;
  document.getElementById('confirm-modal').classList.add('active');

  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
};

window.closeConfirm = function (result) {
  document.getElementById('confirm-modal').classList.remove('active');
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
};

document.getElementById('confirm-proceed-btn').addEventListener('click', () => closeConfirm(true));
document.getElementById('confirm-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('confirm-modal')) {
    closeConfirm(false);
  }
});

// ─── Toast Notifications ───────────────────────────────────────────────────
window.showToast = function (message, type = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'info-circle';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'exclamation-triangle';

  toast.innerHTML = `
    <div class="toast-icon"><i class="fa-solid fa-${icon}"></i></div>
    <div class="toast-content">${message.replace(/\n/g, '<br>')}</div>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
};

// Removed fetchLogs as we now use real-time SSE

// Close modal on click outside
logsModal.addEventListener('click', (e) => {
  if (e.target === logsModal) {
    closeLogs();
  }
});
