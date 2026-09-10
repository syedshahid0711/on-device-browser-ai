/**
 * extension/utils/logger.js
 * Lightweight, levelled logger shared by all extension scripts.
 * Injected first via manifest content_scripts ordering.
 */

(function () {
  if (window.__agentLogger) return; // already loaded (idempotent)

  const LOG_LEVEL = {
    DEBUG: 0,
    INFO:  1,
    WARN:  2,
    ERROR: 3,
  };

  const CURRENT_LEVEL = LOG_LEVEL.DEBUG; // change to INFO for production

  const PREFIX = '[PrivacyAgent]';
  const COLORS = {
    DEBUG: '#6366f1',
    INFO:  '#22c55e',
    WARN:  '#f59e0b',
    ERROR: '#ef4444',
  };

  function log(level, ...args) {
    if (LOG_LEVEL[level] < CURRENT_LEVEL) return;
    const color = COLORS[level] || '#94a3b8';
    console.log(
      `%c${PREFIX} [${level}]`,
      `color:${color}; font-weight:600;`,
      ...args
    );
  }

  window.__agentLogger = {
    debug: (...args) => log('DEBUG', ...args),
    info:  (...args) => log('INFO',  ...args),
    warn:  (...args) => log('WARN',  ...args),
    error: (...args) => log('ERROR', ...args),
  };
})();
