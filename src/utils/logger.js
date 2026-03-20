// src/utils/logger.js
// Utilitário de log com timestamps e níveis.

const LEVELS = { INFO: '✅', WARN: '⚠️ ', ERROR: '❌' };

function formatTime() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  info(msg, ...args) {
    console.log(`[${formatTime()}] ${LEVELS.INFO} [INFO]  ${msg}`, ...args);
  },
  warn(msg, ...args) {
    console.warn(`[${formatTime()}] ${LEVELS.WARN} [WARN]  ${msg}`, ...args);
  },
  error(msg, ...args) {
    console.error(`[${formatTime()}] ${LEVELS.ERROR} [ERROR] ${msg}`, ...args);
  },
};
