// src/modules/teamDistribution.js
// Distribuição automática de jogadores em times — substitui o antigo autoTeam.js
//
// Regras:
//   - Máximo jogadores por time: RATING.MAX_PER_TEAM
//   - Se total ≤ MAX*2: distribui automaticamente (resto na fila)
//   - Se total > MAX*2: excedentes vão para a fila desde o início
//   - Após fim de partida com fila:
//       * Time vencedor permanece
//       * Time perdedor é esvaziado (todos para espectadores)
//       * Primeiro da fila entra no time perdedor e vira picker
//       * Picker escolhe companheiros por nome
//
// NOTA ASSÍNCRONA: Todos os setPlayerTeam usam setTimeout(150ms) para garantir
// que o engine do HaxBall processou o estado antes de qualquer chamada API.
// (Documentação oficial: "all state modifications execute asynchronously")

import { queueManager } from './queueManager.js';
import { initPick, cancelPick, isPickActive } from './pickManager.js';
import { sessionManager } from '../session/sessionManager.js';
import { logger } from '../utils/logger.js';
import { RATING } from '../config/ratingConfig.js';

const MAX = RATING.MAX_PER_TEAM;
const DELAY = 150; // ms antes de chamar setPlayerTeam

/** Contadores de time em memória (mais confiável que getPlayerList() pós-join) */
let redCount  = 0;
let blueCount = 0;
let gameActive = false;

// ── API pública ───────────────────────────────────────────────────────────────

let autoBalancePaused = false;

