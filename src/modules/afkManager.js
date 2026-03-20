// src/modules/afkManager.js
// Gerenciador do sistema AFK.
//
// Regras:
//   - Permitido em espectador e em times durante 1v1 ou 2v2.
//   - Proibido em 3v3 SE a partida tiver passado de 10 segundos.

import { logger } from '../utils/logger.js';
import { RATING } from '../config/ratingConfig.js';
import { queueManager } from './queueManager.js';

const afkPlayers = new Set();
const playerActivity = new Map();
const warnedPlayers = new Map();

let matchStartTime = 0; // Armazena timestamp do inicio do kick-off. (Setado pela main idealmente, ou aproximando pelo onGameStart).
let idleInterval = null;

export const afkManager = {
  
  /** Marca quando a partida foi iniciada no main.js */
  setMatchStartTime(timeMs) {
    matchStartTime = timeMs;
  },

  /** 
   * Alterna estado AFK 
   * @param {object} room
   * @param {object} player
   * @param {number} redCount - Quantidade no time 1
   * @param {number} blueCount - Quantidade no time 2
   */
  /** 
   * Alterna estado AFK 
   */
  async toggleAfk(roomProxy, player, redCount, blueCount) {
    if (afkPlayers.has(player.id)) {
      afkPlayers.delete(player.id);
      playerActivity.set(player.id, Date.now());
      warnedPlayers.delete(player.id);
      logger.info(`[AFK] Player ${player.name} saiu do AFK.`);
      roomProxy.sendAnnouncement(`🔙 ${player.name} voltou do AFK!`, null, 0xB0C4DE, 'normal', 0);
      return;
    }

    afkPlayers.add(player.id);
    playerActivity.delete(player.id);
    warnedPlayers.delete(player.id);
    logger.info(`[AFK] Player ${player.name} entrou em AFK.`);
    roomProxy.sendAnnouncement(`💤 ${player.name} está parado (AFK).`, null, 0xB0C4DE, 'normal', 0);

    if (player.team !== 0) {
      roomProxy.setPlayerTeam(player.id, 0);
    }
    queueManager.remove(player.id);
  },

  /** Obtém a lista em array (Ids) */
  getAfkIds() {
    return Array.from(afkPlayers);
  },

  /** Atualiza tracking de movimentos do Haxball */
  updateActivity(playerId) {
    playerActivity.set(playerId, Date.now());
    if (warnedPlayers.has(playerId)) {
      warnedPlayers.delete(playerId);
    }
  },

  /** Dispara Engine de Check Idle de 10s + 5s */
  startIdleChecker(roomProxy, getPlayersList) {
    if (idleInterval) clearInterval(idleInterval);
    idleInterval = setInterval(async () => {
      const { teamState, balanceTeams } = await import('./teamDistribution.js');
      
      const players = await getPlayersList();
      const now = Date.now();

      for (const p of players) {
        if (p.team === 0 || afkPlayers.has(p.id)) continue; 

        if (!playerActivity.has(p.id)) {
           playerActivity.set(p.id, now);
           continue; 
        }

        const idleTime = now - playerActivity.get(p.id);

        if (idleTime > 10000 && !warnedPlayers.has(p.id)) {
          warnedPlayers.set(p.id, now);
          roomProxy.sendAnnouncement(`⚠️ ${p.name}, mexa-se em 5s ou irá para AFK!`, p.id, 0xFFD3B6, 'normal', 2);
        } else if (warnedPlayers.has(p.id)) {
          const warningTime = warnedPlayers.get(p.id);
          if (now - warningTime > 5000) {
            warnedPlayers.delete(p.id);
            logger.info(`[Idle] Player ${p.name} movido por inatividade.`);
            this.toggleAfk(roomProxy, p, teamState.red, teamState.blue); 
            setTimeout(() => balanceTeams(roomProxy), 300);
          }
        }
      }
    }, 1000);
  },

  /** Display command !afks */
  showAfks(roomProxy, player, playersList) {
    if (afkPlayers.size === 0) {
      roomProxy.sendAnnouncement(`💤 Ninguém AFK.`, player.id, 0xDDDDDD, 'normal', 0);
      return;
    }

    const names = playersList.filter(p => afkPlayers.has(p.id)).map(p => p.name);
    roomProxy.sendAnnouncement(`💤 AFKs: ${names.join(', ')}`, player.id, 0xDDDDDD, 'normal', 0);
  },

  removeAfk(id) {
    afkPlayers.delete(id);
  }
};
