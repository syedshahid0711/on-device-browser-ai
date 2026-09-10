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

      /* Validate form fields + show confirmation dialog, then submit */
      case 'CONFIRM_AND_SUBMIT': {
        (async () => {
          try {
            const ctx = buildPageContext();
            const rawScan = ctx._raw_scan;

            const validation = validateForm(rawScan);
            if (!validation.valid) {
              sendResponse({ ok: false, validation_failed: true, issues: validation.issues });
              return;
            }

            const { confirmed } = await showConfirmationDialog(rawScan);
            if (!confirmed) {
              sendResponse({ ok: false, cancelled: true });
              return;
            }

            // Submit the first form on the page
            const form = document.querySelector('form');
            if (form) {
              const submitBtn = form.querySelector('[type="submit"]');
              if (submitBtn) {
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

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
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
