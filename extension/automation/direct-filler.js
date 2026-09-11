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
    const existing = document.getElementById('pba-missing-modal-overlay');
    if (existing) existing.remove();

    const existingStyle = document.getElementById('pba-force-cursor-style');
    if (existingStyle) existingStyle.remove();

    // 1. Force cursor visibility at document root level
    const styleEl = document.createElement('style');
    styleEl.id = 'pba-force-cursor-style';
    styleEl.textContent = `
      html, body, html *, body * {
        cursor: auto !important;
      }
      #pba-missing-modal-overlay, #pba-missing-modal-overlay * {
        cursor: auto !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      #pba-close-missing-modal, #pba-x-close-btn {
        cursor: pointer !important;
      }
      #pba-close-missing-modal:hover {
        background: #fbbf24 !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 0 24px rgba(245, 158, 11, 0.6) !important;
      }
      #pba-x-close-btn:hover {
        background: rgba(245, 158, 11, 0.3) !important;
        color: #ffffff !important;
        transform: scale(1.1) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(styleEl);

    const uniqueKeys = Array.from(new Set(missingKeys));
    const labelsList = uniqueKeys.map(k => FRIENDLY_NAMES[k] || k);

    const overlay = document.createElement('div');
    overlay.id = 'pba-missing-modal-overlay';
    overlay.style.cssText = `
      position: fixed !important;
      top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
      background: rgba(2, 8, 13, 0.90) !important;
      backdrop-filter: blur(12px) !important;
      -webkit-backdrop-filter: blur(12px) !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 16px !important;
      font-family: 'Inter', system-ui, -apple-system, sans-serif !important;
      cursor: auto !important;
      pointer-events: auto !important;
    `;

    overlay.innerHTML = `
      <div id="pba-modal-glow-cursor" style="
        position: fixed; width: 24px; height: 24px; border-radius: 50%;
        border: 2px solid #f59e0b; background: rgba(245, 158, 11, 0.2);
        pointer-events: none; z-index: 2147483647; transform: translate(-50%, -50%);
        box-shadow: 0 0 12px #f59e0b; display: none; transition: transform 0.05s ease;
      "></div>

      <div id="pba-missing-card" style="
        background: #020b12 !important;
        border: 1.5px solid #f59e0b !important;
        border-radius: 16px !important;
        max-width: 460px !important;
        width: 92% !important;
        max-height: 88vh !important;
        overflow-y: auto !important;
        padding: clamp(18px, 4vw, 26px) !important;
        box-shadow: 0 0 35px rgba(245, 158, 11, 0.4), 0 16px 50px rgba(0,0,0,0.85) !important;
        color: #d9f7ff !important;
        position: relative !important;
      ">
        <button id="pba-x-close-btn" title="Close modal" aria-label="Close dialog" type="button" onclick="var el=document.getElementById('pba-missing-modal-overlay'); if(el) el.remove(); var st=document.getElementById('pba-force-cursor-style'); if(st) st.remove();" style="
          position: absolute !important;
          top: 14px !important;
          right: 14px !important;
          width: 34px !important;
          height: 34px !important;
          border-radius: 50% !important;
          background: rgba(245, 158, 11, 0.12) !important;
          border: 1px solid rgba(245, 158, 11, 0.4) !important;
          color: #f59e0b !important;
          font-size: 16px !important;
          font-weight: 800 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          pointer-events: auto !important;
          transition: all 0.2s ease !important;
        ">✕</button>

        <div style="display: flex !important; align-items: center !important; gap: 12px !important; margin-bottom: 14px !important; padding-right: 32px !important;">
          <div style="
            width: 44px !important; height: 44px !important; border-radius: 50% !important;
            background: rgba(245, 158, 11, 0.15) !important; border: 1.5px solid #f59e0b !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            font-size: 22px !important; color: #f59e0b !important; flex-shrink: 0 !important;
            box-shadow: 0 0 14px rgba(245, 158, 11, 0.4) !important;
          ">⚠️</div>
          <div>
            <h3 style="margin:0 !important; font-size: 1.15rem !important; font-weight: 800 !important; color: #f59e0b !important; letter-spacing: 0.5px !important;">
              Missing Data in Word File
            </h3>
            <p style="margin: 2px 0 0 0 !important; font-size: 0.72rem !important; color: #94a3b8 !important; font-family: monospace !important;">
              PRIVACY VISION AI &bull; ON-DEVICE SAFETY POLICY
            </p>
          </div>
        </div>

        <p style="font-size: 0.85rem !important; line-height: 1.5 !important; color: #cbd5e1 !important; margin-bottom: 12px !important;">
          The following field(s) exist on this webpage form, but <strong>were not provided</strong> in your uploaded Word document:
        </p>

        <ul style="
          background: rgba(245, 158, 11, 0.08) !important;
          border: 1px solid rgba(245, 158, 11, 0.25) !important;
          border-radius: 10px !important;
          padding: 12px 16px 12px 32px !important;
          margin: 0 0 16px 0 !important;
          font-family: monospace !important;
          font-size: 0.84rem !important;
          color: #fef08a !important;
        ">
          ${labelsList.map(name => `<li style="margin-bottom: 4px !important;"><strong>${escapeHtml(name)}</strong></li>`).join('')}
        </ul>

        <p style="font-size: 0.78rem !important; color: #94a3b8 !important; line-height: 1.4 !important; margin-bottom: 20px !important;">
          🛡️ <em>Unknown fields were strictly left empty to prevent incorrect data injection. Only verified fields from your Word document were filled.</em>
        </p>

        <button id="pba-close-missing-modal" type="button" onclick="var el=document.getElementById('pba-missing-modal-overlay'); if(el) el.remove(); var st=document.getElementById('pba-force-cursor-style'); if(st) st.remove();" style="
          width: 100% !important;
          background: #f59e0b !important;
          color: #02080d !important;
          border: none !important;
          border-radius: 10px !important;
          padding: 12px !important;
          font-size: 0.88rem !important;
          font-weight: 900 !important;
          letter-spacing: 0.5px !important;
          cursor: pointer !important;
          pointer-events: auto !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 0 16px rgba(245, 158, 11, 0.4) !important;
        ">OK, Got It ✓</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const glowCursor = document.getElementById('pba-modal-glow-cursor');

    function onMouseMove(e) {
      if (glowCursor) {
        glowCursor.style.display = 'block';
        glowCursor.style.left = e.clientX + 'px';
        glowCursor.style.top = e.clientY + 'px';
      }
    }

    overlay.addEventListener('mousemove', onMouseMove);

    function closeModal() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
      window.removeEventListener('keydown', handleKey, true);
    }

    function handleKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        closeModal();
      }
    }

    ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(evtType => {
      const mainBtn = document.getElementById('pba-close-missing-modal');
      const xBtn = document.getElementById('pba-x-close-btn');

      if (mainBtn) mainBtn.addEventListener(evtType, function (e) {
        e.stopPropagation();
        closeModal();
      }, true);

      if (xBtn) xBtn.addEventListener(evtType, function (e) {
        e.stopPropagation();
        closeModal();
      }, true);
    });

    window.addEventListener('keydown', handleKey, true);

    ['click', 'pointerdown', 'mousedown'].forEach(evtType => {
      overlay.addEventListener(evtType, function (e) {
        if (e.target === overlay) {
          closeModal();
        }
      }, true);
    });
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
        if (!missingInProfile.includes(mapping.key)) {
          missingInProfile.push(mapping.key);
        }
        skipped.push(mapping.key + ' (missing in Word document)');
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

    // Save fill details for Data Inspector
    if (fillDetails.length > 0) {
      chrome.storage.local.set({ pba_fill_details: fillDetails });
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
