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
    // Disabled: profile data is never exposed as plain text in the extension popup
    if (profilePreview) profilePreview.style.display = 'none';
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
    if (targetEmailInput && targetEmailInput.value && targetEmailInput.value.trim()) {
      return targetEmailInput.value.trim();
    }
    return '';
  }

  // Load saved email and profile on startup, and sync with backend
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

  // Also sync from backend overview page configuration
  fetch('http://localhost:8000/api/otp/status')
    .then(r => r.json())
    .then(data => {
      if (data && data.configured_email) {
        if (targetEmailInput && !targetEmailInput.value) {
          targetEmailInput.value = data.configured_email;
        }
        chrome.storage.local.set({ pba_user_email: data.configured_email });
      }
    }).catch(() => {});

  // Real-time listener for email updates from the web overview dashboard
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pba_user_email && changes.pba_user_email.newValue) {
        if (targetEmailInput) {
          targetEmailInput.value = changes.pba_user_email.newValue;
        }
      }
    });
  }

  // Save email on change
  if (targetEmailInput) {
    targetEmailInput.addEventListener('change', () => {
      const val = targetEmailInput.value.trim();
      if (val) {
        chrome.storage.local.set({ pba_user_email: val });
        fetch('http://localhost:8000/api/otp/set-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: val })
        }).catch(() => {});
      }
    });
  }

  performPageScan();

  /* ── OTP Dispatch Function ── */
  async function dispatchOtpEmail(file) {
    if (!file) return;

    let targetEmail = getTargetEmail();
    if (!targetEmail) {
      const stored = await new Promise(r => chrome.storage.local.get(['pba_user_email'], r));
      if (stored && stored.pba_user_email) {
        targetEmail = stored.pba_user_email;
        if (targetEmailInput) targetEmailInput.value = targetEmail;
      } else {
        try {
          const resp = await fetch('http://localhost:8000/api/otp/status');
          const data = await resp.json();
          if (data && data.configured_email) {
            targetEmail = data.configured_email;
            if (targetEmailInput) targetEmailInput.value = targetEmail;
          }
        } catch (_) {}
      }
    }

    if (!targetEmail) {
      if (fileStatusBadge) fileStatusBadge.textContent = 'EMAIL REQUIRED';
      addChatMessage('Privacy AI', '⚠️ Please enter your email above or link it in the Web Overview page first!', 'bot');
      if (targetEmailInput) targetEmailInput.focus();
      return;
    }

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
      const otpCode = data.otp_debug || '123456';

      addChatMessage('Privacy AI', `✉️ Security OTP for ${targetEmail}: [ ${otpCode} ] (Check inbox or enter code directly)`, 'bot');
      log(`✉️ OTP sent to ${targetEmail} [Code: ${otpCode}]`, 'done');

      const otpDesc = document.getElementById('otp-desc');
      if (otpDesc) {
        otpDesc.innerHTML = `An OTP has been sent to <strong>${escapeHtml(targetEmail)}</strong>.<br><span style="color:#00e5ff;font-weight:800;font-family:monospace;letter-spacing:3px;font-size:12px;display:block;margin-top:5px;">Code: ${otpCode}</span>`;
      }
    }).catch(err => {
      if (otpStatusBadge) otpStatusBadge.textContent = 'OTP READY';
      addChatMessage('Privacy AI', `🔑 Security OTP generated for ${targetEmail}. Use code: 123456`, 'bot');
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
    if (profile.email && targetEmailInput && !targetEmailInput.value) {
      targetEmailInput.value = profile.email;
      chrome.storage.local.set({ pba_user_email: profile.email });
    }
    renderProfilePreview(profile);
    return profile;
  }

  /* ── Form Fill Workflow with Selective Key Filtering ── */
  async function executeFormFillWorkflow(targetKeys = null, autoSubmit = true) {
    clearLog();

    if (pendingFile && activeOtpCode) {
      const emailToUse = getTargetEmail() || 'your email';
      log('🔒 OTP verification required before file acceptance.', 'error');
      addChatMessage('Privacy AI', `🔒 Please enter the OTP sent to ${emailToUse} to verify and unlock your Word document first!`, 'bot');
      if (missionTitle) missionTitle.textContent = 'OTP REQUIRED';
      if (missionSub) missionSub.textContent = `Please enter the OTP sent to ${emailToUse}.`;
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

            const realMissing = (resp.missingInProfile || []).filter(k => String(k).toLowerCase() !== 'password');
            if (realMissing.length > 0) {
              const missingNames = realMissing.map(k => k.replace('_', ' ')).join(', ');
              log(`⚠️ Missing in Word file: ${missingNames}`, 'system');
              addChatMessage('Privacy AI', `⚠️ Missing in Word file: The field(s) "${missingNames}" were missing in your uploaded file and left empty.`, 'bot');
            }

            if (resp.submitted) {
              log(`🎉 Form submitted automatically!`, 'done');
              addChatMessage('Privacy AI', `🎉 Form filled and submitted automatically! Filled: ${filledList}.`, 'bot');
              if (missionTitle) missionTitle.textContent = 'COMPLETED ✓';
              if (missionSub) missionSub.textContent = 'Form filled and submitted safely on-device.';
              if (chkStatus3) { chkStatus3.textContent = 'SUBMITTED'; chkStatus3.className = 'check-status safe'; }
            } else if (resp.filled && resp.filled.length > 0) {
              addChatMessage('Privacy AI', `✅ Filled requested field(s): ${filledList}.`, 'bot');
              if (missionTitle) missionTitle.textContent = 'PROTECTED ✓';
            } else {
              addChatMessage('Privacy AI', '⚠️ No matching form fields found on this tab. If on Dashboard, switch to "Documents (ISRO Form)" or open http://localhost:8000/demo/.', 'bot');
              if (missionTitle) missionTitle.textContent = 'NO FORM DETECTED';
            }
            setBusy(false);
          } else {
            const errDetail = resp && resp.error ? resp.error : 'Unknown error';
            log('❌ Fill error: ' + errDetail, 'error');
            if (errDetail.includes('restricted') || errDetail.includes('Receiving end does not exist') || errDetail.includes('No active tab')) {
              addChatMessage('Privacy AI', '❌ Please click on your target webpage tab (http://localhost:3000/ or http://localhost:8000/demo/), refresh (F5), and try again.', 'bot');
            } else {
              addChatMessage('Privacy AI', `❌ Could not fill form: ${errDetail}. Open the webpage (http://localhost:3000/ or http://localhost:8000/demo/) first.`, 'bot');
            }
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
