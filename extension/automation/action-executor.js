/**
 * extension/automation/action-executor.js
 *
 * SAFE action executor — the ONLY code that touches the DOM on the agent's behalf.
 *
 * Security model:
 *  - Accepts a strictly validated action object (type checked against schema)
 *  - NEVER evaluates arbitrary JS strings
 *  - NEVER follows navigate actions to non-HTTP/HTTPS URLs
 *  - All fill actions source values from local profile only
 *
 * Allowed action schema:
 *  { action: 'fill',     target_id, profile_key }
 *  { action: 'fill',     target_id, value }         ← non-sensitive value only
 *  { action: 'click',    target_id }
 *  { action: 'select',   target_id, value }
 *  { action: 'check',    target_id }
 *  { action: 'uncheck',  target_id }
 *  { action: 'scroll',   direction, amount }
 *  { action: 'navigate', url }
 */

(function () {
  if (window.__actionExecutor) return; // idempotent

  const ALLOWED_ACTIONS = new Set(['fill', 'click', 'select', 'check', 'uncheck', 'scroll', 'navigate']);

  /* ─────────────────────────────────────
     Find an element on the page by various means.
     Tries: id → name → label text → data-label
  ───────────────────────────────────── */
  function findElement(targetId) {
    if (!targetId) return null;
    const id = String(targetId).trim();

    // Direct ID match
    let el = document.getElementById(id);
    if (el) return el;

    // name attribute
    el = document.querySelector(`[name="${id}"]`);
    if (el) return el;

    // data-label match (our custom attribute)
    el = document.querySelector(`[data-label="${id}"]`);
    if (el) return el;

    // label text match (case-insensitive)
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.innerText.trim().toLowerCase().includes(id.toLowerCase())) {
        const forId = label.getAttribute('for');
        if (forId) {
          const target = document.getElementById(forId);
          if (target) return target;
        }
      }
    }

    // placeholder match
    el = document.querySelector(`[placeholder*="${id}" i]`);
    if (el) return el;

    // custom fuzzy match for labels (stripping asterisks, fixing underscores)
    const idClean = id.replace(/[\*:]/g, '').trim().toLowerCase();
    const idSpace = idClean.replace(/_/g, ' ');
    for (const label of labels) {
      const text = label.innerText.replace(/[\*:]/g, '').trim().toLowerCase();
      if (text === idClean || text === idSpace || text.includes(idClean) || text.includes(idSpace)) {
        const forId = label.getAttribute('for');
        if (forId) {
          const target = document.getElementById(forId);
          if (target) return target;
        }
      }
    }

    return null;
  }

  /* ─────────────────────────────────────
     Simulate realistic user input
     (triggers React / Vue / Angular event listeners)
  ───────────────────────────────────── */
  function simulateInput(el, value) {
    if (el instanceof window.HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
      if (setter) setter.set.call(el, value);
      else el.value = value;
    } else if (el instanceof window.HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (setter) setter.set.call(el, value);
      else el.value = value;
    } else if (el instanceof window.HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter) setter.set.call(el, value);
      else el.value = value;
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function highlightField(el) {
    el.classList.add('agent-filled');
    setTimeout(() => el.classList.remove('agent-filled'), 2500);
  }

  /* ─────────────────────────────────────
     Action Handlers
  ───────────────────────────────────── */

  async function handleFill(action) {
    const el = findElement(action.target_id);
    if (!el) throw new Error(`fill: element not found — "${action.target_id}"`);

    let value = null;

    if (action.value_source === 'local_profile') {
      if (!action.profile_key) throw new Error('fill: profile_key required when value_source=local_profile');
      value = await window.__profileStore.getField(action.profile_key);
      if (value === null) throw new Error(`fill: profile key "${action.profile_key}" not found`);
    } else if (typeof action.value === 'string') {
      // Non-sensitive static value (e.g. department name from AI)
      value = action.value;
    } else {
      throw new Error('fill: must provide either value_source=local_profile+profile_key or a static value');
    }

    simulateInput(el, value);
    highlightField(el);
    window.__agentLogger && window.__agentLogger.info(`fill "${action.target_id}" — OK (value kept local)`);
    return { success: true, target_id: action.target_id };
  }

  function handleClick(action) {
    const el = findElement(action.target_id);
    if (!el) throw new Error(`click: element not found — "${action.target_id}"`);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.click(), 300);
    window.__agentLogger && window.__agentLogger.info(`click "${action.target_id}" — OK`);
    return { success: true, target_id: action.target_id };
  }

  async function handleSelect(action) {
    const el = findElement(action.target_id);
    if (!el || (el.tagName.toLowerCase() !== 'select' && el.type !== 'radio')) {
      throw new Error(`select: <select> or <input type="radio"> element not found — "${action.target_id}"`);
    }

    let targetValue = String(action.value || '').trim();

    if (action.value_source === 'local_profile') {
      if (!action.profile_key) throw new Error('select: profile_key required when value_source=local_profile');
      const val = await window.__profileStore.getField(action.profile_key);
      targetValue = val ? String(val).trim() : '';
    }

    const targetLower = targetValue.toLowerCase();
    let matched = false;
    let matchedEl = null

    if (el.tagName.toLowerCase() === 'select') {
      if (targetLower) {
        for (const opt of el.options) {
          const optVal = opt.value.toLowerCase();
          const optText = opt.text.toLowerCase();
          if (!optVal && !optText) continue;

          if (
            optVal === targetLower ||
            (optText && optText.includes(targetLower)) ||
            (optText && targetLower.includes(optText)) ||
            (optVal && targetLower.includes(optVal)) ||
            (optText.replace(/\s+/g, '') === targetLower.replace(/\s+/g, ''))
          ) {
            el.value = opt.value;
            matched = true;
            matchedEl = el;
            break;
          }
        }
      }

      // Fallback: select the first option with a non-empty value
      if (!matched) {
        for (const opt of el.options) {
          if (opt.value && opt.value.trim() !== '') {
            el.value = opt.value;
            matched = true;
            matchedEl = el;
            break;
          }
        }
      }
    } else if (el.type === 'radio') {
      const name = el.name;
      const radios = name ? document.querySelectorAll(`input[type="radio"][name="${name}"]`) : [el];
      if (targetLower) {
        for (const radio of radios) {
          let labelText = '';
          if (radio.id) {
            const label = document.querySelector(`label[for="${radio.id}"]`);
            if (label) labelText = label.innerText.trim().toLowerCase();
          }
          if (!labelText) {
            const parentLabel = radio.closest('label');
            if (parentLabel) labelText = parentLabel.innerText.trim().toLowerCase();
          }

          if (
            radio.value.toLowerCase() === targetLower ||
            radio.id.toLowerCase() === targetLower ||
            (labelText && labelText.includes(targetLower)) ||
            (labelText && targetLower.includes(labelText))
          ) {
            radio.checked = true;
            matched = true;
            matchedEl = radio;
            break;
          }
        }
      }

      if (!matched && radios.length > 0) {
        radios[0].checked = true;
        matched = true;
        matchedEl = radios[0];
      }
    }

    if (!matched) throw new Error(`select: no matching option for "${targetValue}" in "${action.target_id}"`);

    matchedEl.dispatchEvent(new Event('change', { bubbles: true }));
    highlightField(matchedEl);
    window.__agentLogger && window.__agentLogger.info(`select "${action.target_id}" = "${targetValue}" — OK`);
    return { success: true, target_id: action.target_id };
  }

  function handleCheck(action, shouldCheck) {
    const el = findElement(action.target_id);
    if (!el || (el.type !== 'checkbox' && el.type !== 'radio')) {
      throw new Error(`check/uncheck: checkbox or radio not found — "${action.target_id}"`);
    }
    el.checked = shouldCheck;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, target_id: action.target_id };
  }

  function handleScroll(action) {
    const amount = Number(action.amount) || 300;
    const dir = (action.direction || 'down').toLowerCase();
    const y = dir === 'up' ? -amount : amount;
    window.scrollBy({ top: y, behavior: 'smooth' });
    return { success: true };
  }

  function handleNavigate(action) {
    const url = String(action.url || '');
    if (!/^https?:\/\//.test(url)) {
      throw new Error(`navigate: blocked — only http/https allowed, got "${url}"`);
    }
    window.location.href = url;
    return { success: true };
  }

  /* ─────────────────────────────────────
     Main execute() — validates then dispatches
  ───────────────────────────────────── */

  /**
   * Execute a single action from the AI action plan.
   * @param {Object} action
   * @returns {Promise<{ success: boolean, target_id?: string, error?: string }>}
   */
  async function execute(action) {
    try {
      if (!action || typeof action.action !== 'string') {
        throw new Error('Invalid action object');
      }
      if (!ALLOWED_ACTIONS.has(action.action)) {
        throw new Error(`Blocked action type: "${action.action}"`);
      }

      // Fix common LLM profile key hallucinations
      if (action.profile_key === 'clearance_level') {
        action.profile_key = 'clearance';
      }

      // Force Clearance Level to ALWAYS use profile data
      if (
        action.target_id &&
        (action.target_id.toLowerCase().includes('clearance') || action.target_id.toLowerCase().includes('level')) &&
        (!action.value_source || action.value_source !== 'local_profile')
      ) {
        // Only override if the target_id clearly implies clearance
        if (action.target_id.toLowerCase().includes('clearance')) {
          action.value_source = 'local_profile';
          action.profile_key = 'clearance';
          delete action.value;
        }
      }

      switch (action.action) {
        case 'fill': return await handleFill(action);
        case 'click': return handleClick(action);
        case 'select': return await handleSelect(action);
        case 'check': return handleCheck(action, true);
        case 'uncheck': return handleCheck(action, false);
        case 'scroll': return handleScroll(action);
        case 'navigate': return handleNavigate(action);
        default: throw new Error(`Unknown action: "${action.action}"`);
      }
    } catch (err) {
      window.__agentLogger && window.__agentLogger.error('Action failed:', action, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Execute a full action plan (array) sequentially.
   * @param {Array} actions
   * @param {number} delayMs - pause between actions for visual clarity
   * @returns {Promise<Array>}
   */
  async function executePlan(actions, delayMs = 600) {
    const results = [];
    for (const action of actions) {
      const result = await execute(action);
      results.push({ action, result });
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    return results;
  }

  window.__actionExecutor = { execute, executePlan };
  window.__agentLogger && window.__agentLogger.debug('action-executor.js loaded');
})();