/** Força reequilíbrio dos times, mantendo sempre igualdade perfeita (1v1, 2v2, etc) */
export async function balanceTeams(room) {
  if (autoBalancePaused || isPickActive()) return;

  const players = await room.getPlayerList();
  if (!players || !players.length) return;

  const redPlayers = players.filter(p => p.team === 1);
  const bluePlayers = players.filter(p => p.team === 2);
  let redC = redPlayers.length;
  let blueC = bluePlayers.length;

  queueManager.sync(players);
  let hasChanges = false;

  logger.info(`[AutoBalance] Check Run: ${redC}v${blueC} | Fila: ${queueManager.size()} players | Active: ${gameActive}`);

  // 1. Sempre dar preferência a puxar em PARES, se a sala estiver vazia ou menor que MAX
  while (redC === blueC && redC < MAX && queueManager.size() >= 2) {
    const p1 = queueManager.dequeue();
    const p2 = queueManager.dequeue();
    room.setPlayerTeam(p1, 1);
    room.setPlayerTeam(p2, 2);
    redC++;
    blueC++;
    hasChanges = true;
    logger.info(`[AutoBalance] Pareamento Fechado! (+ IDs ${p1}, ${p2}). Ficou ${redC}v${blueC}`);
  }

  // 2. Se não deu par, e a sala está TOTALMENTE vazia, permitir o "1v0" pro primeiro da fila aguardar
  if (redC === 0 && blueC === 0 && queueManager.size() > 0) {
    const p1 = queueManager.dequeue();
    room.setPlayerTeam(p1, 1);
    redC++;
    hasChanges = true;
    logger.info(`[AutoBalance] Jogador Solitário (ID ${p1}) liberado pro Red (Espera)`);
  }

  // 3. E se estiver 1v0 (esperando adversário) e entrar mais 1? A fila terá pelo menos 1. Completar par!
  if ((redC === 1 && blueC === 0) || (blueC === 1 && redC === 0)) {
    if (queueManager.size() > 0) {
      const p2 = queueManager.dequeue();
      if (redC === 1) { room.setPlayerTeam(p2, 2); blueC++; }
      else { room.setPlayerTeam(p2, 1); redC++; }
      hasChanges = true;
      logger.info(`[AutoBalance] Par Completo! ID ${p2} fechou a conta. 1v1 Liberado.`);
    }
  }

  // 4. Se a partida estava rodando e um jogador caiu (ex: 2v1) -> Tentar repor imediatamente da fila
  while (redC < blueC && queueManager.size() > 0) {
    const id = queueManager.dequeue();
    room.setPlayerTeam(id, 1);
    redC++;
    hasChanges = true;
    logger.info(`[AutoBalance] Red estava vazio, id ${id} assumiu o posto.`);
  }
  while (blueC < redC && queueManager.size() > 0) {
    const id = queueManager.dequeue();
    room.setPlayerTeam(id, 2);
    blueC++;
    hasChanges = true;
    logger.info(`[AutoBalance] Blue estava vazio, id ${id} assumiu o posto.`);
  }

  // 5. Se não tem fila suficiente pra repor, remover os excedentes pro Spec (pra manter strict equal)
  while (redC > blueC) {
    if (redC === 1 && blueC === 0) break; // 1v0 em espera é permitido
    const target = players.filter(p => p.team === 1).pop();
    if (target) {
      room.setPlayerTeam(target.id, 0);
      queueManager.enqueue(target.id);
      redC--;
      hasChanges = true;
      room.sendAnnouncement(`⚠️ Movido para a fila (desequilíbrio).`, target.id, 0xFFD3B6, 'normal', 0);
      logger.info(`[AutoBalance] Removido ID ${target.id} do Red (Forçando Pares).`);
    }
  }
  while (blueC > redC) {
    if (blueC === 1 && redC === 0) break; // 0v1 em espera é permitido
    const target = players.filter(p => p.team === 2).pop();
    if (target) {
      room.setPlayerTeam(target.id, 0);
      queueManager.enqueue(target.id);
      blueC--;
      hasChanges = true;
      room.sendAnnouncement(`⚠️ Movido para a fila (desequilíbrio).`, target.id, 0xFFD3B6, 'normal', 0);
      logger.info(`[AutoBalance] Removido ID ${target.id} do Blue (Forçando Pares).`);
    }
  }

  // 6. Controle rigoroso de Paradas e Disparos
  // Verifica se alguém saiu ou deu AFK repentinamente sem a intervenção do AutoBalance
  const structureDropped = (redC < redCount || blueC < blueCount);
  const isWarmup = (redC === 1 && blueC === 0) || (redC === 0 && blueC === 1);
  const badMismatch = (redC !== blueC && !isWarmup);

  if (gameActive && (hasChanges || structureDropped || badMismatch)) {
    room.stopGame();
    gameActive = false;
    logger.info(`[AutoBalance] Integridade da partida afetada (AFK, Quiter ou Ajuste). Reiniciando game.`);
  }

  if (redC === 0 && blueC === 0 && gameActive) {
    room.stopGame();
    gameActive = false;
    logger.info(`[AutoBalance] Ninguém nos gramados. Engine Parada.`);
  } else if ((redC > 0 || blueC > 0) && !gameActive) {
    logger.info(`[AutoBalance] Jogadores identificados (${redC}v${blueC}). Pre-heating startGame...`);
    setTimeout(() => {
      // Dupla checagem: o Headless as vezes encavala setPlayerTeam. Esse timeout cura.
      if (!gameActive) {
        room.startGame();
        logger.info(`[AutoBalance] Disparado room.startGame()! Esperando confirmacao native Event.`);
      }
    }, DELAY * 8);
  }

  // Salvar memória legacy
  redCount = redC;
  blueCount = blueC;
}

/**
 * Chamado em onPlayerJoin.
 * Evita duplo event loop. Cadastra a ID e deixa o timeout balanceador lidar com a alocação nativa do Haxball(time 0).
 */
export function onPlayerJoin(room, player) {
  queueManager.enqueue(player.id);
  
  setTimeout(() => {
    const pos = queueManager.position(player.id);
    room.sendAnnouncement(
      `⏳ Fila: posição ${pos}.`,
      player.id, 0xDCDCDC, 'normal', 0
    );
    balanceTeams(room);
  }, DELAY * 3);
}

