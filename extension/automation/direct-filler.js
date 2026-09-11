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

  /**
   * Fill matching form fields using the profile.
   * @param {Object} profile  — { name, email, phone, ... }
   * @param {Array<string>|null} targetKeys — optional list of specific keys to fill (e.g. ['name'])
   * @returns {{ filled: string[], skipped: string[] }}
   */
  async function fillForm(profile, targetKeys = null) {
    const filled  = [];
    const skipped = [];
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

      const value = profile[mapping.key];
      if (!value) { skipped.push(mapping.key); continue; }

      const el = findEl(mapping.selectors);
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
    return { filled, skipped };
  }

  window.__directFiller = { fillForm };
  console.log('[DirectFiller] direct-filler.js loaded');
})();
