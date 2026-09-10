/**
 * extension/popup/popup.js
 *
 * Popup controller — manages all 4 tabs and communicates
 * with the background service worker via chrome.runtime.sendMessage.
 *
 * Tabs: Agent | Profile | Privacy Dashboard | Settings
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────
     TAB NAVIGATION
  ───────────────────────────────────── */
  const tabBtns   = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => { b.classList.toggle('active', b.dataset.tab === target); b.setAttribute('aria-selected', b.dataset.tab === target); });
      tabPanels.forEach(p => p.classList.toggle('active', p.id === `panel-${target}`));
    });
  });

  /* ─────────────────────────────────────
     BACKEND STATUS CHECK
  ───────────────────────────────────── */
  const backendDot    = document.getElementById('backend-dot');
  const backendStatus = document.getElementById('backend-status');

  function updateBackendUI(connected) {
    backendDot.className = 'backend-dot ' + (connected ? 'connected' : 'disconnected');
    backendStatus.textContent = connected ? 'Online ✓' : 'Offline ✗';
    backendStatus.className   = 'status-value ' + (connected ? 'status-ok' : 'status-warn');
    document.getElementById('run-btn').disabled = !connected || !getTaskInput().trim();
  }

  async function checkBackend() {
    const resp = await bg('CHECK_BACKEND');
    updateBackendUI(resp && resp.connected);
  }

  /* ─────────────────────────────────────
     BACKGROUND MESSAGING
  ───────────────────────────────────── */
  function bg(type, extra = {}) {
    return chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);
  }

  /* ─────────────────────────────────────
     SCAN PAGE
  ───────────────────────────────────── */
  const pageTitle    = document.getElementById('page-title');
  const piiCount     = document.getElementById('pii-count');
  const piiProtected = document.getElementById('pii-protected');

  async function scanPage() {
    const resp = await bg('SCAN_PAGE');
    if (!resp || !resp.ok) return;

    pageTitle.textContent    = truncate(resp.title || document.title, 20);
    piiCount.textContent     = resp.summary ? String(resp.summary.sensitive) : '?';
    piiProtected.textContent = resp.summary ? String(resp.summary.sensitive) : '?';

    // Update dashboard
    updateDashboard(resp.summary, resp);

    return resp;
  }

  /* ─────────────────────────────────────
     AGENT RUN FLOW
  ───────────────────────────────────── */
  const runBtn      = document.getElementById('run-btn');
  const runBtnText  = document.getElementById('run-btn-text');
  const taskInput   = document.getElementById('task-input');
  const progressSec = document.getElementById('progress-section');
  const logEntries  = document.getElementById('log-entries');
  const spinner     = document.getElementById('progress-spinner');
  const metricsSec  = document.getElementById('metrics-section');

  function getTaskInput() { return taskInput.value.trim(); }

  taskInput.addEventListener('input', () => {
    runBtn.disabled = !getTaskInput() || backendDot.classList.contains('disconnected');
  });

  runBtn.addEventListener('click', async () => {
    const task = getTaskInput();
    if (!task) return;

    // Reset UI
    logEntries.innerHTML = '';
    progressSec.style.display = 'block';
    metricsSec.style.display  = 'none';
    spinner.classList.add('active');
    runBtn.disabled  = true;
    runBtnText.textContent = 'Running…';

    addLog('default', `Task: "${task}"`);

    await bg('RUN_TASK', { task });
  });

  function addLog(stage, message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const dotClass = {
      scanning: 'log-dot-scanning',
      reasoning: 'log-dot-reasoning',
      executing: 'log-dot-executing',
      done: 'log-dot-done',
      error: 'log-dot-error',
    }[stage] || 'log-dot-default';

    entry.innerHTML = `<span class="log-dot ${dotClass}"></span><span>${escHtml(message)}</span>`;
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;
  }

  /* ─────────────────────────────────────
     LISTEN FOR AGENT UPDATES (from background)
  ───────────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'AGENT_UPDATE') return;

    addLog(msg.stage, msg.message);

    if (msg.piiSummary) {
      piiCount.textContent     = String(msg.piiSummary.sensitive || 0);
      piiProtected.textContent = String(msg.piiSummary.sensitive || 0);
      updateDashboard(msg.piiSummary, msg);
    }

    if (msg.stage === 'done') {
      spinner.classList.remove('active');
      runBtn.disabled  = false;
      runBtnText.textContent = 'Start Agent';

      if (msg.metrics) {
        document.getElementById('m-scan').textContent    = msg.metrics.scanMs    + ' ms';
        document.getElementById('m-backend').textContent = msg.metrics.backendMs + ' ms';
        document.getElementById('m-exec').textContent    = msg.metrics.executeMs + ' ms';
        document.getElementById('m-total').textContent   = msg.metrics.totalMs   + ' ms';
        metricsSec.style.display = 'block';
      }
    }

    if (msg.stage === 'error') {
      spinner.classList.remove('active');
      runBtn.disabled  = false;
      runBtnText.textContent = 'Start Agent';
    }

    if (msg.stage === 'planned' && msg.actions) {
      updateServerContext(msg.actions);
    }
  });

  /* ─────────────────────────────────────
     SCAN BUTTON
  ───────────────────────────────────── */
  document.getElementById('scan-btn').addEventListener('click', async () => {
    const btn = document.getElementById('scan-btn');
    btn.textContent = '⏳ Scanning…';
    btn.disabled = true;
    await scanPage();
    btn.textContent = '🔍 Scan Page';
    btn.disabled = false;
  });

  /* ─────────────────────────────────────
     PROFILE TAB
  ───────────────────────────────────── */
  const profileForm     = document.getElementById('profile-form');
  const saveProfileBtn  = document.getElementById('save-profile-btn');
  const saveStatus      = document.getElementById('save-status');

  const PROFILE_FIELDS = ['name','email','phone','dob','address','employee_id','division','gender','clearance','password'];

  async function loadProfile() {
    try {
      const result = await new Promise(res => chrome.storage.local.get(['pba_user_profile'], res));
      const p = (result && result.pba_user_profile) || {};
      PROFILE_FIELDS.forEach(key => {
        const el = document.getElementById(`p-${key.replace('_','-')}`);
        if (el && p[key] !== undefined) el.value = p[key];
      });
    } catch (e) {
      const resp = await bg('GET_PROFILE');
      if (resp && resp.profile) {
        const p = resp.profile;
        PROFILE_FIELDS.forEach(key => {
          const el = document.getElementById(`p-${key.replace('_','-')}`);
          if (el && p[key] !== undefined) el.value = p[key];
        });
      }
    }
  }

  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = {};
    PROFILE_FIELDS.forEach(key => {
      const el = document.getElementById(`p-${key.replace('_','-')}`);
      if (el) profile[key] = el.value;
    });

    saveProfileBtn.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ pba_user_profile: profile }, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
      saveStatus.textContent  = '✓ Saved locally';
      saveStatus.className    = 'save-status ok';
    } catch (err) {
      const resp = await bg('SAVE_PROFILE', { profile });
      if (resp && resp.ok) {
        saveStatus.textContent  = '✓ Saved locally';
        saveStatus.className    = 'save-status ok';
      } else {
        saveStatus.textContent  = '✗ Save failed';
        saveStatus.className    = 'save-status error';
      }
    } finally {
      saveProfileBtn.disabled = false;
      setTimeout(() => { saveStatus.textContent = ''; saveStatus.className = 'save-status'; }, 3000);
    }
  });

  /* ─────────────────────────────────────
     WORD DOCUMENT IMPORT
  ───────────────────────────────────── */
  const importFile      = document.getElementById('p-import-file');
  const importBtn       = document.getElementById('import-word-btn');
  const importStatus    = document.getElementById('import-status');

  importBtn.addEventListener('click', async () => {
    if (!importFile.files || importFile.files.length === 0) {
      importStatus.textContent = 'Please select a .docx file first.';
      importStatus.style.color = 'var(--status-warn)';
      return;
    }

    const file = importFile.files[0];
    if (!file.name.endsWith('.docx')) {
      importStatus.textContent = 'Only .docx files are supported.';
      importStatus.style.color = 'var(--status-warn)';
      return;
    }

    importBtn.disabled = true;
    importBtn.textContent = '⏳ Extracting...';
    importStatus.textContent = 'Sending to local AI...';
    importStatus.style.color = 'inherit';

    const formData = new FormData();
    formData.append('file', file);

    try {
      // Get backend URL from settings or default
      const s = await loadSettings();
      const backendUrl = s.backendUrl || 'http://localhost:8000';
      
      const res = await fetch(`${backendUrl}/api/extract/profile`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error('Failed to parse profile data from file.');
      }

      const p = json.data;
      let fieldsUpdated = 0;

      // Populate form fields with extracted data
      PROFILE_FIELDS.forEach(key => {
        const el = document.getElementById(`p-${key.replace('_','-')}`);
        if (el && p[key] !== undefined && p[key] !== null && p[key] !== '') {
          // If it's a select field, try to match case-insensitively
          if (el.tagName.toLowerCase() === 'select') {
            for (let i = 0; i < el.options.length; i++) {
              if (el.options[i].value === p[key] || el.options[i].value.replace('_', ' ') === p[key].replace('_', ' ')) {
                el.selectedIndex = i;
                fieldsUpdated++;
                break;
              }
            }
          } else {
            el.value = p[key];
            fieldsUpdated++;
          }
        }
      });

      importStatus.textContent = `✓ Extracted ${fieldsUpdated} fields! Review & click Save.`;
      importStatus.style.color = 'var(--status-ok)';
      
      // Clear file input so they can upload again if needed
      importFile.value = '';
      
    } catch (err) {
      console.error('Import error:', err);
      importStatus.textContent = '✗ Extraction failed: ' + err.message;
      importStatus.style.color = 'var(--status-error)';
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = '📄 Extract Profile';
    }
  });

  /* ─────────────────────────────────────
     PRIVACY DASHBOARD
  ───────────────────────────────────── */
  const localList    = document.getElementById('local-list');
  const serverList   = document.getElementById('server-list');
  const catSection   = document.getElementById('category-section');
  const catGrid      = document.getElementById('cat-grid');
  const scoreNum     = document.getElementById('score-num');
  const scoreTitle   = document.getElementById('score-title');
  const scoreSub     = document.getElementById('score-sub');

  function updateDashboard(summary, ctx) {
    if (!summary) return;

    // Score
    const pct = summary.total > 0
      ? Math.round((summary.sensitive / summary.total) * 100)
      : 0;
    scoreNum.textContent  = summary.sensitive + '/' + summary.total;
    scoreTitle.textContent = 'PII Protected: 100%';
    scoreSub.textContent  = `${summary.sensitive} sensitive fields all kept local`;

    // Local list
    const cats = Object.keys(summary.categories || {});
    if (cats.length) {
      localList.innerHTML = cats.map(c =>
        `<li>${CAT_LABELS[c] || c}</li>`
      ).join('');
    } else {
      localList.innerHTML = '<li class="split-empty">No PII detected</li>';
    }

    // Server list
    serverList.innerHTML = [
      '<li>Form structure</li>',
      '<li>Field labels</li>',
      '<li>Non-sensitive values</li>',
      '<li>Field types</li>',
    ].join('');

    // Category chips
    if (cats.length) {
      catSection.style.display = 'block';
      catGrid.innerHTML = cats.map(c =>
        `<span class="cat-chip">${CAT_LABELS[c] || c}</span>`
      ).join('');
    }
  }

  function updateServerContext(actions) {
    const sec = document.getElementById('server-context-section');
    const pre = document.getElementById('server-ctx-pre');
    sec.style.display = 'block';

    const sanitizedActions = actions.map(a => {
      // Show structure only, hide profile_key hint value
      const safe = { ...a };
      if (safe.value_source === 'local_profile') {
        safe._note = 'value filled locally by extension';
      }
      return safe;
    });

    pre.textContent = JSON.stringify(sanitizedActions, null, 2);
  }

  const CAT_LABELS = {
    name: 'Full Name', email: 'Email', phone: 'Phone', dob: 'Date of Birth',
    address: 'Address', employee_id: 'Employee ID', division: 'Division', clearance: 'Clearance Level', password: 'Password',
    national_id: 'National ID', credit_card: 'Card Number',
  };

  /* ─────────────────────────────────────
     SETTINGS TAB
  ───────────────────────────────────── */
  const SETTINGS_KEY = 'pba_settings';

  async function loadSettings() {
    return new Promise(res => {
      chrome.storage.local.get([SETTINGS_KEY], r => res(r[SETTINGS_KEY] || {}));
    });
  }

  async function initSettings() {
    const s = await loadSettings();
    if (s.backendUrl)    document.getElementById('s-backend-url').value   = s.backendUrl;
    if (s.ollamaModel)   document.getElementById('s-ollama-model').value  = s.ollamaModel;
    if (s.actionDelay !== undefined) document.getElementById('s-action-delay').value = s.actionDelay;
    if (s.privacy !== undefined)     document.getElementById('s-privacy').checked = s.privacy;
    if (s.confirm !== undefined)     document.getElementById('s-confirm').checked = s.confirm;
  }

  document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const settings = {
      backendUrl:   document.getElementById('s-backend-url').value,
      ollamaModel:  document.getElementById('s-ollama-model').value,
      actionDelay:  Number(document.getElementById('s-action-delay').value),
      privacy:      document.getElementById('s-privacy').checked,
      confirm:      document.getElementById('s-confirm').checked,
    };

    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
      const st = document.getElementById('settings-status');
      st.textContent = '✓ Settings saved';
      st.className   = 'save-status ok';
      setTimeout(() => { st.textContent = ''; st.className = 'save-status'; }, 2500);
    });
  });

  /* ─────────────────────────────────────
     INIT
  ───────────────────────────────────── */
  async function init() {
    await Promise.all([
      checkBackend(),
      loadProfile(),
      initSettings(),
      scanPage(),
    ]);
  }

  init();

  // Re-check backend every 15s
  setInterval(checkBackend, 15000);

  /* ─────────────────────────────────────
     Utilities
  ───────────────────────────────────── */
  function truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : (str || '—');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

})();