/**
 * Chamado em onPlayerLeave. Atualiza a fila e forca a resincronizacao de equipes em caso de times desiguais.
 */
export function onPlayerLeave(room, player) {
  if (player.team === 1) redCount  = Math.max(0, redCount  - 1);
  if (player.team === 2) blueCount = Math.max(0, blueCount - 1);

  // Remove da fila se estava lá
  queueManager.remove(player.id);

  // Cancela pick se o picker saiu
  if (isPickActive()) cancelPick();

  // Aciona AutoBalance assim que quem saiu for processado pela room (assíncrono + delay)
  setTimeout(() => balanceTeams(room), DELAY * 3);
}

/**
 * Chamado em onTeamVictory ou quando o jogo para com placar.
 * Inicia a rotação: limpa o time perdedor e ativa o pick se houver fila.
 *
 * @param {object} room
 * @param {number} winnerTeam - 1 ou 2
 * @param {object[]} players - lista atual de PlayerObject (do getPlayerList)
 */
export async function onMatchEnd(room, winnerTeam, players) {
  gameActive = false;
  const loserTeam = winnerTeam === 1 ? 2 : 1;
  const winnerPlayers = players.filter(p => p.team === winnerTeam);
  const totalInGame = players.filter(p => p.team === 1 || p.team === 2).length;

  // Previne balanceTeams de rodar e cagar com os Pickers
  autoBalancePaused = true;

  if (queueManager.isEmpty() || totalInGame < MAX * 2) { 
    logger.info(`[TeamDist] Partida inferior a ${MAX}v${MAX} ou sem fila. Retomando o jogo...`);
    setTimeout(() => {
      room.stopGame();
      setTimeout(() => {
        autoBalancePaused = false;
        balanceTeams(room);
      }, DELAY * 2);
    }, 2000); 
    return;
  }

  logger.info(`[TeamDist] Time ${loserTeam} perdeu. Iniciando rotação com fila.`);

  // Anuncia quem venceu
  const winnerName = winnerTeam === 1 ? 'Vermelho' : 'Azul';
  room.sendAnnouncement(`🏆 ${winnerName} venceu!`, null, 0xA8E6CF, 'normal', 2);

  // Move os jogadores do time perdedor para espectadores (team 0)
  const loserPlayers = players.filter(p => p.team === loserTeam);
  for (const p of loserPlayers) {
    setTimeout(() => {
      room.setPlayerTeam(p.id, 0);
      queueManager.enqueue(p.id); // vão para o fim da fila manualmente aqui
    }, DELAY);
  }
  
  if (loserTeam === 1) redCount  = 0;
  else                 blueCount = 0;

  // Pega o primeiro da fila original → vira picker. O Queue Manager ainda não sincronizou a remoção, é seguro
  const nextPickerId = queueManager.dequeue(); 
  if (nextPickerId == null) {
      autoBalancePaused = false;
      return;
  }

  // Aguarda os moves para espectador processarem antes de iniciar o pick
  setTimeout(() => {
    if (loserTeam === 1) redCount  = 1;
    else                 blueCount = 1;

    setTimeout(() => {
      autoBalancePaused = false;
    }, 60000); // garante fallback pra não ficar eternamente pausado caso dê timeOut do PickManager
    initPick(room, loserTeam, nextPickerId);
  }, DELAY * 4);
}

/**
 * Chamado em onGameStart para sincronizar estado.
 */
export function onGameStart(players) {
  gameActive = true;
  redCount  = players.filter(p => p.team === 1).length;
  blueCount = players.filter(p => p.team === 2).length;
  logger.info(`[TeamDist] Partida iniciada: ${redCount}v${blueCount}`);
}

/**
 * Chamado em onGameStop (sem vitória): apenas sincroniza flags.
 */
export function onGameStop() {
  gameActive = false;
}

export const teamState = {
  get red()    { return redCount; },
  get blue()   { return blueCount; },
  get active() { return gameActive; },
};
