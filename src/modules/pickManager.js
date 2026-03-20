// src/modules/pickManager.js
// Máquina de estados do sistema de pick pós-partida.
//
// Fluxo (quando há fila com jogadores):
//   1. Partida termina → teamDistribution chama initPick(room, loserTeam, pickerPlayerId)
//   2. O picker (primeiro da fila) entra automaticamente no time perdedor
//   3. O picker possui PICK_TIMEOUT_MS para escolher os companheiros por nome no chat
//   4. Ele digita um nome (ou prefixo) no chat → tryPick(room, picker, inputName)
//   5. A cada pick bem-sucedido, o jogador escolhido vai para o time do picker
//   6. Quando o time está completo (3 jogadores) → pick encerrado, jogo retoma
//
// Tratamento de conflito por nome:
//   - Se input bate com 2+ jogadores elegíveis → aviso PRIVADO ao picker com os nomes
//   - Se bate com exatamente 1 → move imediatamente
//
// Jogadores elegíveis = quem está na fila ou como espectador naquele momento

import { queueManager } from './queueManager.js';
import { sessionManager } from '../session/sessionManager.js';
import { logger } from '../utils/logger.js';
import { RATING } from '../config/ratingConfig.js';

// ── Estado interno do pick ────────────────────────────────────────────────────

/** null = sem pick ativo */
let pickState = null;

/*
pickState = {
  pickerPlayerId:  number,   // ID HaxBall do picker (já no time)
  team:            number,   // time que está preenchendo (1 ou 2)
  pickedIds:       number[], // IDs já escolhidos (incluindo o picker)
  room:            object,   // referência ao roomProxy
  timeout:         Timer,    // auto-cancel se picker sumir
}
*/

const PICK_TIMEOUT_MS = 60_000; // 60 segundos para completar o pick

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicializa o sistema de pick após fim de partida com fila.
 * O picker (primeiro da fila) é movido automaticamente para o time perdedor.
 *
 * @param {object} room
 * @param {number} loserTeam - 1=red, 2=blue
 * @param {number} pickerPlayerId - ID HaxBall do primeiro da fila
 */
export function initPick(room, loserTeam, pickerPlayerId) {
  if (pickState) cancelPick(); // cancela pick anterior se existir

  // Dequeue o picker da fila
  queueManager.remove(pickerPlayerId);

  // ASSÍNCRONO: setPlayerTeam é async — usamos setTimeout para garantir que o
  // jogador foi processado pelo engine antes de movê-lo
  setTimeout(() => {
    room.setPlayerTeam(pickerPlayerId, loserTeam);
    logger.info(`[Pick] Picker playerId=${pickerPlayerId} movido para team=${loserTeam}`);
  }, 150);

  const pickerSession = sessionManager.get(pickerPlayerId);
  const pickerName = pickerSession?.haxball_name ?? `Player#${pickerPlayerId}`;

  pickState = {
    pickerPlayerId,
    team: loserTeam,
    pickedIds: [pickerPlayerId],
    room,
    timeout: setTimeout(() => {
      room.sendAnnouncement(
        `⏰ Tempo esgotado! Pick encerrado automaticamente.`,
        null, 0xFFD3B6, 'normal', 1
      );
      cancelPick();
    }, PICK_TIMEOUT_MS),
  };

  const spotsNeeded = RATING.MAX_PER_TEAM - 1; // já tem o picker
  room.sendAnnouncement(
    `🎯 ${pickerName} é o capitão! Escolha ${spotsNeeded} jogador(es) pelo nome. Ex: mudo`,
    null, 0xB0C4DE, 'normal', 2
  );
  room.sendAnnouncement(
    `  Você tem 60s. Digite apenas o nome (ou prefixo) no chat.`,
    pickerPlayerId, 0xCCCCCC, 'small-italic', 0
  );
}

