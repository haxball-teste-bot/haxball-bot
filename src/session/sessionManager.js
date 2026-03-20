// src/session/sessionManager.js
// Gerenciador de sessões em memória.
// Mapeia playerID (int da API do HaxBall) → dados do jogador carregados do banco.
//
// IMPORTANTE: Esse Map é volátil — reiniciar o processo limpa as sessões.
// Os dados persistentes estão no Supabase; a sessão é apenas um cache de leitura rápida.

/**
 * @typedef {Object} PlayerSession
 * @property {string} dbId        - UUID da linha em user_info
 * @property {string} haxball_name - Nome registrado no banco
 * @property {number} balance     - Saldo atual (actual_balance parseado como int)
 * @property {boolean} is_admin   - Se o jogador tem acesso ao !getadmin
 * @property {boolean} is_vip     - Derivado de log_purchase (comprou item 'vip')
 * @property {string|null} auth_key - player.auth capturado no onPlayerJoin
 */

/** @type {Map<number, PlayerSession>} */
const sessions = new Map();

export const sessionManager = {
  /**
   * Salva ou atualiza a sessão de um jogador.
   * @param {number} playerId
   * @param {PlayerSession} data
   */
  set(playerId, data) {
    sessions.set(playerId, data);
  },

  /**
   * Retorna a sessão de um jogador ou null se não existir.
   * @param {number} playerId
   * @returns {PlayerSession|null}
   */
  get(playerId) {
    return sessions.get(playerId) ?? null;
  },

  /**
   * Remove a sessão de um jogador (ao sair da sala).
   * @param {number} playerId
   */
  remove(playerId) {
    sessions.delete(playerId);
  },

  /**
   * Atualiza campos específicos de uma sessão existente.
   * @param {number} playerId
   * @param {Partial<PlayerSession>} patch
   */
  patch(playerId, patch) {
    const existing = sessions.get(playerId);
    if (existing) {
      sessions.set(playerId, { ...existing, ...patch });
    }
  },

  /**
   * Retorna quantos jogadores com sessão ativa existem (registrados em sala).
   * Útil para auto-team sem depender de getPlayerList() + estado assíncrono.
   */
  count() {
    return sessions.size;
  },

  /**
   * Retorna todos os IDs de jogadores com sessão ativa.
   * @returns {number[]}
   */
  allIds() {
    return [...sessions.keys()];
  },
};
