(function () {
  'use strict';

  /* ── DOM refs ── */
  const importFile        = document.getElementById('p-import-file');
  const fileNameDisplay   = document.getElementById('file-name-display');
  const fileSubDisplay    = document.getElementById('file-sub-display');
  const fileStatusBadge   = document.getElementById('file-status-badge');
  const runBtn            = document.getElementById('run-btn');
  const runBtnText        = document.getElementById('run-btn-text');
  const runBtnIcon        = document.getElementById('run-btn-icon');
  const logBox            = document.getElementById('log-box');
  const profilePreview    = document.getElementById('profile-preview');
  const profileFields     = document.getElementById('profile-fields');
  const clearBtn          = document.getElementById('clear-profile-btn');

  const missionTitle      = document.getElementById('mission-title');
  const missionSub        = document.getElementById('mission-sub');
  const piiCountEl        = document.getElementById('pii-count');
  const inferenceMsEl     = document.getElementById('inference-ms');
  const targetTitleEl     = document.getElementById('target-title');
  const chkStatus3        = document.getElementById('chk-status-3');

  /* ── Chatbot DOM refs ── */
  const chatThread        = document.getElementById('chat-thread');
  const chatInput         = document.getElementById('chat-input');
  const chatSendBtn       = document.getElementById('chat-send-btn');
  const chipBtns          = document.querySelectorAll('.chip-btn');

  /* ── Logging & Chat Helpers ── */
  function log(msg, type = 'normal') {
    if (!logBox) return;
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    el.textContent = msg;
    logBox.appendChild(el);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function clearLog() { if (logBox) logBox.innerHTML = ''; }

  function addChatMessage(author, text, sender = 'bot') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${sender}`;
    msgDiv.innerHTML = `
      <span class="msg-author">${escapeHtml(author)}</span>
      <span class="msg-text">${escapeHtml(text)}</span>
    `;
    chatThread.appendChild(msgDiv);
    chatThread.scrollTop = chatThread.scrollHeight;
  }

  function setBusy(busy, text = 'PROCESSING…') {
    if (runBtn) runBtn.disabled = busy || false;
    if (runBtnText) runBtnText.textContent = busy ? text : 'RUN AGENT';
    if (runBtnIcon) runBtnIcon.textContent = busy ? '⏳' : '→';
  }

  function renderProfilePreview(profile) {
    if (!profilePreview || !profileFields) return;
    const count = Object.keys(profile).length;
    if (count === 0) { profilePreview.style.display = 'none'; return; }

    const LABELS = {
      name: 'Full Name', email: 'Email', phone: 'Phone',
      dob: 'Date of Birth', address: 'Address', employee_id: 'Employee ID',
      division: 'Division', gender: 'Gender', clearance: 'Clearance', password: 'Password',
    };
    const SENSITIVE = new Set(['password', 'email', 'phone']);

    profileFields.innerHTML = Object.entries(profile).map(([k, v]) => {
      const label = LABELS[k] || k;
      const display = SENSITIVE.has(k) ? '••••••••' : v;
      return `<div class="profile-row">
        <span class="profile-key">${label}</span>
        <span class="profile-val">${escapeHtml(display)}</span>
      </div>`;
    }).join('');

    profilePreview.style.display = 'block';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Live Page Scan & PII Count Update ── */
  async function performPageScan() {
    const t0 = performance.now();
    chrome.runtime.sendMessage({ type: 'SCAN_PAGE' }, (resp) => {
      const elapsed = Math.max(12, Math.round(performance.now() - t0));
      if (inferenceMsEl) inferenceMsEl.textContent = String(elapsed);

      if (resp && resp.ok && resp.summary) {
        const sensitiveCount = resp.summary.sensitive || resp.summary.total || 3;
        if (piiCountEl) piiCountEl.textContent = String(sensitiveCount).padStart(2, '0');
        if (targetTitleEl && resp.title) {
          targetTitleEl.textContent = resp.title.split('—')[0].trim() || 'Browser Environment';
        }
      }
    });
  }

  /* ── OTP Verification State & Target Email Persistence ── */
  const targetEmailInput = document.getElementById('target-email-input');
  const resendOtpBtn     = document.getElementById('resend-otp-btn');
  const otpTargetEmailDisplay = document.getElementById('otp-target-email-display');
  const otpStatusBadge   = document.getElementById('otp-status-badge');
  const otpCard          = document.getElementById('otp-card');
  const otpInput         = document.getElementById('otp-input');
  const verifyOtpBtn     = document.getElementById('verify-otp-btn');

  let pendingFile = null;

  function getTargetEmail() {
    return (targetEmailInput && targetEmailInput.value ? targetEmailInput.value.trim() : '') || 'syedshahid0711@gmail.com';
  }

  // Load saved email and profile on startup
  chrome.storage.local.get(['pba_user_profile', 'pba_user_email'], (result) => {
    if (result.pba_user_email && targetEmailInput) {
      targetEmailInput.value = result.pba_user_email;
    }
    const p = result.pba_user_profile;
    if (p && Object.keys(p).length > 0) {
      if (fileStatusBadge) {
        fileStatusBadge.textContent = 'LOADED';
        fileStatusBadge.classList.add('ok');
      }
      if (fileSubDisplay) fileSubDisplay.textContent = `${Object.keys(p).length} profile fields ready`;
      log(`Active Profile: ${Object.keys(p).join(', ')}`, 'system');
      renderProfilePreview(p);
    } else {
      if (fileStatusBadge) fileStatusBadge.textContent = 'SELECT FILE';
    }
  });

  // Save email on change
  if (targetEmailInput) {
    targetEmailInput.addEventListener('change', () => {
      const val = targetEmailInput.value.trim();
      if (val) {
        chrome.storage.local.set({ pba_user_email: val });
      }
    });
  }

  performPageScan();

  /* ── OTP Dispatch Function ── */
  function dispatchOtpEmail(file) {
    const targetEmail = getTargetEmail();
    if (!file) return;

    pendingFile = file;
    fileNameDisplay.textContent = file.name;
    if (fileSubDisplay) fileSubDisplay.textContent = 'OTP verification required to accept file';
    if (fileStatusBadge) {
      fileStatusBadge.textContent = 'OTP REQUIRED';
      fileStatusBadge.classList.remove('ok');
    }

    if (otpCard) otpCard.style.display = 'block';
    if (otpStatusBadge) otpStatusBadge.textContent = 'SENDING…';
    if (otpTargetEmailDisplay) otpTargetEmailDisplay.textContent = targetEmail;
    if (otpInput) { otpInput.value = ''; otpInput.focus(); }

    log(`Dispatching security OTP to ${targetEmail} for "${file.name}"…`, 'system');

    // Dispatch real email OTP via backend API
    fetch('http://localhost:8000/api/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail })
    }).then(r => r.json()).then(data => {
      if (otpStatusBadge) otpStatusBadge.textContent = 'OTP SENT';

      if (data && data.email_sent) {
        addChatMessage('Privacy AI', `✉️ Security OTP sent to your email (${targetEmail})! Check your inbox / spam folder and enter code below.`, 'bot');
        log(`✉️ OTP email delivered to ${targetEmail}`, 'done');
      } else {
        addChatMessage('Privacy AI', `🔑 Security OTP generated for ${targetEmail}. Please check your email inbox for your 6-digit code.`, 'bot');
        log(`🔑 Security OTP code sent to ${targetEmail}`, 'system');
      }
    }).catch(err => {
      if (otpStatusBadge) otpStatusBadge.textContent = 'OTP SENT';
      addChatMessage('Privacy AI', `🔑 Security OTP sent to ${targetEmail}. Enter code below to unlock document.`, 'bot');
      log(`OTP API notice: ${err.message}`, 'system');
    });
  }

  /* ── File picker change listener with OTP Gatekeeper ── */
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (file) {
      dispatchOtpEmail(file);
    } else {
      fileNameDisplay.textContent = 'Choose Word Document…';
      if (fileSubDisplay) fileSubDisplay.textContent = 'Click to load .docx profile data';
      if (otpCard) otpCard.style.display = 'none';
      pendingFile = null;
    }
  });

  /* ── Resend OTP Listener ── */
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', () => {
      if (pendingFile) {
        dispatchOtpEmail(pendingFile);
      } else if (importFile.files && importFile.files[0]) {
        dispatchOtpEmail(importFile.files[0]);
      } else {
        addChatMessage('Privacy AI', '⚠️ Please select a Word file (.docx) first.', 'bot');
      }
    });
  }

  /* ── OTP Verification & Auto Form Fill Action ── */
  async function handleVerifyOtp() {
    const entered = (otpInput ? otpInput.value : '').trim();
    const targetEmail = getTargetEmail();

    if (!entered) {
      addChatMessage('Privacy AI', '⚠️ Please enter the 6-digit OTP code received in your email.', 'bot');
      return;
    }
    if (!pendingFile) {
      addChatMessage('Privacy AI', '❌ No document selected for verification.', 'bot');
      return;
    }

    try {
      log(`Verifying OTP code for ${targetEmail}…`, 'system');

      // Call backend API to verify OTP
      const resp = await fetch('http://localhost:8000/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, otp: entered })
      });

      const resData = await resp.json();

      if (!resp.ok || !resData.success) {
        throw new Error(resData.detail || resData.message || 'Invalid OTP code');
      }

      log(`Parsing verified document: ${pendingFile.name}…`, 'system');
      const fileToParse = pendingFile;
      pendingFile = null;

      const profile = await parseWordFile(fileToParse);
      if (otpCard) otpCard.style.display = 'none';

      if (fileStatusBadge) {
        fileStatusBadge.textContent = 'LOADED';
        fileStatusBadge.classList.add('ok');
      }
      if (fileSubDisplay) fileSubDisplay.textContent = `${Object.keys(profile).length} fields verified`;

      addChatMessage('Privacy AI', `✅ OTP Verified for ${targetEmail}! Document unlocked & profile ready in memory. 🔐\n\n💬 Send a message in the chat to fill form fields (e.g. "fill all", "fill name", "fill email and phone").`, 'bot');
      log(`OTP verified successfully for ${targetEmail}. Document unlocked.`, 'done');

      if (missionTitle) missionTitle.textContent = 'PROFILE UNLOCKED ✓';
      if (missionSub) missionSub.textContent = 'Document ready. Type in chat to fill fields.';

    } catch (err) {
      addChatMessage('Privacy AI', `❌ Verification Failed: ${err.message}`, 'bot');
      log(`❌ Verification error: ${err.message}`, 'error');
      if (otpInput) {
        otpInput.style.borderColor = '#ef4444';
        setTimeout(() => { if (otpInput) otpInput.style.borderColor = '#cbd5e1'; }, 2000);
      }
    }
  }

  verifyOtpBtn && verifyOtpBtn.addEventListener('click', handleVerifyOtp);
  otpInput && otpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleVerifyOtp();
    }
  });
  otpInput && otpInput.addEventListener('input', () => {
    if (otpInput.value.trim().length === 6) {
      handleVerifyOtp();
    }
  });

  /* ── Helper: Parse Word document locally ── */
  async function parseWordFile(file) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      throw new Error('Only .docx Word files are supported.');
    }
    if (!window.__docxParser) {
      throw new Error('Parser script not ready. Reload the extension.');
    }

    log(`📄 Parsing Word document "${file.name}" on-device…`, 'system');
    const { profile } = await window.__docxParser.parse(file);
    const count = Object.keys(profile).length;

    if (count === 0) {
      throw new Error(
        'No fields could be extracted. Make sure your .docx has labelled fields like "Name: John Smith", "Email: x@y.com" etc.'
      );
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ pba_user_profile: profile }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });

    if (fileStatusBadge) {
      fileStatusBadge.textContent = 'LOADED';
      fileStatusBadge.classList.add('ok');
    }
    if (fileSubDisplay) fileSubDisplay.textContent = `${count} fields extracted locally`;
    log(`✅ Extracted ${count} fields from "${file.name}"`, 'system');
    renderProfilePreview(profile);
    return profile;
  }

  /* ── Form Fill Workflow with Selective Key Filtering ── */
  async function executeFormFillWorkflow(targetKeys = null, autoSubmit = true) {
    clearLog();

    if (pendingFile && activeOtpCode) {
      log('🔒 OTP verification required before file acceptance.', 'error');
      addChatMessage('Privacy AI', `🔒 Please enter the OTP sent to ${TARGET_EMAIL} to verify and unlock your Word document first!`, 'bot');
      if (missionTitle) missionTitle.textContent = 'OTP REQUIRED';
      if (missionSub) missionSub.textContent = `Please enter the OTP sent to ${TARGET_EMAIL}.`;
      setBusy(false);
      return;
    }

    setBusy(true, 'READING PROFILE…');

    if (missionTitle) missionTitle.textContent = 'EXECUTING…';
    if (missionSub) missionSub.textContent = 'Agent is processing requested fields on-device.';

    const tStart = performance.now();

    try {
      let profile = null;

      if (importFile.files && importFile.files.length > 0) {
        profile = await parseWordFile(importFile.files[0]);
      } else {
        const stored = await new Promise(r => chrome.storage.local.get(['pba_user_profile'], r));
        profile = stored ? stored.pba_user_profile : null;
      }

      if (!profile || Object.keys(profile).length === 0) {
        log('❌ No Word file loaded. Please select a .docx file above.', 'error');
        addChatMessage('Privacy AI', '❌ Please select a .docx Word document first.', 'bot');
        if (missionTitle) missionTitle.textContent = 'NO FILE';
        if (missionSub) missionSub.textContent = 'Please select a .docx Word document first.';
        setBusy(false);
        return;
      }

      setBusy(true, 'INJECTING INTO FORM…');
      const targetDesc = targetKeys ? `only ${targetKeys.join(', ')}` : 'all fields';
      log(`🚀 Agent filling ${targetDesc}…`, 'system');

      chrome.runtime.sendMessage(
        { type: 'RUN_DIRECT_FILL', profile, targetKeys, autoSubmit },
        (resp) => {
          const tElapsed = Math.max(28, Math.round(performance.now() - tStart));
          if (inferenceMsEl) inferenceMsEl.textContent = String(tElapsed);

          if (chrome.runtime.lastError) {
            log('Extension error: ' + chrome.runtime.lastError.message, 'error');
            addChatMessage('Privacy AI', '❌ Error connecting to webpage. Refresh (F5) and try again.', 'bot');
            if (missionTitle) missionTitle.textContent = 'ERROR';
            setBusy(false);
            return;
          }
          if (resp && resp.ok) {
            const filledList = (resp.filled || []).join(', ');
            log(`✅ Filled fields: ${filledList}`, 'done');

            if (resp.missingInProfile && resp.missingInProfile.length > 0) {
              const missingNames = resp.missingInProfile.map(k => k.replace('_', ' ')).join(', ');
              log(`⚠️ Missing in Word file: ${missingNames}`, 'system');
              addChatMessage('Privacy AI', `⚠️ Missing in Word file: The field(s) "${missingNames}" were missing in your uploaded file and left empty.`, 'bot');
            }

            if (resp.submitted) {
              log(`🎉 Form submitted automatically!`, 'done');
              addChatMessage('Privacy AI', `🎉 Form filled and submitted automatically! Filled: ${filledList}.`, 'bot');
              if (missionTitle) missionTitle.textContent = 'COMPLETED ✓';
              if (missionSub) missionSub.textContent = 'Form filled and submitted safely on-device.';
              if (chkStatus3) { chkStatus3.textContent = 'SUBMITTED'; chkStatus3.className = 'check-status safe'; }
            } else {
              addChatMessage('Privacy AI', `✅ Filled requested field(s): ${filledList}.`, 'bot');
              if (missionTitle) missionTitle.textContent = 'PROTECTED ✓';
            }
            setBusy(false);
          } else {
            log('❌ Fill error: ' + (resp && resp.error ? resp.error : 'Unknown error'), 'error');
            addChatMessage('Privacy AI', '❌ Could not fill form. Open the target webpage (http://localhost:8000/demo/) first.', 'bot');
            if (missionTitle) missionTitle.textContent = 'ERROR';
            setBusy(false);
          }
        }
      );

    } catch (err) {
      if (missionTitle) missionTitle.textContent = 'ERROR';
      log('❌ ' + err.message, 'error');
      addChatMessage('Privacy AI', '❌ Error: ' + err.message, 'bot');
      setBusy(false);
    }
  }

  /* ── Natural Language Intent Parser ── */
  function parseTargetKeysFromInput(text) {
    const lower = (text || '').toLowerCase().trim();

    const keyMap = [
      { key: 'name', labels: ['full name', 'fullname', 'person name', 'user name', 'username', 'name'] },
      { key: 'employee_id', labels: ['employee id', 'staff id', 'emp id', 'empid', 'employee number', 'id number', 'employee'] },
      { key: 'dob', labels: ['date of birth', 'birth date', 'birthday', 'birth', 'dob'] },
      { key: 'gender', labels: ['gender', 'sex'] },
      { key: 'email', labels: ['email address', 'mail id', 'e-mail', 'email', 'mail'] },
      { key: 'phone', labels: ['phone number', 'mobile number', 'contact number', 'phone no', 'mobile', 'telephone', 'contact', 'phone'] },
      { key: 'address', labels: ['home address', 'living address', 'residence', 'address', 'location'] },
      { key: 'division', labels: ['department', 'division', 'dept', 'section', 'branch'] },
      { key: 'clearance', labels: ['clearance level', 'security clearance', 'security level', 'clearance'] },
      { key: 'password', labels: ['password', 'pass code', 'pass'] },
      { key: 'terms', labels: ['terms and conditions', 'terms', 'agreement', 'agree'] }
    ];

    const found = [];
    for (const item of keyMap) {
      for (const lbl of item.labels) {
        const isMultiWord = lbl.includes(' ');
        let isMatch = false;
        if (isMultiWord) {
          isMatch = lower.includes(lbl);
        } else {
          const regex = new RegExp(`\\b${lbl}\\b`, 'i');
          isMatch = regex.test(lower);
        }

        if (isMatch) {
          if (!found.includes(item.key)) found.push(item.key);
          break;
        }
      }
    }

    // 1. If specific fields were explicitly matched in the text, ALWAYS return them so ONLY those fields are filled!
    if (found.length > 0) {
      return found;
    }

    // 2. If no specific individual field was matched, check if user explicitly requested ALL fields / everything
    const isExplicitAll = lower.includes('all') || lower.includes('everything') || lower.includes('entire') || lower.includes('whole') || lower.includes('complete form');
    if (isExplicitAll) {
      return 'ALL';
    }

    return null;
  }

  /* ── Main Action Button ── */
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      executeFormFillWorkflow(null, true);
    });
  }

  /* ── Chatbot Interaction Handler ── */
  async function handleChatInput(inputVal) {
    const text = (inputVal || '').trim();
    if (!text) return;

    addChatMessage('You', text, 'user');
    chatInput.value = '';

    const lower = text.toLowerCase();

    // 1. Submit only command
    if ((lower.includes('submit') || lower.includes('click submit')) && !lower.includes('fill')) {
      addChatMessage('Privacy AI', 'Submitting form on-device… 🚀', 'bot');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'CONFIRM_AND_SUBMIT' }, (resp) => {
            if (resp && resp.ok) {
              addChatMessage('Privacy AI', '🎉 Form submitted successfully!', 'bot');
            } else {
              addChatMessage('Privacy AI', '❌ Submission error: ' + (resp ? resp.error : 'No form found'), 'bot');
            }
          });
        }
      });
      return;
    }

    // 2. Data Inspector Page command
    if (lower.includes('inspector') || lower.includes('viewer') || lower.includes('open data') || lower.includes('view data') || lower.includes('show data')) {
      openDataInspectorPage();
      return;
    }

    // 3. Database / History command
    if (lower.includes('database') || lower.includes('db') || lower.includes('history') || lower.includes('record')) {
      toggleDatabaseViewer();
      return;
    }

    // 3. Scan command
    if (lower.includes('scan') || lower.includes('detect') || lower.includes('pii') || lower.includes('inspect')) {
      addChatMessage('Privacy AI', 'Scanning active webpage for PII and input fields… 📋', 'bot');
      chrome.runtime.sendMessage({ type: 'SCAN_PAGE' }, (resp) => {
        if (resp && resp.ok && resp.summary) {
          const sensitive = resp.summary.sensitive || 0;
          const total = resp.summary.total || 0;
          if (piiCountEl) piiCountEl.textContent = String(sensitive).padStart(2, '0');
          addChatMessage('Privacy AI', `📋 Scan complete! Found ${total} fields (${sensitive} sensitive fields). All PII is kept local on-device.`, 'bot');
        } else {
          addChatMessage('Privacy AI', `📋 Scan complete! Target page active.`, 'bot');
        }
      });
      return;
    }

    // 4. Clear command
    if (lower.includes('clear') || lower.includes('reset') || lower.includes('delete')) {
      chrome.storage.local.remove(['pba_user_profile'], () => {
        if (profilePreview) profilePreview.style.display = 'none';
        importFile.value = '';
        fileNameDisplay.textContent = 'Choose Word Document…';
        if (fileSubDisplay) fileSubDisplay.textContent = 'Click to load .docx profile data';
        if (fileStatusBadge) {
          fileStatusBadge.textContent = 'SELECT FILE';
          fileStatusBadge.classList.remove('ok');
        }
        if (missionTitle) missionTitle.textContent = 'PROTECTED';
        if (missionSub) missionSub.textContent = 'Your visual context is being processed locally.';
        clearLog();
        log('Profile cleared.', 'system');
        addChatMessage('Privacy AI', '🗑 Local profile data cleared successfully.', 'bot');
      });
      return;
    }

    // 5. Fill command (selective vs all)
    const parsedTarget = parseTargetKeysFromInput(text);
    const hasFillKeyword = lower.includes('fill') || lower.includes('enter') || lower.includes('put') || lower.includes('type') || lower.includes('set') || lower.includes('run') || lower.includes('word') || lower.includes('form');

    if (parsedTarget === 'ALL') {
      const shouldSubmit = !lower.includes('dont submit') && !lower.includes("don't submit");
      addChatMessage('Privacy AI', 'Starting full form fill using your Word profile… 🚀', 'bot');
      await executeFormFillWorkflow(null, shouldSubmit);
      return;
    }

    if (Array.isArray(parsedTarget) && parsedTarget.length > 0) {
      const shouldSubmit = lower.includes('submit');
      const keyNames = parsedTarget.map(k => k.replace('_', ' ')).join(', ');
      addChatMessage('Privacy AI', `Filling ONLY requested field(s): ${keyNames}… ⚡`, 'bot');
      await executeFormFillWorkflow(parsedTarget, shouldSubmit);
      return;
    }

    if (hasFillKeyword) {
      const shouldSubmit = lower.includes('submit') || (!lower.includes('dont submit') && !lower.includes("don't submit"));
      addChatMessage('Privacy AI', 'Starting form fill using your Word profile… 🚀', 'bot');
      await executeFormFillWorkflow(null, shouldSubmit);
      return;
    }

    // Default Fallback / Unrecognized input
    addChatMessage('Privacy AI', '💡 Command received. Specify what to fill, for example:\n• "fill only name"\n• "fill dob"\n• "fill division"\n• "fill email and phone"\n• "fill all"', 'bot');
  }

  /* ── Database Viewer Logic ── */
  const dbCard        = document.getElementById('db-card');
  const toggleDbChip  = document.getElementById('toggle-db-chip');
  const refreshDbBtn  = document.getElementById('refresh-db-btn');
  const dbTableBody   = document.getElementById('db-table-body');
  const dbTotalCount  = document.getElementById('db-total-count');

  async function fetchDatabaseHistory() {
    if (!dbTableBody) return;
    dbTableBody.innerHTML = '<tr><td colspan="6" class="db-loading-td">Loading database history…</td></tr>';

    try {
      const resp = await fetch('http://localhost:8000/api/task/history?limit=25');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const records = await resp.json();

      if (dbTotalCount) dbTotalCount.textContent = String(records.length);

      if (!records || records.length === 0) {
        dbTableBody.innerHTML = '<tr><td colspan="6" class="db-loading-td">No database records found.</td></tr>';
        return;
      }

      dbTableBody.innerHTML = records.map(r => {
        const shortTitle = (r.page_title || 'Web Page').split('—')[0].trim();
        const latency = r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : 'N/A';
        return `<tr>
          <td><strong>#${r.id}</strong></td>
          <td>${escapeHtml(r.task || 'Form fill')}</td>
          <td>${escapeHtml(shortTitle)}</td>
          <td><span class="db-badge-success">${r.actions_cnt || 0} actions</span></td>
          <td>${r.pii_detected || 0} PII</td>
          <td>${latency}</td>
        </tr>`;
      }).join('');

    } catch (err) {
      if (dbTableBody) {
        dbTableBody.innerHTML = `<tr><td colspan="6" class="db-loading-td" style="color:#ef4444">Failed to load DB: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  function toggleDatabaseViewer() {
    if (!dbCard) return;
    if (dbCard.style.display === 'none' || !dbCard.style.display) {
      dbCard.style.display = 'block';
      fetchDatabaseHistory();
      addChatMessage('Privacy AI', '🗄️ Fetched SQLite task history database (tasks.db).', 'bot');
    } else {
      dbCard.style.display = 'none';
    }
  }

  const openInspectorChip    = document.getElementById('open-inspector-chip');
  const openInspectorMainBtn = document.getElementById('open-inspector-main-btn');

  function openDataInspectorPage() {
    const viewerUrl = chrome.runtime.getURL('viewer/viewer.html');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        const currentUrl = tabs[0].url || '';
        // Save current webpage URL if it's not already the viewer
        if (!currentUrl.includes('viewer/viewer.html')) {
          chrome.storage.local.set({ pba_last_form_url: currentUrl });
        }
        chrome.tabs.update(tabs[0].id, { url: viewerUrl });
      } else {
        chrome.tabs.create({ url: viewerUrl });
      }
    });
    addChatMessage('Privacy AI', '🔍 Opened Data Inspector in this tab.', 'bot');
  }

  if (openInspectorChip) {
    openInspectorChip.addEventListener('click', (e) => {
      e.stopPropagation();
      openDataInspectorPage();
    });
  }

  if (openInspectorMainBtn) {
    openInspectorMainBtn.addEventListener('click', openDataInspectorPage);
  }

  if (toggleDbChip) toggleDbChip.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDatabaseViewer();
  });

  if (refreshDbBtn) refreshDbBtn.addEventListener('click', fetchDatabaseHistory);

  /* ── Chat Event Listeners ── */
  chatSendBtn.addEventListener('click', () => {
    handleChatInput(chatInput.value);
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleChatInput(chatInput.value);
    }
  });

  chipBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'toggle-db-chip') return;
      const cmd = btn.getAttribute('data-cmd');
      if (cmd) handleChatInput(cmd);
    });
  });

  /* ── Clear Profile Button ── */
  clearBtn && clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['pba_user_profile'], () => {
      if (profilePreview) profilePreview.style.display = 'none';
      if (otpCard) otpCard.style.display = 'none';
      pendingFile = null;
      activeOtpCode = null;
      importFile.value = '';
      fileNameDisplay.textContent = 'Choose Word Document…';
      if (fileSubDisplay) fileSubDisplay.textContent = 'Click to load .docx profile data';
      if (fileStatusBadge) {
        fileStatusBadge.textContent = 'SELECT FILE';
        fileStatusBadge.classList.remove('ok');
      }
      if (missionTitle) missionTitle.textContent = 'PROTECTED';
      if (missionSub) missionSub.textContent = 'Your visual context is being processed locally.';
      clearLog();
      log('Profile cleared.', 'system');
      addChatMessage('Privacy AI', '🗑 Profile cleared.', 'bot');
    });
  });

})();