/**
 * Tenta processar um pick pelo nome digitado no chat.
 * Deve ser chamado pelo commandRouter quando há pick ativo e a mensagem não é um comando.
 *
 * @param {object} room
 * @param {object} picker - PlayerObject do HaxBall (remetente da mensagem)
 * @param {string} message - Texto digitado
 * @param {object[]} currentPlayers - Array de PlayerObject (getPlayerList snapshot)
 * @returns {boolean} true se a mensagem foi consumida pelo pick (não rebroadcast)
 */
export function tryPick(room, picker, message, currentPlayers) {
  if (!pickState) return false;
  if (picker.id !== pickState.pickerPlayerId) return false;

  const query = message.trim().toLowerCase();
  if (!query) return false;

  // Jogadores elegíveis: estão na fila OU são espectadores (team=0),
  // não foram ainda escolhidos, e não são o próprio picker
  const eligible = currentPlayers.filter(p =>
    p.team === 0 &&
    !pickState.pickedIds.includes(p.id) &&
    p.id !== picker.id
  );

  // Busca por prefixo case-insensitive no nome HaxBall (ou nome de sessão)
  const matches = eligible.filter(p => {
    const name = (sessionManager.get(p.id)?.haxball_name ?? p.name).toLowerCase();
    return name.startsWith(query) || name.includes(query);
  });

  if (matches.length === 0) {
    room.sendAnnouncement(
      `❌ Nenhum jogador encontrado com "${message}". Tente um nome diferente.`,
      picker.id, 0xFF8B94, 'normal', 0
    );
    return true;
  }

  if (matches.length > 1) {
    // CONFLITO — lista privada para o picker
    const names = matches.map(p => sessionManager.get(p.id)?.haxball_name ?? p.name).join(', ');
    room.sendAnnouncement(
      `⚠️ Ambíguo! Vários jogadores correspondem a "${message}": ${names}. Seja mais específico.`,
      picker.id, 0xFFD3B6, 'normal', 0
    );
    return true;
  }

  // Match único → move para o time do picker
  const chosen = matches[0];
  pickState.pickedIds.push(chosen.id);
  queueManager.remove(chosen.id);

  // ASSÍNCRONO: setTimeout antes de setPlayerTeam (documentação oficial)
  setTimeout(() => {
    room.setPlayerTeam(chosen.id, pickState.team);
  }, 150);

  const chosenName = sessionManager.get(chosen.id)?.haxball_name ?? chosen.name;
  const pickerName = sessionManager.get(picker.id)?.haxball_name ?? picker.name;
  room.sendAnnouncement(
    `✅ ${pickerName} escolheu ${chosenName}!`,
    null, 0xA8E6CF, 'normal', 1
  );
  logger.info(`[Pick] ${pickerName} escolheu ${chosenName} (team=${pickState.team})`);

  // Verifica se o time está completo
  if (pickState.pickedIds.length >= RATING.MAX_PER_TEAM) {
    room.sendAnnouncement(
      `🏁 Time completo! Preparando partida...`,
      null, 0xB0C4DE, 'normal', 2
    );
    finalizePick();
  } else {
    const remaining = RATING.MAX_PER_TEAM - pickState.pickedIds.length;
    room.sendAnnouncement(
      `  Faltam ${remaining} jogador(es). Continue escolhendo...`,
      picker.id, 0xCCCCCC, 'small-italic', 0
    );
  }

  return true;
}

/**
 * Cancela o pick ativo (jogador saiu, timeout, etc.).
 */
export function cancelPick() {
  if (!pickState) return;
  clearTimeout(pickState.timeout);
  pickState = null;
  logger.info('[Pick] Pick cancelado.');
}

/**
 * Finaliza o pick e libera o estado.
 * O teamDistribution recebe o controle para iniciar a partida.
 */
function finalizePick() {
  if (pickState?.timeout) clearTimeout(pickState.timeout);
  pickState = null;
}

/** @returns {boolean} true se há pick ativo */
export function isPickActive() {
  return pickState !== null;
}

/** @returns {number|null} ID do picker atual */
export function getPickerPlayerId() {
  return pickState?.pickerPlayerId ?? null;
}
