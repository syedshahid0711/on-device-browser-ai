/**
 * extension/utils/docx-parser.js
 *
 * On-device Word (.docx) parser.
 * Uses JSZip to unzip the .docx and DOMParser to read word/document.xml.
 * No backend, no AI — pure browser-side extraction.
 *
 * Exposed as: window.__docxParser
 */

(function () {
  'use strict';
  if (window.__docxParser) return;

  /**
   * Extract all human-readable text from a .docx File object.
   * @param {File} file
   * @returns {Promise<string>}
   */
  /**
   * Extract all human-readable text from a .docx File object.
   * Properly parses paragraphs (<w:p>), line breaks (<w:br/>), and tables (<w:tbl>).
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function extractText(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) throw new Error('Invalid .docx file — word/document.xml not found');

    const xmlText = await xmlFile.async('string');
    const parser  = new DOMParser();
    const xmlDoc  = parser.parseFromString(xmlText, 'application/xml');

    const lines = [];

    // Helper to get text from a paragraph node, respecting <w:br/> line breaks
    function parseParagraph(pNode) {
      const pLines = [];
      let current = '';

      function walk(node) {
        for (const child of node.childNodes) {
          const name = child.localName;
          if (name === 't') {
            current += child.textContent || '';
          } else if (name === 'br') {
            if (current.trim()) pLines.push(current.trim());
            current = '';
          } else if (child.childNodes && child.childNodes.length > 0) {
            walk(child);
          }
        }
      }

      walk(pNode);
      if (current.trim()) pLines.push(current.trim());
      return pLines;
    }

    // Helper to get text from a table cell node
    function parseCell(tcNode) {
      const cellText = parseParagraph(tcNode).join(' ');
      return cellText.trim();
    }

    // Walk body elements
    const body = xmlDoc.getElementsByTagNameNS('*', 'body')[0] || xmlDoc.documentElement;
    if (body) {
      for (const child of body.childNodes) {
        const name = child.localName;
        if (name === 'p') {
          lines.push(...parseParagraph(child));
        } else if (name === 'tbl') {
          const trs = child.getElementsByTagNameNS('*', 'tr');
          for (const tr of trs) {
            const tcs = Array.from(tr.childNodes).filter(c => c.localName === 'tc');
            const cellTexts = tcs.map(tc => parseCell(tc)).filter(t => t.length > 0);
            if (cellTexts.length === 2) {
              // Format 2-column table rows as "Key: Value"
              lines.push(`${cellTexts[0]}: ${cellTexts[1]}`);
            } else if (cellTexts.length > 0) {
              lines.push(cellTexts.join(' | '));
            }
          }
        }
      }
    }

    // Fallback if line count is empty
    if (lines.length === 0) {
      const tNodes = xmlDoc.getElementsByTagNameNS('*', 't');
      for (const t of tNodes) {
        if (t.textContent.trim()) lines.push(t.textContent.trim());
      }
    }

    return lines.join('\n');
  }

  /**
   * Regex-based field extractor.
   * Looks for patterns like "Name: John Smith", "Email: x@y.com" etc.
   * Works for both key:value paragraphs AND table row text.
   *
   * @param {string} text  — full raw text from the .docx
   * @returns {Object}     — profile object (only populated keys)
   */
  function extractFields(text) {
    const profile = {};

    // ── Helpers ─────────────────────────────────────────────────────────────
    function find(patterns) {
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1] && m[1].trim()) return m[1].trim();
      }
      return null;
    }

    // ── Name ────────────────────────────────────────────────────────────────
    const name = find([
      /^(?:full\s*name|name)\s*[:\-]\s*(.+)/im,
      /(?:full\s*name|name)\s*[:\-]\s*([A-Za-z\s\.]{2,40})/i,
      /^([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})$/m,
    ]);
    if (name) profile.name = name.split('\n')[0].trim();

    // ── Email ────────────────────────────────────────────────────────────────
    const email = find([
      /(?:e[\-\s]?mail(?:\s*address)?)\s*[:\-]\s*([\w.\-+]+@[\w\-]+\.[\w.]+)/i,
      /([\w.\-+]+@[\w\-]+\.[\w.]+)/,
    ]);
    if (email) profile.email = email;

    // ── Phone ────────────────────────────────────────────────────────────────
    const phone = find([
      /(?:phone|mobile|contact|tel(?:ephone)?(?:\s*number)?)\s*[:\-]\s*([\+\d][\d\s\-().]{7,17})/i,
      /((?:\+91|0)?[\s\-]?\d{10})/,
    ]);
    if (phone) profile.phone = phone.replace(/\s+/g, ' ').trim();

    // ── Date of Birth ────────────────────────────────────────────────────────
    const dob = find([
      /(?:date\s*of\s*birth|birth\s*date|dob|d\.o\.b\.?|born(?:\s*on)?|birthday)\s*[:\-]\s*([^\n\r]+)/i,
      /(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/,
      /(\d{4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,2})/,
    ]);
    if (dob) {
      profile.dob = normaliseDOB(dob);
    }

    // ── Address ──────────────────────────────────────────────────────────────
    const address = find([
      /(?:address|residence|residential\s*address|home\s*address)\s*[:\-]\s*(.{5,120})/i,
    ]);
    if (address) profile.address = address.split('\n')[0].trim();

    // ── Employee ID ──────────────────────────────────────────────────────────
    const empId = find([
      /(?:employee\s*id|emp\.?\s*id|staff\s*id|id\s*no\.?|empno)\s*[:\-]\s*([A-Z0-9\-]{3,20})/i,
      /\b(EMP[\-]?\d{4,10})\b/i,
      /\b(ISRO[\-]?\d{4,10})\b/i,
    ]);
    if (empId) profile.employee_id = empId;

    // ── Division ─────────────────────────────────────────────────────────────
    const divRaw = find([
      /(?:division|department|dept\.?|section|branch|stream|domain)\s*[:\-]\s*([^\n\r]+)/i,
      /(?:division|department|dept\.?|section)\s*[:\-]\s*(.{2,40})/i,
    ]);
    if (divRaw) {
      const divClean = divRaw.split('\n')[0].trim();
      const divMap = {
        'aeronautic': 'aeronautics',
        'aero':       'aeronautics',
        'propulsion': 'propulsion',
        'spacecraft': 'spacecraft',
        'space':      'spacecraft',
        'avionic':    'avionics',
        'mission':    'mission_control',
        'control':    'mission_control',
      };
      const divLower = divClean.toLowerCase();
      for (const [key, val] of Object.entries(divMap)) {
        if (divLower.includes(key)) { profile.division = val; break; }
      }
      if (!profile.division) profile.division = divClean;
    }

    // ── Gender ───────────────────────────────────────────────────────────────
    const genderRaw = find([
      /(?:gender|sex)\s*[:\-]\s*(\w+)/i,
    ]);
    if (genderRaw) {
      const gl = genderRaw.toLowerCase();
      if (gl.includes('female') || gl === 'f') profile.gender = 'female';
      else if (gl.includes('male') || gl === 'm') profile.gender = 'male';
      else if (gl.includes('non') || gl.includes('binary')) profile.gender = 'non_binary';
      else profile.gender = genderRaw;
    }

    // ── Clearance Level ──────────────────────────────────────────────────────
    const clearRaw = find([
      /(?:clearance\s*level|security\s*clearance|clearance|level)\s*[:\-]\s*(.{2,30})/i,
    ]);
    if (clearRaw) {
      const cl = clearRaw.split('\n')[0].trim().toLowerCase().replace(/\s+/g, '_');
      const clearMap = {
        'level_1': 'level_1', 'level1': 'level_1',
        'level_2': 'level_2', 'level2': 'level_2',
        'secret':  'secret',
        'top_secret': 'top_secret', 'topsecret': 'top_secret',
      };
      profile.clearance = clearMap[cl] || clearRaw;
    }

    // ── Password ─────────────────────────────────────────────────────────────
    const pwd = find([
      /^(?:password|pass|pwd|passcode|pin|login\s*key)\s*[:\-]\s*(\S{4,64})/im,
      /(?:password|pass|pwd|passcode|pin)\s*[:\-]\s*(\S{4,64})/i,
    ]);
    if (pwd) profile.password = pwd;

    return profile;
  }

  /**
   * Normalise a date string to YYYY-MM-DD for HTML <input type="date">
   */
  function normaliseDOB(raw) {
    if (!raw) return '';
    let str = String(raw).trim().replace(/th|st|nd|rd/gi, '');

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // YYYY/MM/DD or YYYY.MM.DD -> YYYY-MM-DD
    const mYYYY = str.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
    if (mYYYY) return `${mYYYY[1]}-${mYYYY[2].padStart(2,'0')}-${mYYYY[3].padStart(2,'0')}`;

    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const mDD = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (mDD) {
      let d = parseInt(mDD[1], 10);
      let m = parseInt(mDD[2], 10);
      let y = parseInt(mDD[3], 10);
      if (m > 12 && d <= 12) { const tmp = d; d = m; m = tmp; }
      return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    // DD/MM/YY (2-digit year)
    const mYY = str.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})/);
    if (mYY) {
      let d = parseInt(mYY[1], 10);
      let m = parseInt(mYY[2], 10);
      let yr = parseInt(mYY[3], 10);
      let fullY = yr > 30 ? 1900 + yr : 2000 + yr;
      return `${fullY}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }

    // Month names dictionary
    const months = {
      jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,
      jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,
      oct:10,october:10,nov:11,november:11,dec:12,december:12
    };

    // "15-May-1998" or "15 May 1998" or "15/May/1998"
    const mWord1 = str.match(/(\d{1,2})[\s\-\/\.]*([A-Za-z]{3,9})[\s\-\/\.]*(\d{2,4})/);
    if (mWord1) {
      const mo = months[mWord1[2].toLowerCase().slice(0,3)];
      let y = parseInt(mWord1[3], 10);
      if (y < 100) y += y > 30 ? 1900 : 2000;
      if (mo) return `${y}-${String(mo).padStart(2,'0')}-${mWord1[1].padStart(2,'0')}`;
    }

    // "May 15, 1998" or "May 15 1998"
    const mWord2 = str.match(/([A-Za-z]{3,9})[\s\-\/\.]*(\d{1,2}),?[\s\-\/\.]*(\d{2,4})/);
    if (mWord2) {
      const mo = months[mWord2[1].toLowerCase().slice(0,3)];
      let y = parseInt(mWord2[3], 10);
      if (y < 100) y += y > 30 ? 1900 : 2000;
      if (mo) return `${y}-${String(mo).padStart(2,'0')}-${mWord2[2].padStart(2,'0')}`;
    }

    return raw;
  }

  /**
   * Main entry point: parse a .docx File and return a profile object.
   * @param {File} file
   * @returns {Promise<Object>}
   */
  async function parse(file) {
    const text    = await extractText(file);
    const profile = extractFields(text);
    console.log('[DocxParser] Extracted text:\n', text);
    console.log('[DocxParser] Profile:', profile);
    return { profile, rawText: text };
  }

  window.__docxParser = { parse, extractText, extractFields };
  console.log('[DocxParser] docx-parser.js loaded');
})();
