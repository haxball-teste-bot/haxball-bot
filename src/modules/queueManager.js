// src/modules/queueManager.js
// Gerenciador de fila de espectadores.
// A fila determina quem entra no próximo time após o fim de uma partida.
//
// Funcionamento:
//   - Jogadores que entram quando os dois times já estão cheios (3v3) vão para a fila
//   - A fila é FIFO — o primeiro que entrou é o primeiro a jogar
//   - !pulafila move o jogador para o topo da fila (sujeito a cooldown/cargo)
//   - O módulo expõe funções para o teamDistribution e pickManager consultarem

import { logger } from '../utils/logger.js';
import { afkManager } from './afkManager.js';

/** @type {number[]} - Array de playerIds em ordem de fila (índice 0 = próximo a entrar) */
let queue = [];

// Usado para podermos consultar quem realmente está na sala
let _getPlayersFn = null;

export const queueManager = {
  /** Injeta a função getPlayers() nativa da Room */
  init(getPlayersFn) {
    _getPlayersFn = getPlayersFn;
  },

  /**
   * Sincroniza a fila com a realidade da sala.
   * Remove da fila quem não está mais na sala ou não está mais no time 0 (Espectador).
   * @param {object[]} currentPlayers - Array retornado por getPlayers()
   */
  sync(currentPlayers) {
    const afkIds = afkManager.getAfkIds();
    // Apenas specs que NÃO sejam AFK entram/ficam na fila
    const specs = currentPlayers.filter(p => p.team === 0 && !afkIds.includes(p.id)).map(p => p.id);
    
    // Remove quem não está mais em spec ou que agora está AFK
    queue = queue.filter(id => specs.includes(id));
    
    // Adiciona quem está em spec mas não estava na fila
    for (const specId of specs) {
      if (!queue.includes(specId)) {
        queue.push(specId);
      }
    }
  },

  /**
   * Adiciona jogador ao final da fila.
   * Só efetivará se sync() confirmar que ele é Spec.
   * @param {number} playerId
   */
  enqueue(playerId) {
    if (!queue.includes(playerId)) {
      queue.push(playerId);
      logger.info(`[Queue] Player ${playerId} adicionado à fila (posição ${queue.length})`);
    }
  },

  /**
   * Remove e retorna o primeiro da fila (o topo).
   * Cuidado: só chame antes de mover o jogador para um time.
   * @returns {number|null}
   */
  dequeue() {
    return queue.shift() ?? null;
  },

  /**
   * Remove um jogador específico da fila.
   * @param {number} playerId
   */
  remove(playerId) {
    const idx = queue.indexOf(playerId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      logger.info(`[Queue] Player ${playerId} removido da fila.`);
    }
  },

  /**
   * Move um jogador para o topo da fila (pular fila).
   * Garanta que ele esteja em Spec antes.
   * @param {number} playerId
   */
  moveToFront(playerId) {
    this.remove(playerId);
    queue.unshift(playerId);
    logger.info(`[Queue] Player ${playerId} movido para o topo da fila.`);
  },

  /**
   * Verifica se o jogador está na fila.
   * @param {number} playerId
   * @returns {boolean}
   */
  isInQueue(playerId) {
    return queue.includes(playerId);
  },

  /**
   * Retorna a posição do jogador na fila (1-indexed, 0 = não está).
   * @param {number} playerId
   * @returns {number}
   */
  position(playerId) {
    const idx = queue.indexOf(playerId);
    return idx === -1 ? 0 : idx + 1;
  },

  /** @returns {number} Tamanho da fila */
  size() {
    return queue.length;
  },

  /** @returns {boolean} */
  isEmpty() {
    return queue.length === 0;
  },

  /** Retorna uma cópia da fila atual (para exibição) */
  snapshot() {
    return [...queue];
  },

  /** Limpa a fila */
  clear() {
    queue.length = 0;
  },
};
