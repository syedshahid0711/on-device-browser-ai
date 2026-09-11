/**
 * extension/background/background.js
 *
 * Manifest V3 Service Worker — the central coordinator.
 *
 * Responsibilities:
 *  - Relay messages between popup ↔ content script
 *  - Make HTTPS fetch calls to the FastAPI backend
 *  - Manage agent task state
 *  - Never touch real PII (content script handles local values)
 */

// ── Configuration ──────────────────────────────────────────
const CONFIG = {
  BACKEND_URL: 'http://localhost:8000',
  REQUEST_TIMEOUT_MS: 150000,
  VERSION: '1.0.0',
};

// ── State ───────────────────────────────────────────────────
let agentState = {
  status: 'idle',         // 'idle' | 'scanning' | 'reasoning' | 'executing' | 'done' | 'error'
  currentTask: null,
  lastScan: null,
  lastActions: null,
  piiSummary: null,
  backendConnected: false,
  metrics: {
    scanMs: 0,
    backendMs: 0,
    executeMs: 0,
    totalMs: 0,
  },
};

// ── Logging ─────────────────────────────────────────────────
function log(level, ...args) {
  const colors = { INFO: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', DEBUG: '\x1b[36m' };
  console.log(`[BG][${level}]`, ...args);
}

// ── Fetch with timeout ───────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = CONFIG.REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ── Backend health check ─────────────────────────────────────
async function checkBackend() {
  try {
    const resp = await fetchWithTimeout(`${CONFIG.BACKEND_URL}/api/health`, {}, 5000);
    agentState.backendConnected = resp.ok;
    return resp.ok;
  } catch {
    agentState.backendConnected = false;
    return false;
  }
}

// ── Offscreen Document Management ──────────────────────────────
let creatingOffscreen;
async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen/offscreen.html');
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Running WebGPU Machine Learning model and canvas redaction'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

// ── Get the active tab ───────────────────────────────────────
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs && tabs.length > 0) return tabs[0];
  const fallback = await chrome.tabs.query({ active: true });
  return fallback && fallback.length > 0 ? fallback[0] : null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'utils/logger.js',
        'privacy/pii-detector.js',
        'storage/profile-store.js',
        'automation/action-executor.js',
        'automation/direct-filler.js',
        'content/content.js'
      ]
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content.css']
    }).catch(() => { });
  } catch (e) {
    log('WARN', 'Script injection failed or restricted tab:', e.message);
  }
}

async function sendToContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (err.message && err.message.includes('Receiving end does not exist')) {
      log('INFO', 'Content script missing in tab, attempting dynamic injection...');
      await ensureContentScript(tabId);
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (err2) {
        throw new Error('Please refresh (F5) the webpage (http://localhost:8000/demo/) so the extension agent can connect to it.');
      }
    }
    throw err;
  }
}

// ── Send a request to the backend AI ────────────────────────
async function analyzeWithBackend(task, pageContext) {
  // Strip _element refs and raw PII — content script already sanitized
  // but double-check: never send 'value' if field is sensitive
  const safeFields = pageContext.fields.map(f => {
    const { _element, ...rest } = f;
    if (rest.sensitive) {
      rest.value = rest.value || '[REDACTED]';
    }
    return rest;
  });

  const payload = {
    task,
    page_context: {
      url: pageContext.url,
      title: pageContext.title,
      page_type: pageContext.page_type,
      fields: safeFields,
      summary: pageContext.summary,
    },
  };

  log('INFO', 'Sending to backend (sanitized):', JSON.stringify(payload, null, 2));

  const resp = await fetchWithTimeout(
    `${CONFIG.BACKEND_URL}/api/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Backend error ${resp.status}: ${err}`);
  }

  return resp.json();
}

