/**
 * extension/storage/profile-store.js
 *
 * Local user profile management using chrome.storage.local.
 * Private data NEVER leaves the device through this module.
 *
 * Injected into the page via content_scripts — provides
 * window.__profileStore for use by the action executor.
 *
 * Profile schema:
 * {
 *   name:       string,
 *   email:      string,
 *   phone:      string,
 *   dob:        string,   // "YYYY-MM-DD"
 *   address:    string,
 *   employee_id: string,
 *   division:    string,   // e.g. "aeronautics"
 *   gender:      string,   // e.g. "male"
 *   clearance:   string,   // e.g. "secret"
 *   password:    string,   // stored locally; never sent to server
 * }
 */

(function () {
  if (window.__profileStore) return; // idempotent

  const STORAGE_KEY = 'pba_user_profile';

  /**
   * Returns the full profile object from chrome.storage.local.
   * @returns {Promise<Object>}
   */
  async function getProfile() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || {});
      });
    });
  }

  /**
   * Saves the profile to chrome.storage.local.
   * @param {Object} profile
   * @returns {Promise<void>}
   */
  async function saveProfile(profile) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: profile }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }

  /**
   * Returns a single field value from the profile.
   * @param {string} key  - e.g. 'email', 'name'
   * @returns {Promise<string|null>}
   */
  async function getField(key) {
    const profile = await getProfile();
    return profile[key] || null;
  }

  /**
   * Returns the profile with all sensitive values REDACTED,
   * safe to send to the backend for structural analysis.
   *
   * @returns {Promise<Object>}
   */
  async function getSanitizedProfile() {
    const profile = await getProfile();
    const sanitized = {};
    const SENSITIVE_KEYS = ['name', 'email', 'phone', 'dob', 'address', 'employee_id', 'password'];

    for (const [k, v] of Object.entries(profile)) {
      if (SENSITIVE_KEYS.includes(k)) {
        sanitized[k] = v ? `[REDACTED_${k.toUpperCase()}]` : '[EMPTY]';
      } else {
        sanitized[k] = v; // non-sensitive (e.g. department preference, year)
      }
    }
    return sanitized;
  }

  /**
   * Clears the stored profile.
   * @returns {Promise<void>}
   */
  async function clearProfile() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEY], resolve);
    });
  }

  window.__profileStore = {
    getProfile,
    saveProfile,
    getField,
    getSanitizedProfile,
    clearProfile,
  };

  window.__agentLogger && window.__agentLogger.debug('profile-store.js loaded');
})();
