(function () {
  'use strict';

  let currentProfile = {};
  let fillDetails = [];
  let isMasked = true;

  const statFieldsCount = document.getElementById('stat-fields-count');
  const statPiiCount    = document.getElementById('stat-pii-count');
  const statMappedCount = document.getElementById('stat-mapped-count');
  const fieldsGrid      = document.getElementById('fields-grid');
  const mappingBody     = document.getElementById('mapping-table-body');
  const jsonDisplay     = document.getElementById('json-display');

  const backToFormBtn   = document.getElementById('back-to-form-btn');
  const toggleMaskBtn   = document.getElementById('toggle-mask-btn');
  const refreshDataBtn  = document.getElementById('refresh-data-btn');
  const copyJsonBtn     = document.getElementById('copy-json-btn');
  const clearProfileBtn = document.getElementById('clear-profile-btn');

  const LABELS = {
    name: 'Full Name', email: 'Email', phone: 'Phone',
    dob: 'Date of Birth', address: 'Address', employee_id: 'Employee ID',
    division: 'Division', gender: 'Gender', clearance: 'Clearance Level', password: 'Password',
  };

  const SENSITIVE_KEYS = new Set(['password', 'email', 'phone', 'address', 'dob', 'employee_id', 'clearance', 'name']);

  const SELECTOR_MAP = {
    name: '#full_name, [name="full_name"]',
    employee_id: '#employee_id, [name="employee_id"]',
    dob: '#dob, input[type="date"]',
    gender: 'select#gender',
    email: '#email, input[type="email"]',
    phone: '#phone, input[type="tel"]',
    address: '#address, [name="address"]',
    division: 'select#division, [name="division"]',
    clearance: 'select#clearance_level',
    password: '#password, input[type="password"]'
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function loadProfileData() {
    chrome.storage.local.get(['pba_user_profile', 'pba_fill_details'], (res) => {
      currentProfile = res.pba_user_profile || {};
      fillDetails    = res.pba_fill_details || [];
      renderAll();
    });
  }

  function renderAll() {
    const keys = Object.keys(currentProfile);
    const count = keys.length;

    if (statFieldsCount) statFieldsCount.textContent = String(count);

    let piiCount = 0;
    keys.forEach(k => { if (SENSITIVE_KEYS.has(k)) piiCount++; });
    if (statPiiCount) statPiiCount.textContent = String(piiCount);
    if (statMappedCount) statMappedCount.textContent = count > 0 ? (fillDetails.length > 0 ? `${fillDetails.length} Transferred` : 'Ready') : '0%';

    // 1. Render Extracted Word Profile Fields Grid (Important data strictly redacted)
    if (count === 0) {
      fieldsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <h3>No Profile Data Loaded Yet</h3>
          <p>Select a Word document (.docx) in the extension popup to view extracted profile data here.</p>
        </div>
      `;
      mappingBody.innerHTML = '<tr><td colspan="6" class="td-empty">No active profile loaded. Upload a .docx document first.</td></tr>';
      jsonDisplay.textContent = '// No profile data in memory';
      return;
    }

    fieldsGrid.innerHTML = Object.entries(currentProfile).map(([k, v]) => {
      const label = LABELS[k] || k;
      const isSensitive = SENSITIVE_KEYS.has(k);
      const displayVal = isSensitive ? '•••••••• [PROTECTED DATA]' : v;
      const badgeClass = isSensitive ? 'sensitive' : 'standard';
      const badgeText = isSensitive ? 'PROTECTED DATA' : 'STANDARD';

      return `
        <div class="field-card">
          <div class="field-top">
            <span class="field-name">${escapeHtml(label)}</span>
            <span class="field-key-tag">${escapeHtml(k)}</span>
          </div>
          <div class="field-value-box">${escapeHtml(displayVal)}</div>
          <div class="field-footer">
            <span class="pii-badge ${badgeClass}">${badgeText}</span>
            <span>Word Doc Extracted</span>
          </div>
        </div>
      `;
    }).join('');

    // 2. Render AI Form Field Execution & Transfer Table (Important data strictly redacted)
    if (fillDetails && fillDetails.length > 0) {
      mappingBody.innerHTML = fillDetails.map(item => {
        const label = LABELS[item.key] || item.key;
        const isSensitive = SENSITIVE_KEYS.has(item.key);
        const displayVal = isSensitive ? '•••••••• [PROTECTED DATA]' : item.value;

        return `
          <tr>
            <td><strong>${escapeHtml(item.key)}</strong></td>
            <td>${escapeHtml(label)}</td>
            <td><code class="selector-code">${escapeHtml(item.selector)}</code></td>
            <td><strong>${escapeHtml(displayVal)}</strong></td>
            <td>Injected (${escapeHtml(item.elementTag)})</td>
            <td><span class="status-tag success">${escapeHtml(item.status)}</span></td>
          </tr>
        `;
      }).join('');
    } else {
      // Show ready mapping targets based on extracted profile
      mappingBody.innerHTML = Object.entries(currentProfile).map(([k, v]) => {
        const label = LABELS[k] || k;
        const selector = SELECTOR_MAP[k] || `[name="${k}"]`;
        const isSensitive = SENSITIVE_KEYS.has(k);
        const displayVal = isSensitive ? '•••••••• [PROTECTED DATA]' : v;

        return `
          <tr>
            <td><strong>${escapeHtml(k)}</strong></td>
            <td>${escapeHtml(label)}</td>
            <td><code class="selector-code">${escapeHtml(selector)}</code></td>
            <td><strong>${escapeHtml(displayVal)}</strong></td>
            <td>Ready to fill</td>
            <td><span class="status-tag success">UNLOCKED</span></td>
          </tr>
        `;
      }).join('');
    }

    // 3. Render JSON Inspector (Important data strictly redacted)
    const displayObj = {};
    Object.entries(currentProfile).forEach(([k, v]) => {
      displayObj[k] = SENSITIVE_KEYS.has(k) ? '•••••••• [PROTECTED_DATA]' : v;
    });
    jsonDisplay.textContent = JSON.stringify(displayObj, null, 2);
  }

  // Event Listeners
  if (backToFormBtn) {
    backToFormBtn.addEventListener('click', () => {
      chrome.tabs.query({}, (tabs) => {
        const formTab = tabs.find(t => t.url && (t.url.includes('/demo') || (t.url.startsWith('http') && !t.url.includes('chrome-extension'))));
        if (formTab) {
          chrome.tabs.update(formTab.id, { active: true });
          if (formTab.windowId) {
            chrome.windows.update(formTab.windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: 'http://localhost:8000/demo/' });
        }
      });
    });
  }

  if (toggleMaskBtn) {
    toggleMaskBtn.style.display = 'none';
  }

  if (refreshDataBtn) {
    refreshDataBtn.addEventListener('click', loadProfileData);
  }

  if (copyJsonBtn) {
    copyJsonBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(currentProfile, null, 2)).then(() => {
        copyJsonBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyJsonBtn.textContent = '📋 Copy JSON'; }, 2000);
      });
    });
  }

  if (clearProfileBtn) {
    clearProfileBtn.addEventListener('click', () => {
      if (confirm('Clear extracted Word profile data and transfer logs from local memory?')) {
        chrome.storage.local.remove(['pba_user_profile', 'pba_fill_details'], () => {
          currentProfile = {};
          fillDetails = [];
          renderAll();
        });
      }
    });
  }

  // Listen for real-time storage changes and update page automatically
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.pba_user_profile || changes.pba_fill_details) {
      loadProfileData();
    }
  });

  // Initial load
  loadProfileData();

})();