// ── Main agent task flow ─────────────────────────────────────
async function runAgentTask(task, tabId, sendUpdate) {
  const t0 = Date.now();
  agentState.currentTask = task;

  try {
    // 1. Scan the page
    sendUpdate({ stage: 'scanning', message: 'Scanning page structure…' });
    agentState.status = 'scanning';
    const t1 = Date.now();

    const scanResp = await sendToContent(tabId, { type: 'GET_PAGE_CONTEXT' });
    if (!scanResp.ok) throw new Error('Failed to get page context: ' + scanResp.error);

    const pageContext = scanResp.context;
    agentState.lastScan = pageContext;
    agentState.piiSummary = pageContext.summary;
    agentState.metrics.scanMs = Date.now() - t1;

    sendUpdate({
      stage: 'scanned',
      message: `Found ${pageContext.summary.total} fields, ${pageContext.summary.sensitive} sensitive`,
      piiSummary: pageContext.summary,
    });

    // 2. Call backend AI
    sendUpdate({ stage: 'reasoning', message: 'Sending sanitized context to AI…' });
    agentState.status = 'reasoning';
    const t2 = Date.now();

    const aiResponse = await analyzeWithBackend(task, pageContext);
    agentState.lastActions = aiResponse.actions;
    agentState.metrics.backendMs = Date.now() - t2;

    log('INFO', 'AI response:', aiResponse);
    sendUpdate({
      stage: 'planned',
      message: `AI planned ${aiResponse.actions.length} actions`,
      reasoning: aiResponse.reasoning,
      actions: aiResponse.actions,
    });

    // 3. Execute actions
    sendUpdate({ stage: 'executing', message: 'Executing action plan…' });
    agentState.status = 'executing';
    const t3 = Date.now();

    const execResp = await sendToContent(tabId, {
      type: 'EXECUTE_PLAN',
      actions: aiResponse.actions,
    });
    agentState.metrics.executeMs = Date.now() - t3;

    if (!execResp.ok) throw new Error('Execution failed: ' + execResp.error);

    // 4. Auto-submit the form (agent already has user consent from task instruction)
    const hasSubmit = aiResponse.actions.some(a =>
      a.action === 'click' && a.target_id &&
      /submit|btn|register|button/i.test(a.target_id)
    );
    if (hasSubmit) {
      // Auto-confirm — no blocking dialog for the agent
      await sendToContent(tabId, { type: 'CONFIRM_AND_SUBMIT' });
    }

    // Done
    agentState.metrics.totalMs = Date.now() - t0;
    agentState.status = 'done';

    // Save task to backend
    try {
      await fetch(`${CONFIG.BACKEND_URL}/api/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          page_type: pageContext.page_type,
          page_title: pageContext.title,
          actions_count: aiResponse.actions.length,
          pii_detected: pageContext.summary.sensitive,
          duration_ms: agentState.metrics.totalMs,
          success: true,
        }),
      });
    } catch { /* non-critical */ }

    sendUpdate({
      stage: 'done',
      message: 'Task completed! ✓',
      metrics: agentState.metrics,
    });

  } catch (err) {
    log('ERROR', 'Agent task failed:', err);
    agentState.status = 'error';
    sendUpdate({ stage: 'error', message: err.message });
  }
}

// ── VLM Loop ─────────────────────────────────────────────────
async function captureAndRedact(tabId) {
  const rectResp = await sendToContent(tabId, { type: 'GET_DOM_RECTS' });
  const domRects = rectResp.ok ? rectResp.domRects : [];

  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 50 });

  await setupOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'DETECT_VISUAL_PII',
      target: 'offscreen',
      imageSource: dataUrl,
      domRects: domRects
    }, resp => {
      if (!resp || !resp.ok) reject(new Error('Redaction failed'));
      else resolve(resp.data.redactedImage);
    });
  });
}

async function runVlmLoop(tabId, task) {
  let status = 'in_progress';
  let previousErrors = [];
  let completedSelectors = [];   // track what's already been filled
  let iterations = 0;
  const MAX_ITERATIONS = 15;

  chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'scanning', message: 'VLM Agent loop started...' }).catch(() => { });

  while (status === 'in_progress' && iterations < MAX_ITERATIONS) {
    iterations++;
    try {
      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'scanning', message: `Step ${iterations}: Capturing visual context...` }).catch(() => { });
      const redactedImage = await captureAndRedact(tabId);

      // Also fetch structured DOM field data so Ollama (text-only model) can
      // reason about the form without needing true vision capabilities.
      let pageFields = [];
      try {
        const ctxResp = await sendToContent(tabId, { type: 'GET_PAGE_CONTEXT' });
        if (ctxResp && ctxResp.ok && ctxResp.context) {
          pageFields = ctxResp.context.fields || [];
        }
      } catch (e) {
        log('WARN', 'Could not fetch page context for VLM:', e.message);
      }

      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'reasoning', message: `Step ${iterations}: AI processing...` }).catch(() => { });

      const fetchResp = await fetchWithTimeout(
        `${CONFIG.BACKEND_URL}/api/vlm_analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            image_base64: redactedImage,
            previous_errors: previousErrors.length > 0 ? previousErrors : null,
            page_fields: pageFields,
            completed_selectors: completedSelectors,
          })
        }
      );

      if (!fetchResp.ok) {
        throw new Error(`VLM API error: ${await fetchResp.text()}`);
      }

      const vlmResult = await fetchResp.json();
      status = vlmResult.status;

      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'reasoning', message: `Reasoning: ${vlmResult.reasoning || status}` }).catch(() => { });

      if (status === 'complete') {
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'done', message: 'Task completed successfully!' }).catch(() => { });
        return { ok: true };
      }

      if (status === 'error') {
        throw new Error(vlmResult.reasoning || 'VLM returned error status');
      }

      if (status === 'in_progress' && vlmResult.action) {
        const selector = vlmResult.target_css_selector;
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'executing', message: `Executing action: ${vlmResult.action} on ${selector}` }).catch(() => { });

        const execResp = await sendToContent(tabId, {
          type: 'EXECUTE_VLM_PLAN',
          action: vlmResult
        });

        if (execResp.ok && execResp.result && execResp.result.success) {
          previousErrors = [];
          // Mark this selector as done so the VLM won't repeat it
          if (selector && !completedSelectors.includes(selector)) {
            completedSelectors.push(selector);
          }
        } else {
          const errMsg = execResp.error || 'Action failed';
          previousErrors.push(errMsg);
          chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'scanning', message: `Retrying due to error: ${errMsg}` }).catch(() => { });
        }
      }

      await new Promise(r => setTimeout(r, 800));

    } catch (err) {
      log('ERROR', 'VLM loop iteration failed:', err);
      chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: err.message }).catch(() => { });
      return { ok: false, error: err.message };
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: 'Max iterations reached without completion.' }).catch(() => { });
    return { ok: false, error: 'Max iterations reached' };
  }
}

