/**
 * extension/content/content.js
 *
 * Injected into every webpage.
 * Responsibilities:
 *  1. DOM analysis — extracts structured page representation
 *  2. Receives messages from background service worker
 *  3. Executes AI action plans via action-executor.js
 *  4. Sends scan results + PII stats back to popup/background
 */

(function () {
  'use strict';

  const log = window.__agentLogger;
  log && log.info('content.js loaded on', window.location.href);

  /* ─────────────────────────────────────
     DOM Scanner
     Builds the structured page context sent to the backend.
  ───────────────────────────────────── */
  function buildPageContext() {
    const scanResult = window.__piiDetector.scanPage();
    const sanitized  = window.__piiDetector.getSanitizedPageContext(scanResult);

    return {
      url:         window.location.href,
      title:       document.title,
      page_type:   detectPageType(),
      fields:      sanitized.fields,
      summary:     sanitized.summary,
      _raw_scan:   scanResult, // internal only, not sent to server
    };
  }

  /** Heuristically detect what kind of page we're on */
  function detectPageType() {
    const text = (document.title + ' ' + document.body.innerText.slice(0, 500)).toLowerCase();
    if (text.includes('login') || text.includes('sign in'))           return 'login';
    if (text.includes('register') || text.includes('registration'))   return 'registration_form';
    if (text.includes('checkout') || text.includes('payment'))        return 'checkout';
    if (text.includes('contact') || text.includes('feedback'))        return 'contact_form';
    if (text.includes('profile') || text.includes('account'))         return 'profile_form';
    const forms = document.querySelectorAll('form');
    if (forms.length > 0) return 'form';
    return 'generic';
  }

  /* ─────────────────────────────────────
     Validation — check form before submission
  ───────────────────────────────────── */
  function validateForm(rawScan) {
    const issues = [];
    for (const field of rawScan.fields) {
      if (!field.required) continue;
      if (field.type === 'button') continue;
      const el = field._element;
      if (!el) continue;
      const val = el.value ? el.value.trim() : '';
      if (val === '' || val === '— Select gender —' || val === '— Select department —' || val === '— Select year —') {
        issues.push({ id: field.id, label: field.label, issue: 'empty_required_field' });
      }
    }
    return { valid: issues.length === 0, issues };
  }

  /* ─────────────────────────────────────
     Confirmation Dialog (shown before submit)
  ───────────────────────────────────── */
  function showConfirmationDialog(rawScan) {
    return new Promise((resolve) => {
      // Remove any existing dialog
      const existing = document.getElementById('pba-confirm-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'pba-confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Confirm form submission');

      const filledFields = rawScan.fields.filter(f =>
        f.type !== 'button' && f._element && f._element.value && f._element.value.trim() !== ''
      );

      const rows = filledFields.map(f => {
        const val = f.sensitive ? '•••••••' : (f._element.value || '—');
        const badge = f.sensitive
          ? '<span class="pba-badge pba-badge-private">🔒 Private</span>'
          : '<span class="pba-badge pba-badge-ok">✓</span>';
        return `
          <div class="pba-row">
            <span class="pba-row-label">${escapeHtml(f.label)}</span>
            <span class="pba-row-val">${escapeHtml(val)}</span>
            ${badge}
          </div>`;
      }).join('');

      overlay.innerHTML = `
        <div class="pba-dialog">
          <div class="pba-dialog-header">
            <span class="pba-dialog-icon">📋</span>
            <h2>Form Summary</h2>
            <p>Review before submission. Private data stays on your device.</p>
          </div>
          <div class="pba-dialog-body">
            ${rows || '<p class="pba-empty">No fields detected.</p>'}
          </div>
          <div class="pba-privacy-note">
            🛡️ All private values filled locally &bull; Only sanitized context was sent to AI
          </div>
          <div class="pba-dialog-actions">
            <button id="pba-cancel-btn" class="pba-btn pba-btn-ghost">✕ Cancel</button>
            <button id="pba-submit-btn" class="pba-btn pba-btn-primary">Submit Form →</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      document.getElementById('pba-cancel-btn').onclick = () => {
        overlay.remove();
        resolve({ confirmed: false });
      };

      document.getElementById('pba-submit-btn').onclick = () => {
        overlay.remove();
        resolve({ confirmed: true });
      };
    });
  }

  /* ─────────────────────────────────────
     Message Handler (from background.js)
  ───────────────────────────────────── */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    log && log.debug('content.js received msg:', msg.type);

    switch (msg.type) {

      /* Popup / background asks for the current page scan */
      case 'SCAN_PAGE': {
        const ctx = buildPageContext();
        sendResponse({
          ok: true,
          summary: ctx.summary,
          page_type: ctx.page_type,
          title: ctx.title,
        });
        break;
      }

      /* Get DOM rects of sensitive fields for visual redaction */
      case 'GET_DOM_RECTS': {
        const scan = window.__piiDetector.scanPage();
        const domRects = [];
        scan.fields.forEach(field => {
          if (field.sensitive && field._element) {
            const rect = field._element.getBoundingClientRect();
            domRects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
        });
        sendResponse({ ok: true, domRects });
        break;
      }

      /* Execute a full action plan returned by the backend LLM */
      case 'EXECUTE_PLAN': {
        const { actions } = msg;
        if (!Array.isArray(actions) || actions.length === 0) {
          sendResponse({ ok: false, error: 'No actions provided' });
          break;
        }

        (async () => {
          try {
            // Show agent banner
            if (window.__agentBanner) window.__agentBanner.show('🤖 Agent filling form…');

            const results = await window.__actionExecutor.executePlan(actions, 700);
            const failures = results.filter(r => !r.result.success);

            log && log.info('Plan executed:', results);
            sendResponse({ ok: true, results, failures });
            if (window.__agentBanner) window.__agentBanner.hide();
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
            if (window.__agentBanner) window.__agentBanner.hide();
          }
        })();

        return true; // keep channel open for async response
      }

      /* Execute a VLM action based on CSS selectors */
      case 'EXECUTE_VLM_PLAN': {
        const { action } = msg;
        if (!action || !action.target_css_selector) {
          sendResponse({ ok: false, error: 'No valid action provided' });
          break;
        }

        (async () => {
          try {
            if (window.__agentBanner) window.__agentBanner.show('🤖 VLM Vision Agent executing…');

            const result = { action: action.action, target: action.target_css_selector, success: false };
            try {
              let element = document.querySelector(action.target_css_selector);

              // Fallback: If VLM hallucinates a selector, try finding by text content for buttons
              if (!element && action.action === 'click') {
                log && log.warn(`VLM selector not found: ${action.target_css_selector}. Trying fallback...`);
                const buttons = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"]'));
                element = buttons.find(b => b.innerText && b.innerText.toLowerCase().includes(
                  action.target_css_selector.replace(/[^a-z0-9]/gi, '').toLowerCase()
                ));
              }

              if (!element) {
                throw new Error(`Element not found: ${action.target_css_selector}`);
              }

              // Highlight before executing
              const origOutline = element.style.outline;
              element.style.outline = '3px solid #4ade80';
              await new Promise(r => setTimeout(r, 500));
              element.style.outline = origOutline;

              if (action.action === 'click') {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 200));
                element.click();
                result.success = true;
              } else if (action.action === 'fill') {
                // Resolve __PROFILE__:<key> values from local storage
                let fillValue = action.value || '';
                if (typeof fillValue === 'string' && fillValue.startsWith('__PROFILE__:')) {
                  const profileKey = fillValue.replace('__PROFILE__:', '').trim();
                  const profile = await window.__profileStore.getProfile();
                  fillValue = profile[profileKey] || '';
                  if (!fillValue) throw new Error(`Profile key "${profileKey}" is empty — please import your Word document first`);
                }
                const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
                if (setter && setter.set) setter.set.call(element, fillValue);
                else element.value = fillValue;
                element.dispatchEvent(new Event('input',  { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur',   { bubbles: true }));
                result.success = true;
              } else if (action.action === 'select') {
                // Resolve profile value if needed
                let selectValue = action.value || '';
                if (typeof selectValue === 'string' && selectValue.startsWith('__PROFILE__:')) {
                  const profileKey = selectValue.replace('__PROFILE__:', '').trim();
                  const profile = await window.__profileStore.getProfile();
                  selectValue = profile[profileKey] || '';
                }
                const selectLower = selectValue.toLowerCase();
                let matched = false;
                for (const opt of element.options) {
                  if (opt.value.toLowerCase() === selectLower ||
                      opt.text.toLowerCase().includes(selectLower) ||
                      selectLower.includes(opt.value.toLowerCase())) {
                    element.value = opt.value;
                    matched = true;
                    break;
                  }
                }
                if (!matched && element.options.length > 1) {
                  element.value = element.options[1].value; // fallback to first real option
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                result.success = true;
              } else if (action.action === 'check') {
                element.checked = true;
                element.dispatchEvent(new Event('change', { bubbles: true }));
                result.success = true;
              } else if (action.action === 'scroll') {
                window.scrollBy(0, 500);
                result.success = true;
              } else {
                log && log.warn(`Unsupported VLM action: ${action.action}`);
                result.error = `Unsupported action: ${action.action}`;
              }

            } catch (err) {
              log && log.error('VLM Action error:', err);
              result.success = false;
              result.error = err.message;
            }

            if (result.success) {
              sendResponse({ ok: true, result });
            } else {
              sendResponse({ ok: false, error: result.error });
            }
            if (window.__agentBanner) window.__agentBanner.hide();
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
            if (window.__agentBanner) window.__agentBanner.hide();
          }
        })();

        return true;
      }

      /* Validate form fields + auto-submit (agent mode — no blocking dialog) */
      case 'CONFIRM_AND_SUBMIT': {
        (async () => {
          try {
            // Submit the first form on the page directly (agent already has user consent)
            const form = document.querySelector('form');
            if (form) {
              const submitBtn = form.querySelector('[type="submit"], button[type="submit"]');
              if (submitBtn) {
                submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 400));
                submitBtn.click();
              } else {
                form.submit();
              }
              sendResponse({ ok: true, submitted: true });
            } else {
              sendResponse({ ok: false, error: 'No form found on page' });
            }
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
          }
        })();
        return true;
      }

      /* Get full page context for backend — raw PII stripped by pii-detector */
      case 'GET_PAGE_CONTEXT': {
        const ctx = buildPageContext();
        const serverSafe = {
          url:        ctx.url,
          title:      ctx.title,
          page_type:  ctx.page_type,
          fields:     ctx.fields,   // already sanitized by pii-detector
          summary:    ctx.summary,
        };
        sendResponse({ ok: true, context: serverSafe });
        break;
      }

      /* Direct Form Fill on-device + Optional Auto Submit */
      case 'DIRECT_FILL': {
        const { profile, targetKeys, autoSubmit } = msg;
        if (!profile || Object.keys(profile).length === 0) {
          sendResponse({ ok: false, error: 'No profile data provided' });
          break;
        }

        (async () => {
          try {
            if (!window.__directFiller) {
              throw new Error('Direct filler module not loaded on page');
            }

            // 1. Fill specified fields from profile
            const result = await window.__directFiller.fillForm(profile, targetKeys);

            // 2. Submit form if requested or filling all fields
            const shouldSubmit = (autoSubmit === true) || (!targetKeys && autoSubmit !== false);
            if (shouldSubmit) {
              await new Promise(r => setTimeout(r, 600));
              const form = document.querySelector('form');
              if (form) {
                const submitBtn = form.querySelector('[type="submit"], button[type="submit"], #submit-btn, .btn-primary');
                if (submitBtn) {
                  submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  await new Promise(r => setTimeout(r, 400));
                  submitBtn.click();
                } else {
                  form.submit();
                }
                result.submitted = true;
              }
            }

            sendResponse({ ok: true, ...result });
          } catch (err) {
            sendResponse({ ok: false, error: err.message });
          }
        })();

        return true; // keep async channel open
      }

      default:
        // Do not respond with an error for unknown types to let other content listeners handle them
        break;
    }
  });

  /* ─────────────────────────────────────
     Utility
  ───────────────────────────────────── */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

})();
