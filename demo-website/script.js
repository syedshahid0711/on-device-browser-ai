/**
 * demo-website/script.js
 * Interactive behaviour for the Student Registration Portal.
 * – Progress bar tracking
 * – Password strength meter
 * – File drop-zone
 * – Form validation
 * – Success overlay
 *
 * This file has NO agent logic — the agent operates via the extension.
 */

(function () {
  'use strict';

  /* ── DOM refs ── */
  const form          = document.getElementById('registration-form');
  const progressBar   = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const passwordInput = document.getElementById('password');
  const confirmInput  = document.getElementById('confirm_password');
  const strengthFill  = document.getElementById('strength-fill');
  const strengthLabel = document.getElementById('strength-label');
  const dropZone      = document.getElementById('drop-zone');
  const dropContent   = document.getElementById('drop-zone-content');
  const successOverlay = document.getElementById('success-overlay');
  const refId         = document.getElementById('ref-id');

  /* ── Required fields for progress tracking ── */
  const requiredFields = form.querySelectorAll('[required]');

  /* ─────────────────────────────────────────
     PROGRESS BAR
  ───────────────────────────────────────── */
  function updateProgress() {
    let filled = 0;
    requiredFields.forEach(field => {
      const val = field.value.trim();
      if (field.type === 'checkbox') {
        if (field.checked) filled++;
      } else if (val !== '' && val !== '— Select gender —' && val !== '— Select department —' && val !== '— Select year —') {
        filled++;
      }
    });
    const pct = Math.round((filled / requiredFields.length) * 100);
    progressBar.style.width = pct + '%';
    progressLabel.textContent = pct + '% complete';
  }

  requiredFields.forEach(field => {
    field.addEventListener('input', updateProgress);
    field.addEventListener('change', updateProgress);
  });

  /* ─────────────────────────────────────────
     PASSWORD STRENGTH
  ───────────────────────────────────────── */
  function checkStrength(pw) {
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score; // 0–5
  }

  passwordInput.addEventListener('input', () => {
    const pw = passwordInput.value;
    const score = checkStrength(pw);
    const pct = pw.length === 0 ? 0 : Math.max(10, score * 20);
    strengthFill.style.width = pct + '%';

    const levels = [
      { color: 'transparent', text: '' },
      { color: '#ef4444',     text: 'Very weak' },
      { color: '#f97316',     text: 'Weak' },
      { color: '#f59e0b',     text: 'Fair' },
      { color: '#22c55e',     text: 'Strong' },
      { color: '#10b981',     text: 'Very strong ✓' },
    ];
    const lvl = levels[Math.min(score, 5)];
    strengthFill.style.background = lvl.color;
    strengthLabel.textContent = lvl.text;
  });

  /* ─────────────────────────────────────────
     TOGGLE PASSWORD VISIBILITY
  ───────────────────────────────────────── */
  window.togglePwd = function (inputId, btnId) {
    const inp = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (inp.type === 'password') {
      inp.type = 'text';
      btn.textContent = '🙈';
    } else {
      inp.type = 'password';
      btn.textContent = '👁';
    }
  };

  /* ─────────────────────────────────────────
     FILE DROP ZONE
  ───────────────────────────────────────── */
  ['dragenter', 'dragover'].forEach(evt =>
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'))
  );

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) showSelectedFile(file.name);
  });

  document.getElementById('document').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) showSelectedFile(file.name);
  });

  function showSelectedFile(name) {
    dropContent.innerHTML = `
      <span class="drop-icon">📄</span>
      <p><strong>${escapeHtml(name)}</strong></p>
      <p class="field-hint">File selected ✓</p>
    `;
    dropZone.style.borderColor = 'var(--clr-success)';
  }

  /* ─────────────────────────────────────────
     REAL-TIME FIELD VALIDATION
  ───────────────────────────────────────── */
  form.querySelectorAll('input, select').forEach(field => {
    field.addEventListener('blur', () => validateField(field));
  });

  function validateField(field) {
    const val = field.value.trim();
    field.classList.remove('field-valid', 'field-invalid');
    if (field.type === 'checkbox' || !field.required) return;
    if (val === '' || val.startsWith('—')) {
      field.classList.add('field-invalid');
      return false;
    }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      field.classList.add('field-invalid');
      return false;
    }
    field.classList.add('field-valid');
    return true;
  }

  /* ─────────────────────────────────────────
     FORM SUBMISSION
  ───────────────────────────────────────── */
  form.addEventListener('submit', e => {
    e.preventDefault();
    let valid = true;

    requiredFields.forEach(field => {
      if (field.type === 'checkbox') {
        if (!field.checked) { valid = false; field.classList.add('field-invalid'); }
        return;
      }
      if (!validateField(field)) valid = false;
    });

    if (!confirmInput.value || confirmInput.value !== passwordInput.value) {
      confirmInput.classList.add('field-invalid');
      valid = false;
    }

    if (!valid) {
      const firstInvalid = form.querySelector('.field-invalid');
      if (firstInvalid) firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    submitForm();
  });

  function submitForm() {
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    // Simulate network delay
    setTimeout(() => {
      const id = 'REG-' + Date.now().toString(36).toUpperCase();
      refId.textContent = id;
      successOverlay.hidden = false;
      successOverlay.removeAttribute('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Registration →';
    }, 800);
  }

  /* ─────────────────────────────────────────
     RESET
  ───────────────────────────────────────── */
  window.resetAll = function () {
    successOverlay.hidden = true;
    form.reset();
    progressBar.style.width = '0%';
    progressLabel.textContent = '0% complete';
    strengthFill.style.width = '0%';
    strengthLabel.textContent = '';
    dropContent.innerHTML = `
      <span class="drop-icon">📄</span>
      <p><strong>Drag &amp; drop</strong> or <span class="browse-link">browse</span></p>
      <p class="field-hint">PDF, JPG, PNG &bull; Max 5 MB</p>
    `;
    dropZone.style.borderColor = '';
    form.querySelectorAll('.field-valid, .field-invalid').forEach(el => {
      el.classList.remove('field-valid', 'field-invalid');
    });
  };

  /* ─────────────────────────────────────────
     SCROLL REVEAL ANIMATION
  ───────────────────────────────────────── */
  const observerOptions = {
    root: null,
    rootMargin: '50px', // trigger 50px before it even enters viewport
    threshold: 0.01     // trigger immediately
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        // Optional: stop observing once revealed
        // observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.reveal').forEach(el => {
    observer.observe(el);
  });

  /* ─────────────────────────────────────────
     UTILITY
  ───────────────────────────────────────── */
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ─────────────────────────────────────────
     AGENT BANNER API
     Called by the Chrome extension to show status
  ───────────────────────────────────────── */
  window.__agentBanner = {
    show(msg) {
      let banner = document.getElementById('agent-status-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'agent-status-banner';
        banner.style.cssText = [
          'position:fixed','bottom:20px','right:20px',
          'background:rgba(99,102,241,0.95)','color:white',
          'border-radius:10px','padding:12px 18px',
          'font-family:Inter,sans-serif','font-size:0.82rem','font-weight:600',
          'box-shadow:0 4px 20px rgba(0,0,0,0.5)','z-index:9999',
          'display:flex','align-items:center','gap:10px','max-width:280px'
        ].join(';');
        document.body.appendChild(banner);
      }
      banner.innerHTML = `<span>🤖</span><span>${escapeHtml(msg)}</span>`;
      banner.style.display = 'flex';
    },
    hide() {
      const banner = document.getElementById('agent-status-banner');
      if (banner) banner.style.display = 'none';
    }
  };

})();