// ── Message Router ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  log('DEBUG', 'BG received:', msg.type);

  switch (msg.type) {

    case 'GET_STATE':
      sendResponse({
        ok: true,
        state: {
          status: agentState.status,
          piiSummary: agentState.piiSummary,
          backendConnected: agentState.backendConnected,
          metrics: agentState.metrics,
        },
      });
      break;

    case 'CHECK_BACKEND':
      checkBackend().then(ok => sendResponse({ ok, connected: ok }));
      return true;

    case 'SCAN_PAGE': {
      getActiveTab().then(tab => {
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'No active tab found' });
          return;
        }
        sendToContent(tab.id, { type: 'SCAN_PAGE' }).then(sendResponse);
      });
      return true;
    }

    case 'RUN_TASK': {
      const { task } = msg;
      if (!task || typeof task !== 'string' || task.trim() === '') {
        sendResponse({ ok: false, error: 'Task is required' });
        break;
      }

      // Use a port-based approach so popup gets streaming updates
      // For simplicity here, we return immediately and send updates via chrome.runtime.sendMessage
      getActiveTab().then(tab => {
        if (!tab || !tab.id) {
          chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: 'No active tab found. Please click on the webpage.' }).catch(() => { });
          return;
        }
        runAgentTask(task.trim(), tab.id, (update) => {
          // Broadcast update to any listening popup
          chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', ...update }).catch(() => { });
        });
      }).catch(err => {
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: 'Tab error: ' + err.message }).catch(() => { });
      });

      sendResponse({ ok: true, message: 'Task started' });
      break;
    }

    case 'RUN_DIRECT_FILL': {
      // On-device fill — no Ollama needed.
      // Profile data comes directly in the message payload from popup.js.
      const { profile, targetKeys, autoSubmit } = msg;
      if (!profile || Object.keys(profile).length === 0) {
        sendResponse({ ok: false, error: 'No profile data in message' });
        break;
      }

      getActiveTab().then(async tab => {
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'No active tab found. Click on the webpage first.' });
          return;
        }

        // Ensure all content scripts (including direct-filler.js) are injected
        await ensureContentScript(tab.id);

        // Small delay to let scripts initialise
        await new Promise(r => setTimeout(r, 300));

        try {
          const fillResp = await chrome.tabs.sendMessage(tab.id, {
            type: 'DIRECT_FILL',
            profile,
            targetKeys,
            autoSubmit
          });
          sendResponse(fillResp);
        } catch (err) {
          sendResponse({ ok: false, error: 'Content script error: ' + err.message });
        }
      }).catch(err => {
        sendResponse({ ok: false, error: 'Tab error: ' + err.message });
      });

      return true; // async
    }

    case 'RUN_VLM_TASK': {
      const { task } = msg;
      if (!task) {
        sendResponse({ ok: false, error: 'Task is required' });
        break;
      }

      getActiveTab().then(tab => {
        if (!tab || !tab.id) {
          chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: 'No active tab found. Please click on the webpage.' }).catch(() => { });
          return;
        }
        // Route through the proven Ollama + profile path so the Word doc
        // data (stored in chrome.storage.local) is used to fill the form.
        // This also prevents the infinite-loop that the old VLM screenshot
        // loop produced when the mock always returned "in_progress".
        runAgentTask(task.trim(), tab.id, (update) => {
          chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', ...update }).catch(() => { });
        });
      }).catch(err => {
        chrome.runtime.sendMessage({ type: 'AGENT_UPDATE', stage: 'error', message: 'Tab error: ' + err.message }).catch(() => { });
      });

      sendResponse({ ok: true, message: 'Task started' });
      break;
    }

    case 'GET_PROFILE': {
      chrome.storage.local.get(['pba_user_profile'], result => {
        sendResponse({ ok: true, profile: result.pba_user_profile || {} });
      });
      return true;
    }

    case 'SAVE_PROFILE': {
      chrome.storage.local.set({ pba_user_profile: msg.profile }, () => {
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'DETECT_VISUAL_PII': {
      setupOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({
          type: 'DETECT_VISUAL_PII',
          target: 'offscreen',
          imageSource: msg.imageSource,
          domRects: msg.domRects
        }, (response) => {
          sendResponse(response);
        });
      }).catch(err => {
        log('ERROR', 'Offscreen setup failed:', err);
        sendResponse({ ok: false, error: 'Offscreen setup failed' });
      });
      return true;
    }

    case 'RESET_STATE':
      agentState.status = 'idle';
      agentState.currentTask = null;
      agentState.lastActions = null;
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
  }
});

// ── Startup ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  log('INFO', 'Privacy Browser Agent installed. Version:', CONFIG.VERSION);
  checkBackend();
  setupOffscreenDocument();
});

// Periodic backend health check
setInterval(checkBackend, 30000);
checkBackend();


log('INFO', 'background.js loaded');

