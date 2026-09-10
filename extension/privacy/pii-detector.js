/**
 * extension/privacy/pii-detector.js
 *
 * LOCAL Privacy Engine — runs entirely on-device.
 *
 * Detects PII in form elements using:
 *  1. DOM attributes (type, name, id, autocomplete)
 *  2. Associated labels and ARIA attributes
 *  3. Placeholder text patterns
 *  4. Regular-expression value patterns
 *
 * Architecture is modular — a future visual-AI layer can augment
 * these results by calling augmentWithVisualContext().
 *
 * Usage:
 *   const result = window.__piiDetector.analyze(inputElement);
 *   // → { isSensitive: true, category: 'email', confidence: 0.98, reason: '...' }
 *
 *   const pageResults = window.__piiDetector.scanPage();
 *   // → { fields: [...], summary: { total, sensitive, categories } }
 */

(function () {
  if (window.__piiDetector) return; // idempotent

  /* ─────────────────────────────────────
     PII Category Definitions
     Each category has:
       - keywords: matched against field name/id/label (case-insensitive)
       - inputTypes: matched against input type attribute
       - autocompleteValues: matched against autocomplete attribute
       - valuePattern: RegExp matched against live field value
       - confidence: base confidence when matched
  ───────────────────────────────────── */
  const PII_CATEGORIES = [
    {
      category: 'password',
      sensitive: true,
      inputTypes: ['password'],
      keywords: ['password', 'passwd', 'pwd', 'secret', 'pin'],
      autocompleteValues: ['current-password', 'new-password'],
      valuePattern: null,
      confidence: 1.0,
    },
    {
      category: 'email',
      sensitive: true,
      inputTypes: ['email'],
      keywords: ['email', 'e-mail', 'mail'],
      autocompleteValues: ['email'],
      valuePattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      confidence: 0.97,
    },
    {
      category: 'phone',
      sensitive: true,
      inputTypes: ['tel'],
      keywords: ['phone', 'mobile', 'cell', 'telephone', 'contact', 'whatsapp'],
      autocompleteValues: ['tel', 'tel-national'],
      valuePattern: /^[\+\d][\d\s\-\(\)]{7,14}$/,
      confidence: 0.92,
    },
    {
      category: 'name',
      sensitive: true,
      inputTypes: ['text'],
      keywords: ['name', 'fullname', 'full_name', 'firstname', 'lastname', 'surname', 'given'],
      autocompleteValues: ['name', 'given-name', 'family-name', 'additional-name'],
      valuePattern: /^[A-Za-z\s''\-]{2,50}$/,
      confidence: 0.85,
    },
    {
      category: 'dob',
      sensitive: true,
      inputTypes: ['date'],
      keywords: ['dob', 'birth', 'birthday', 'born', 'dateofbirth', 'date_of_birth'],
      autocompleteValues: ['bday', 'bday-day', 'bday-month', 'bday-year'],
      valuePattern: /^\d{4}-\d{2}-\d{2}$/,
      confidence: 0.95,
    },
    {
      category: 'address',
      sensitive: true,
      inputTypes: ['text'],
      keywords: ['address', 'addr', 'street', 'city', 'state', 'pincode', 'zip', 'location', 'residence'],
      autocompleteValues: ['street-address', 'address-line1', 'address-line2', 'postal-code'],
      valuePattern: null,
      confidence: 0.82,
    },
    {
      category: 'student_id',
      sensitive: true,
      inputTypes: ['text'],
      keywords: ['student_id', 'studentid', 'enrollment', 'roll', 'roll_no', 'registration', 'reg_no', 'stu'],
      autocompleteValues: [],
      valuePattern: /^[A-Z]{0,5}\d{4,10}$/i,
      confidence: 0.88,
    },
    {
      category: 'national_id',
      sensitive: true,
      inputTypes: ['text', 'number'],
      keywords: ['aadhaar', 'aadhar', 'pan', 'passport', 'driving', 'voter', 'ssn', 'national_id', 'id_number'],
      autocompleteValues: [],
      valuePattern: /^\d{12}$|^[A-Z]{5}\d{4}[A-Z]$/,
      confidence: 0.93,
    },
    {
      category: 'credit_card',
      sensitive: true,
      inputTypes: ['text', 'number', 'tel'],
      keywords: ['card', 'credit', 'debit', 'cvv', 'expiry'],
      autocompleteValues: ['cc-number', 'cc-exp', 'cc-csc'],
      valuePattern: /^\d{13,19}$/,
      confidence: 0.96,
    },
  ];

  /* ─────────────────────────────────────
     Helpers
  ───────────────────────────────────── */

  /** Get all text associated with a form element (label, aria, placeholder) */
  function getFieldLabel(el) {
    const parts = [];

    // <label for="id">
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) parts.push(label.innerText.toLowerCase());
    }

    // Wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel) parts.push(parentLabel.innerText.toLowerCase());

    // aria-label / aria-labelledby
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label').toLowerCase());
    if (el.getAttribute('aria-labelledby')) {
      const ref = document.getElementById(el.getAttribute('aria-labelledby'));
      if (ref) parts.push(ref.innerText.toLowerCase());
    }

    // placeholder, name, id
    if (el.placeholder) parts.push(el.placeholder.toLowerCase());
    if (el.name)        parts.push(el.name.toLowerCase());
    if (el.id)          parts.push(el.id.toLowerCase());

    // data-label (our custom demo attribute)
    if (el.dataset.label) parts.push(el.dataset.label.toLowerCase());

    // data-pii (our explicit hint)
    if (el.dataset.pii)   parts.push(el.dataset.pii.toLowerCase());

    return parts.join(' ');
  }

  /** Score an element against a single PII category */
  function scoreCategory(el, category) {
    const labelText = getFieldLabel(el);
    const inputType = (el.type || '').toLowerCase();
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const value = (el.value || '').trim();
    let matched = false;
    let reason = '';

    // type match
    if (category.inputTypes.includes(inputType)) {
      matched = true;
      reason = `type="${inputType}"`;
    }

    // keyword match
    for (const kw of category.keywords) {
      if (labelText.includes(kw)) {
        matched = true;
        reason += (reason ? ', ' : '') + `keyword "${kw}"`;
        break;
      }
    }

    // autocomplete match
    if (category.autocompleteValues.some(ac => autocomplete.startsWith(ac))) {
      matched = true;
      reason += (reason ? ', ' : '') + `autocomplete="${autocomplete}"`;
    }

    // value pattern match (bonus)
    if (value && category.valuePattern && category.valuePattern.test(value)) {
      matched = true;
      reason += (reason ? ', ' : '') + 'value pattern matched';
    }

    return matched ? { confidence: category.confidence, reason } : null;
  }

  /* ─────────────────────────────────────
     Public API
  ───────────────────────────────────── */

  /**
   * Analyze a single form element for PII.
   * @param {HTMLElement} el
   * @returns {{ isSensitive: boolean, category: string|null, confidence: number, reason: string }}
   */
  function analyze(el) {
    let best = null;

    // Explicit data-pii attribute always wins
    if (el.dataset.pii) {
      const cat = PII_CATEGORIES.find(c => c.category === el.dataset.pii);
      if (cat) {
        return {
          isSensitive: true,
          category: cat.category,
          confidence: 1.0,
          reason: 'explicit data-pii attribute',
        };
      }
    }

    for (const cat of PII_CATEGORIES) {
      const score = scoreCategory(el, cat);
      if (score && (!best || score.confidence > best.confidence)) {
        best = { ...score, category: cat.category, isSensitive: true };
      }
    }

    return best || { isSensitive: false, category: null, confidence: 0, reason: 'no PII detected' };
  }

  /**
   * Scan the entire page and return a structured representation.
   * @returns {{ fields: Array, summary: Object }}
   */
  function scanPage() {
    const interactiveSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, button[type="submit"]';
    const elements = document.querySelectorAll(interactiveSelector);
    const fields = [];
    const categories = {};

    elements.forEach((el, idx) => {
      const pii = analyze(el);
      const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      const labelText = labelEl
        ? labelEl.innerText.trim()
        : el.dataset.label || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || `field_${idx}`;

      const tagName = el.tagName.toLowerCase();
      let type = el.type || tagName;
      if (tagName === 'select') type = 'select';
      if (tagName === 'textarea') type = 'textarea';
      if (tagName === 'button') type = 'button';

      // For selects, collect options
      let options = null;
      if (tagName === 'select') {
        options = Array.from(el.options)
          .filter(o => o.value !== '')
          .map(o => ({ value: o.value, label: o.text }));
      }

      const field = {
        index: idx,
        id: el.id || el.name || `field_${idx}`,
        name: el.name || el.id || `field_${idx}`,
        label: labelText,
        type,
        sensitive: pii.isSensitive,
        pii_category: pii.category,
        pii_confidence: pii.confidence,
        options,
        required: el.required || false,
        value: pii.isSensitive
          ? (el.value ? `[REDACTED_${(pii.category || 'PII').toUpperCase()}]` : '')
          : (el.value || ''),
        _element: el, // internal — not sent to server
      };

      fields.push(field);

      if (pii.isSensitive && pii.category) {
        categories[pii.category] = (categories[pii.category] || 0) + 1;
      }
    });

    const sensitiveCount = fields.filter(f => f.sensitive).length;

    return {
      fields,
      summary: {
        total: fields.length,
        sensitive: sensitiveCount,
        protected: sensitiveCount,
        categories,
      },
    };
  }

  /**
   * Returns a server-safe version of the scan (no _element refs, no real values).
   * @returns {{ fields: Array, summary: Object }}
   */
  function getSanitizedPageContext(scanResult) {
    return {
      fields: scanResult.fields.map(f => {
        const { _element, ...safe } = f; // strip DOM reference
        return safe;
      }),
      summary: scanResult.summary,
    };
  }

  /**
   * Placeholder hook for future visual AI augmentation.
   * A local ONNX/Transformers.js model can call this to add
   * visual context to existing scan results.
   * @param {Object} scanResult
   * @param {Object} visualContext - output from local AI model
   * @returns {Object} augmented scan result
   */
  function augmentWithVisualContext(scanResult, visualContext) {
    // TODO (Phase 14): merge visual bounding-box predictions with DOM analysis
    window.__agentLogger && window.__agentLogger.debug('augmentWithVisualContext (stub)', visualContext);
    return scanResult;
  }

  window.__piiDetector = {
    analyze,
    scanPage,
    getSanitizedPageContext,
    augmentWithVisualContext,
  };

  window.__agentLogger && window.__agentLogger.debug('pii-detector.js loaded');
})();
