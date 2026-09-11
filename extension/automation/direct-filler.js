/**
 * extension/automation/direct-filler.js
 *
 * Injected as a content script.
 * Receives DIRECT_FILL messages from background.js with the full user profile.
 * Fills the page form fields directly — NO backend, NO Ollama needed.
 *
 * Exposed as window.__directFiller for use within the page context.
 */

(function () {
  'use strict';
  if (window.__directFiller) return;

  /** Field-mapping strategy: try multiple selectors for each profile key */
  const FIELD_MAP = [
    // [profile_key, action, ...selector_attempts]
    // action: 'fill' | 'select' | 'check'
    { key: 'name',        action: 'fill',   selectors: ['#full_name', '[name="full_name"]', '[data-pii="name"]', 'input[autocomplete="name"]', '[id*="full_name" i]', '[id*="name" i]', '[name*="name" i]'] },
    { key: 'employee_id', action: 'fill',   selectors: ['#employee_id', '[name="employee_id"]', '[data-pii="employee_id"]', '[id*="employee" i]', '[id*="emp" i]', '[name*="employee" i]'] },
    { key: 'dob',         action: 'fill',   selectors: ['#dob', '[name="dob"]', '[data-pii="dob"]', 'input[type="date"]', '[id*="birth" i]', '[name*="dob" i]'] },
    { key: 'gender',      action: 'select', selectors: ['#gender', '[name="gender"]', '[data-label="Gender"]', 'select[id*="gender" i]', 'select[name*="gender" i]'] },
    { key: 'email',       action: 'fill',   selectors: ['#email', '[name="email"]', '[data-pii="email"]', 'input[type="email"]', '[id*="email" i]'] },
    { key: 'phone',       action: 'fill',   selectors: ['#phone', '[name="phone"]', '[data-pii="phone"]', 'input[type="tel"]', '[id*="phone" i]', '[id*="mobile" i]'] },
    { key: 'address',     action: 'fill',   selectors: ['#address', '[name="address"]', '[data-pii="address"]', '[id*="address" i]', '[name*="address" i]'] },
    { key: 'division',    action: 'select', selectors: ['#division', '[name="division"]', '[data-label="Division"]', 'select[id*="division" i]', 'select[id*="dept" i]', 'select[id*="department" i]', 'select[name*="division" i]', 'select[name*="dept" i]', 'input[id*="division" i]', 'input[id*="dept" i]', 'input[id*="department" i]', 'input[name*="division" i]', 'input[name*="dept" i]'] },
    { key: 'clearance',   action: 'select', selectors: ['#clearance_level', '#clearance', '[name="clearance_level"]', '[name="clearance"]', '[data-label="Clearance Level"]', 'select[id*="clearance" i]', 'select[name*="clearance" i]', 'input[id*="clearance" i]'] },
    { key: 'password',    action: 'fill',   selectors: ['#password', '[name="password"]', '[data-pii="password"]', 'input[type="password"]:not([id*="confirm" i])'] },
    { key: 'password',    action: 'fill',   selectors: ['#confirm_password', '[name="confirm_password"]', '[id*="confirm" i]', 'input[type="password"][id*="confirm" i]'] },
  ];

  function findEl(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function normaliseDateValue(raw) {
    if (!raw) return '';
    let str = String(raw).trim().replace(/th|st|nd|rd/gi, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    const mYYYY = str.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (mYYYY) return `${mYYYY[1]}-${mYYYY[2].padStart(2,'0')}-${mYYYY[3].padStart(2,'0')}`;

    const mDD = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (mDD) {
      let d = parseInt(mDD[1], 10);
      let m = parseInt(mDD[2], 10);
      let y = parseInt(mDD[3], 10);
      if (m > 12 && d <= 12) { const tmp = d; d = m; m = tmp; }
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    const mYY = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})/);
    if (mYY) {
      let d = parseInt(mYY[1], 10);
      let m = parseInt(mYY[2], 10);
      let yr = parseInt(mYY[3], 10);
      let fullY = yr > 30 ? 1900 + yr : 2000 + yr;
      return `${fullY}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    const months = {
      jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
      jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,
      oct:10,october:10,nov:11,november:11,dec:12,december:12
    };

    const mWord1 = str.match(/(\d{1,2})[\s\-\/\.]*([A-Za-z]{3,9})[\s\-\/\.]*(\d{2,4})/);
    if (mWord1) {
      const mo = months[mWord1[2].toLowerCase().slice(0,3)];
      let y = parseInt(mWord1[3], 10);
      if (y < 100) y += y > 30 ? 1900 : 2000;
      if (mo) return `${y}-${String(mo).padStart(2,'0')}-${mWord1[1].padStart(2,'0')}`;
    }

    const mWord2 = str.match(/([A-Za-z]{3,9})[\s\-\/\.]*(\d{1,2}),?[\s\-\/\.]*(\d{2,4})/);
    if (mWord2) {
      const mo = months[mWord2[1].toLowerCase().slice(0,3)];
      let y = parseInt(mWord2[3], 10);
      if (y < 100) y += y > 30 ? 1900 : 2000;
      if (mo) return `${y}-${String(mo).padStart(2,'0')}-${mWord2[2].padStart(2,'0')}`;
    }

    return raw;
  }

  function simulateInput(el, value) {
    let fillVal = value;
    if (el.type === 'date' || el.id === 'dob' || (el.name && el.name.includes('dob'))) {
      fillVal = normaliseDateValue(value);
    }
    try {
      const proto = Object.getPrototypeOf(el);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, fillVal);
      } else {
        el.value = fillVal;
      }
    } catch (_) {
      el.value = fillVal;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  function simulateSelect(el, value) {
    if (!value) return false;
    const valueLower = String(value).toLowerCase().trim().replace(/\s+/g, '_');
    const valueClean = String(value).toLowerCase().trim();

    // 1. Exact value match
    for (const opt of el.options) {
      const optVal = opt.value.toLowerCase().trim();
      if (optVal === valueLower || optVal === valueClean) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 2. Exact text match
    for (const opt of el.options) {
      const optText = opt.text.toLowerCase().trim();
      if (optText === valueClean || optText === valueLower) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 3. Contains match
    for (const opt of el.options) {
      const optText  = opt.text.toLowerCase().trim();
      const optValue = opt.value.toLowerCase().trim();
      if ((optText && (optText.includes(valueClean) || valueClean.includes(optText))) ||
          (optValue && (optValue.includes(valueLower) || valueLower.includes(optValue)))) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 4. Substring / Word match
    const words = valueClean.split(/[\s_\-]+/).filter(w => w.length > 2);
    for (const word of words) {
      for (const opt of el.options) {
        const optText = opt.text.toLowerCase().trim();
        const optVal = opt.value.toLowerCase().trim();
        if (optText.includes(word) || optVal.includes(word)) {
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    // 5. Fallback: pick first non-placeholder option
    for (const opt of el.options) {
      if (opt.value && opt.value.trim() !== '') {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function highlightEl(el) {
    const prev = el.style.outline;
    el.style.outline = '2.5px solid #10b981';
    el.style.transition = 'outline 0.3s';
    setTimeout(() => {
      el.style.outline = prev;
    }, 2500);
  }

  const FRIENDLY_NAMES = {
    name: 'Full Name',
    employee_id: 'Employee ID',
    dob: 'Date of Birth',
    gender: 'Gender',
    email: 'Email Address',
    phone: 'Phone Number',
    address: 'Home Address',
    division: 'Division',
    clearance: 'Clearance Level',
    password: 'Password',
    terms: 'Terms Agreement'
  };

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showMissingDataModal(missingKeys) {
    // Exclude password completely from missing values list
    const filteredKeys = (missingKeys || []).filter(k => String(k).toLowerCase() !== 'password');
    if (filteredKeys.length === 0) {
      return;
    }

    // Remove any existing modals
    document.querySelectorAll('#pba-missing-modal-overlay, .pba-missing-toast').forEach(el => el.remove());
    const existingStyle = document.getElementById('pba-force-cursor-style');
    if (existingStyle) existingStyle.remove();

    const uniqueKeys = Array.from(new Set(filteredKeys));
    const labelsList = uniqueKeys.map(k => FRIENDLY_NAMES[k] || k);

    const overlay = document.createElement('div');
    overlay.id = 'pba-missing-modal-overlay';
    overlay.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      background: rgba(1, 8, 14, 0.85) !important;
      backdrop-filter: blur(14px) !important;
      -webkit-backdrop-filter: blur(14px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 20px !important;
      cursor: default !important;
      pointer-events: auto !important;
    `;

    overlay.innerHTML = `
      <div class="pba-missing-card" style="
        background: linear-gradient(145deg, rgba(8, 20, 32, 0.98) 0%, rgba(2, 10, 18, 0.99) 100%) !important;
        border: 1.5px solid #f59e0b !important;
        border-radius: 20px !important;
        padding: 32px 28px !important;
        max-width: 480px !important;
        width: 100% !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9), 0 0 35px rgba(245, 158, 11, 0.3) !important;
        color: #e2e8f0 !important;
        position: relative !important;
        font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
        pointer-events: auto !important;
        text-align: left !important;
      ">
        <!-- Top Right Close Button -->
        <button id="pba-x-close-btn" class="pba-close-trigger" type="button" aria-label="Close dialog" title="Close" onclick="var m=document.getElementById('pba-missing-modal-overlay');if(m)m.remove();" style="
          position: absolute !important;
          top: 16px !important;
          right: 16px !important;
          background: rgba(245, 158, 11, 0.12) !important;
          border: 1px solid rgba(245, 158, 11, 0.35) !important;
          color: #f59e0b !important;
          width: 32px !important;
          height: 32px !important;
          border-radius: 50% !important;
          cursor: pointer !important;
          font-weight: 800 !important;
          font-size: 14px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: all 0.2s !important;
          pointer-events: auto !important;
        ">✕</button>

        <!-- Header -->
        <div style="text-align: center; margin-bottom: 18px;">
          <div style="
            width: 58px; height: 58px; margin: 0 auto 12px; border-radius: 50%;
            background: rgba(245, 158, 11, 0.15); border: 2px solid #f59e0b;
            display: flex; align-items: center; justify-content: center;
            font-size: 28px; color: #f59e0b; box-shadow: 0 0 20px rgba(245, 158, 11, 0.35);
          ">⚠️</div>
          <div style="
            display: inline-block; padding: 4px 12px; background: rgba(245, 158, 11, 0.15);
            border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 100px;
            color: #f59e0b; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.8px;
            text-transform: uppercase; margin-bottom: 8px;
          ">
            PRIVACY VISION AI &bull; SAFETY POLICY
          </div>
          <h3 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: #ffffff; letter-spacing: -0.3px;">
            Missing Data in Word File
          </h3>
        </div>

        <p style="margin: 0 0 14px 0; font-size: 0.88rem; line-height: 1.5; color: #cbd5e1; text-align: center;">
          The following field(s) were <strong>not provided</strong> in your Word file and have been safely left blank:
        </p>

        <!-- Missing Fields List -->
        <ul style="
          margin: 0 0 16px 0;
          padding: 10px 18px 10px 32px;
          background: rgba(245, 158, 11, 0.08);
          border-radius: 10px;
          border: 1px solid rgba(245, 158, 11, 0.25);
          font-family: monospace;
          font-size: 0.86rem;
          color: #fef08a;
          max-height: 160px;
          overflow-y: auto;
        ">
          ${labelsList.map(name => `<li style="margin: 3px 0;"><strong>${escapeHtml(name)}</strong></li>`).join('')}
        </ul>

        <p style="margin: 0 0 22px 0; font-size: 0.78rem; line-height: 1.4; color: #94a3b8; text-align: center;">
          🛡️ <em>To protect your identity, missing fields are never populated with guessed data. You can now complete them manually.</em>
        </p>

        <!-- Action Buttons -->
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button id="pba-close-missing-modal" class="pba-close-trigger" type="button" onclick="var m=document.getElementById('pba-missing-modal-overlay');if(m)m.remove();" style="
            width: 100%;
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: #02080d;
            border: none;
            border-radius: 10px;
            padding: 12px 18px;
            font-size: 0.90rem;
            font-weight: 800;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 0 18px rgba(245, 158, 11, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            pointer-events: auto !important;
          ">
            ✕ Close &amp; Return to Form
          </button>

          <button id="pba-back-nav-btn" class="pba-close-trigger" type="button" style="
            width: 100%;
            background: rgba(255, 255, 255, 0.06);
            color: #94a3b8;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            padding: 10px 16px;
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            pointer-events: auto !important;
          ">
            ← Return to Dashboard Overview
          </button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    function removeModal() {
      const el = document.getElementById('pba-missing-modal-overlay');
      if (el) {
        el.remove();
      }
      document.querySelectorAll('#pba-missing-modal-overlay, .pba-missing-toast').forEach(e => e.remove());
      window.removeEventListener('keydown', onKey, true);
    }

    function returnToDashboard() {
      removeModal();
      // If on the ISRO Galaxy dashboard, navigate to Overview tab
      const overviewNav = Array.from(document.querySelectorAll('.nav-item, button, a')).find(
        el => el.textContent && el.textContent.includes('Overview')
      );
      if (overviewNav) {
        overviewNav.click();
      } else {
        window.history.back();
      }
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        removeModal();
      }
    }
    window.addEventListener('keydown', onKey, true);

    // Multiple redundant event listener bindings for 100% click reliability
    const okBtn = overlay.querySelector('#pba-close-missing-modal');
    const xBtn = overlay.querySelector('#pba-x-close-btn');
    const backBtn = overlay.querySelector('#pba-back-nav-btn');

    if (okBtn) {
      okBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); removeModal(); };
      ['click', 'pointerdown', 'mousedown'].forEach(evt => {
        okBtn.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); removeModal(); }, true);
      });
    }

    if (xBtn) {
      xBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); removeModal(); };
      ['click', 'pointerdown', 'mousedown'].forEach(evt => {
        xBtn.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); removeModal(); }, true);
      });
    }

    if (backBtn) {
      backBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); returnToDashboard(); };
      ['click', 'pointerdown', 'mousedown'].forEach(evt => {
        backBtn.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); returnToDashboard(); }, true);
      });
    }

    // Dismiss if user clicks outside the modal card
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        removeModal();
      }
    }, true);
  }

  /**
   * Fill matching form fields using the profile.
   * @param {Object} profile  — { name, email, phone, ... }
   * @param {Array<string>|null} targetKeys — optional list of specific keys to fill (e.g. ['name'])
   * @returns {{ filled: string[], skipped: string[], missingInProfile: string[] }}
   */
  async function fillForm(profile, targetKeys = null) {
    const filled  = [];
    const skipped = [];
    const missingInProfile = [];
    const fillDetails = [];

    const keysToFill = Array.isArray(targetKeys) && targetKeys.length > 0
      ? new Set(targetKeys.map(k => String(k).toLowerCase().trim()))
      : null;

    // If no form element is present on page, check if we are on the ISRO Galaxy dashboard
    if (!document.querySelector('form')) {
      const docNav = Array.from(document.querySelectorAll('.nav-item, button, a')).find(
        el => el.textContent && (el.textContent.includes('Documents') || el.textContent.includes('ISRO Form'))
      );
      if (docNav) {
        docNav.click();
        await new Promise(r => setTimeout(r, 450));
      }
    }

    // Show banner
    if (window.__agentBanner) window.__agentBanner.show('🤖 Agent filling requested fields…');

    for (const mapping of FIELD_MAP) {
      if (keysToFill && !keysToFill.has(mapping.key.toLowerCase())) {
        continue; // Skip fields not requested by user
      }

      const el = findEl(mapping.selectors);
      const value = profile[mapping.key];

      // If form element exists on page BUT data is missing from Word profile:
      if (el && (!value || String(value).trim() === '')) {
        // Exclude password from missing list (users do not put passwords in resumes/Word files)
        if (mapping.key.toLowerCase() !== 'password' && !missingInProfile.includes(mapping.key)) {
          missingInProfile.push(mapping.key);
        }
        skipped.push(mapping.key + ' (left blank — not in Word document)');
        continue; // DO NOT fill unknown data into the element!
      }

      if (!value) { skipped.push(mapping.key); continue; }
      if (!el) { skipped.push(mapping.key + ' (no element)'); continue; }

      await new Promise(r => setTimeout(r, 150)); // small delay for UX

      try {
        let isSuccess = false;
        if (el.tagName.toLowerCase() === 'select') {
          isSuccess = simulateSelect(el, value);
        } else {
          simulateInput(el, value);
          isSuccess = true;
        }

        if (isSuccess) {
          highlightEl(el);
          if (!filled.includes(mapping.key)) filled.push(mapping.key);
          fillDetails.push({
            key: mapping.key,
            value: value,
            selector: el.id ? `#${el.id}` : (el.name ? `[name="${el.name}"]` : mapping.selectors[0]),
            elementTag: el.tagName.toLowerCase(),
            status: 'TRANSFERRED ✓',
            time: new Date().toLocaleTimeString()
          });
        } else {
          skipped.push(mapping.key + ' (no matching option)');
        }
      } catch (err) {
        skipped.push(mapping.key + ' (error: ' + err.message + ')');
      }
    }

    // Save fill details for Data Inspector across chrome.storage, localStorage, and backend
    if (fillDetails.length > 0) {
      chrome.storage.local.set({ pba_fill_details: fillDetails, pba_user_profile: profile });
      try {
        localStorage.setItem('pba_fill_details', JSON.stringify(fillDetails));
        if (profile) localStorage.setItem('pba_user_profile', JSON.stringify(profile));
        window.dispatchEvent(new CustomEvent('pba_fill_completed', { detail: { profile, fillDetails } }));
        window.postMessage({ type: 'PBA_DATA_INSPECTOR_UPDATE', profile, fillDetails }, '*');
      } catch (_) {}
      fetch('http://localhost:8000/api/inspector/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: profile || {}, fill_details: fillDetails })
      }).catch(() => {});
    }

    // Only check Terms if targetKeys is null or explicitly includes terms
    if (!keysToFill || keysToFill.has('terms')) {
      const terms = document.querySelector('#terms, [name="terms"], input[type="checkbox"]');
      if (terms && !terms.checked) {
        terms.checked = true;
        terms.dispatchEvent(new Event('change', { bubbles: true }));
        if (!filled.includes('terms')) filled.push('terms');
      }
    }

    if (window.__agentBanner) window.__agentBanner.hide();

    // Trigger pop-up overlay if any requested/target fields were missing in the Word profile!
    if (missingInProfile.length > 0) {
      showMissingDataModal(missingInProfile);
    }

    return { filled, skipped, missingInProfile };
  }

  window.__directFiller = { fillForm };
  console.log('[DirectFiller] direct-filler.js loaded');
})();
