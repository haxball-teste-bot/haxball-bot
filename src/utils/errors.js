// src/utils/errors.js
// Wrapper para async functions — evita crashes não tratados.
import { logger } from './logger.js';

/**
 * Envolve uma função async e captura erros, logando-os sem derrubar o processo.
 * Use em handlers de eventos do HaxBall onde erros de banco não devem travar a sala.
 *
 * @param {Function} fn - Função async a ser executada
 * @param {string} [context] - Nome do contexto para log (ex: 'auth.register')
 * @returns {Function} - Função wrapped safe
 */
export function safeAsync(fn, context = 'unknown') {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error(`[${context}] Erro não tratado:`, err.message || err);
    }
  };
}

/**
 * Executa uma operação de banco e retorna { data, error } padronizado.
 * @param {Function} fn - Função async que retorna { data, error } (padrão Supabase)
 */
export async function dbCall(fn) {
  try {
    const result = await fn();
    if (result.error) {
      logger.error('[DB] Erro Supabase:', result.error.message);
    }
    return result;
  } catch (err) {
    logger.error('[DB] Exceção inesperada:', err.message);
    return { data: null, error: err };
  }
}
