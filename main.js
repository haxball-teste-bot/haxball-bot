// main.js
// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap da sala HaxBall Headless — Fase 2
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import puppeteer from 'puppeteer';

import { roomConfig }   from './src/config/room.js';
import { STADIUM_HBS } from './src/config/stadium.js';
import { sessionManager } from './src/session/sessionManager.js';
import { logger }         from './src/utils/logger.js';
import { safeAsync }      from './src/utils/errors.js';

// ── Auth ──
import {
  loadPlayerSession,
  registerPlayer,
  capturePlayerAuth,
  releasePlayerAuth,
} from './src/modules/auth.js';
import { cmdLogin } from './src/modules/altLogin.js';

// ── Economia ──
import { cmdSaldo, cmdAddCoins, cmdRating } from './src/modules/economy.js';

// ── Loja ──
import { cmdShop, cmdBuy } from './src/modules/shop.js';

// ── Permissões ──
import { cmdGetAdmin } from './src/modules/permissions.js';

// ── Inventário & Ban ──
import { cmdItens } from './src/modules/inventory.js';
import { cmdTempBan } from './src/modules/tempBan.js';

// ── Ajuda ──
import { cmdHelp } from './src/modules/help.js';

// ── Chat ──
import { broadcastChat } from './src/modules/chat.js';

// ── Match Stats / Rating ──
import {
  startMatch,
  registerKick,
  registerGoal,
  finalizeMatch,
  getLastKickerName,
} from './src/modules/matchStats.js';

// ── Fila + Pick + Skip ──
import { queueManager }          from './src/modules/queueManager.js';
import { cmdSkipQueue, cmdViewQueue } from './src/modules/skipQueue.js';
import { afkManager }            from './src/modules/afkManager.js';
import {
  tryPick,
  cancelPick,
  isPickActive,
  getPickerPlayerId,
} from './src/modules/pickManager.js';

// ── Distribuição de Times (substitui autoTeam) ──
import {
  onPlayerJoin  as teamOnJoin,
  onPlayerLeave as teamOnLeave,
  onMatchEnd,
  onGameStart   as teamOnGameStart,
  onGameStop    as teamOnGameStop,
  teamState,
  balanceTeams,
} from './src/modules/teamDistribution.js';

// ──────────────────────────────────────────────────────
// Referência global à página Puppeteer
// ──────────────────────────────────────────────────────
let page;

// Placar acumulado (atualizado via onTeamGoal)
let redScore  = 0;
let blueScore = 0;

// ──────────────────────────────────────────────────────
// Wrappers de API HaxBall → page.evaluate()
// ──────────────────────────────────────────────────────

async function sendAnn(msg, targetId = null, color = null, style = 'normal', sound = 0) {
  if (!page) return;
  await page.evaluate(
    (m, t, c, s, snd) => window.__room.sendAnnouncement(m, t, c, s, snd),
    msg, targetId, color, style, sound
  ).catch(err => logger.error('[Room] sendAnnouncement:', err.message));
}

async function setTeam(playerId, teamId) {
  if (!page) return;
  await page.evaluate(
    (pid, tid) => window.__room.setPlayerTeam(pid, tid),
    playerId, teamId
  ).catch(err => logger.error('[Room] setPlayerTeam:', err.message));
}

async function setAdmin(playerId, bool) {
  if (!page) return;
  await page.evaluate(
    (pid, b) => window.__room.setPlayerAdmin(pid, b),
    playerId, bool
  ).catch(err => logger.error('[Room] setPlayerAdmin:', err.message));
}

async function startGame() {
  if (!page) return;
  await page.evaluate(() => window.__room.startGame())
    .catch(err => logger.error('[Room] startGame:', err.message));
}

async function stopGame() {
  if (!page) return;
  await page.evaluate(() => window.__room.stopGame())
    .catch(err => logger.error('[Room] stopGame:', err.message));
}

async function kickPlayer(playerId, reason = '', ban = false) {
  if (!page) return;
  await page.evaluate(
    (pid, r, b) => window.__room.kickPlayer(pid, r, b),
    playerId, reason, ban
  ).catch(err => logger.error('[Room] kickPlayer:', err.message));
}

/** getPlayerList() — retorna array de PlayerObject do browser */
async function getPlayers() {
  if (!page) return [];
  return page.evaluate(() => window.__room.getPlayerList())
    .catch(() => []);
}

async function setPlayerNameFallback(playerId, name) {
  if (!page) return;
  await page.evaluate(
    (pid, n) => {
      if (typeof window.__room.setPlayerName === 'function') {
        window.__room.setPlayerName(pid, n);
      } else {
        window.__room.kickPlayer(pid, `⚠️ Mude seu nick para "${n}" e entre novamente.`, false);
      }
    },
    playerId, name
  ).catch(err => logger.error('[Room] setPlayerNameFallback:', err.message));
}

// ──────────────────────────────────────────────────────
// RoomProxy — expõe API HaxBall para os módulos Node
// ──────────────────────────────────────────────────────
const roomProxy = {
  sendAnnouncement: (msg, targetId, color, style, sound) => sendAnn(msg, targetId, color, style, sound),
  setPlayerAdmin:   (playerId, bool) => setAdmin(playerId, bool),
  setPlayerTeam:    (playerId, teamId) => setTeam(playerId, teamId),
  kickPlayer:       (playerId, reason, ban) => kickPlayer(playerId, reason, ban),
  startGame:        () => startGame(),
  stopGame:         () => stopGame(),
  getPlayerList:    () => getPlayers(),
  setPlayerNameFallback: (playerId, name) => setPlayerNameFallback(playerId, name),
};

// ──────────────────────────────────────────────────────
// Handlers de eventos
// ──────────────────────────────────────────────────────

const onPlayerJoin = safeAsync(async (player) => {
  logger.info(`[Join] ${player.name} (id=${player.id}, auth=${player.auth ?? 'null'})`);

  capturePlayerAuth(player);
  const result = await loadPlayerSession(player);

  if (result?.banned) {
    roomProxy.kickPlayer(player.id, `🚫 Você está banido por mais ${(new Date(result.expiresAt) - new Date()) / 60000 | 0} min. Motivo: ${result.reason || 'S/M'}`, false);
    return;
  }

  // Verificação de Nickname
  const session = sessionManager.get(player.id);
  if (session && session.haxball_name !== player.name) {
    logger.info(`[Auth] Nick mismatch: "${player.name}" deveria ser "${session.haxball_name}". Renomeando ou kickando.`);
    roomProxy.setPlayerNameFallback(player.id, session.haxball_name);
    // Continue allowing them to join, if they get kicked they will just leave.
    // If they get renamed, they can continue. But we'll just log this and return early if they are getting kicked?
    // In evaluate(), we can't await whether it kicked or not before continuing logic.
    // But teamOnJoin will just put them in spectate/play. If kicked, onPlayerLeave handles the cleanup.
  }

  // Distribuição de times
  teamOnJoin(roomProxy, player);

  // Mensagem de boas-vindas com rating
  if (session) {
    const rating = session.rating ?? 1000;
    await sendAnn(
      `👋 Bem-vindo de volta, ${player.name} [${rating}]!`,
      player.id, 0xDCDCDC, 'normal', 1
    );
  } else {
    await sendAnn(
      `👋 Olá, ${player.name}! Use !register para criar sua conta.`,
      player.id, 0xDCDCDC, 'normal', 1
    );
  }
}, 'onPlayerJoin');

const onPlayerLeave = safeAsync(async (player) => {
  logger.info(`[Leave] ${player.name} (id=${player.id})`);

  // Se o picker saiu, cancela o pick
  if (isPickActive() && getPickerPlayerId() === player.id) {
    cancelPick();
    await sendAnn(`⚠️ O picker saiu. Pick cancelado.`, null, 0xFFD3B6, 'normal', 1);
  }

  sessionManager.remove(player.id);
  releasePlayerAuth(player.id);
  teamOnLeave(roomProxy, player);
}, 'onPlayerLeave');

const onPlayerChat = safeAsync(async (player, message) => {
  const trimmed = message.trim();
  if (!trimmed) return;

  // ── Se há pick ativo e a mensagem NÃO é um comando, tenta processar como pick ──
  if (isPickActive() && !trimmed.startsWith('!')) {
    const players = await getPlayers();
    const consumed = tryPick(roomProxy, player, trimmed, players);
    if (consumed) return; // mensagem consumida pelo pick — não rebroadcast
  }

  if (!trimmed.startsWith('!')) {
    broadcastChat(roomProxy, player, trimmed);
    return;
  }

  const parts   = trimmed.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args    = parts.slice(1);

  logger.info(`[CMD] "${player.name}" → !${command}${args.length ? ' ' + args.join(' ') : ''}`);

  switch (command) {
    case 'register':
      await registerPlayer(roomProxy, player, args);
      break;

    // ── Conta / Login ──
    case 'login':
      await cmdLogin(roomProxy, player, args);
      // Se logou e era um nick diferente, o nome não vai bater,
      // mas o comando de login EXIGE que player.name === registered_name, 
      // então visualmente já está certo!
      break;

    // ── Economia ──
    case 'saldo':
    case 'balance':
      cmdSaldo(roomProxy, player);
      break;
    case 'addcoins':
    case 'recarga':
      await cmdAddCoins(roomProxy, player, args);
      break;
    case 'rating':
      cmdRating(roomProxy, player);
      break;

    // ── Loja ──
    case 'shop':
    case 'loja':
      await cmdShop(roomProxy, player);
      break;
    case 'buy':
    case 'comprar':
      await cmdBuy(roomProxy, player, args);
      break;

    case 'itens':
    case 'inventario':
      await cmdItens(roomProxy, player);
      break;

    case 'tempban':
      await cmdTempBan(roomProxy, player, args);
      break;

    // ── Fila / AFK ──
    case 'fila':
    case 'queue':
      cmdViewQueue(roomProxy, player);
      break;
    case 'pulafila':
    case 'skipqueue':
      await cmdSkipQueue(roomProxy, player);
      break;
    case 'afk':
      afkManager.toggleAfk(roomProxy, player, teamState.red, teamState.blue);
      setTimeout(() => balanceTeams(roomProxy), 250); // call balancer after processing
      break;
    case 'afks':
      afkManager.showAfks(roomProxy, player, await getPlayers());
      break;

    // ── Admin / Permissões ──
    case 'getadmin':
      cmdGetAdmin(roomProxy, player);
      break;

    // ── Ajuda / Outros ──
    case 'help':
    case 'ajuda':
    case 'h':
      cmdHelp(roomProxy, player);
      break;
    case 'bb':
      roomProxy.kickPlayer(player.id, '👋 Flw, até a próxima!', false);
      break;

    default:
      await sendAnn(
        `❓ Comando desconhecido: !${command}. Use !help`,
        player.id, 0xDDDDDD, 'normal', 0
      );
  }
}, 'onPlayerChat');

const onGameStart = safeAsync(async (byPlayer) => {
  logger.info(`[Game] Partida iniciada por: ${byPlayer?.name ?? 'sistema'}`);
  redScore  = 0;
  blueScore = 0;
  afkManager.setMatchStartTime(Date.now());

  const players = await getPlayers();
  teamOnGameStart(players);

  const red  = players.filter(p => p.team === 1).length;
  const blue = players.filter(p => p.team === 2).length;
  await startMatch(roomProxy, red, blue);
}, 'onGameStart');

const onGameStop = safeAsync(async (byPlayer) => {
  logger.info(`[Game] Partida encerrada por: ${byPlayer?.name ?? 'sistema'}`);
  teamOnGameStop();
  // Jogo parado manualmente (sem vitória) — finaliza sem vencedor
  await finalizeMatch(roomProxy, null, redScore, blueScore);
  redScore  = 0;
  blueScore = 0;
}, 'onGameStop');

// ── Gol marcado ──
// teamId = 1 (red marcou) ou 2 (blue marcou)
const onTeamGoal = safeAsync(async (teamId) => {
  if (teamId === 1) redScore++;
  else blueScore++;
  logger.info(`[Game] Gol do time ${teamId}. Placar: ${redScore}x${blueScore}`);
  
  const scorerName = getLastKickerName() || (teamId === 1 ? 'Vermelho' : 'Azul');

  // Custom Goal Message
  const messagesMsg = [
    `⚽ GOOOL!`,
    `🔥 Que bala!`,
    `💥 Cravou!`,
    `⚡ Golaço do caraio!`
  ];
  const randomMsg = messagesMsg[Math.floor(Math.random() * messagesMsg.length)];
  
  await sendAnn(`${randomMsg} ${scorerName} marcou!`, null, 0xA8E6CF, 'normal', 1);

  registerGoal(roomProxy, teamId);

  // Reiniciar partida se for 1v0
  if ((teamState.red === 1 && teamState.blue === 0) || (teamState.blue === 1 && teamState.red === 0)) {
    logger.info(`[Game] Reiniciando partida 1v0 após o gol.`);
    setTimeout(() => {
        roomProxy.stopGame();
        setTimeout(() => roomProxy.startGame(), 3000);
    }, 2000); // aguarda um pouco para ver o gol
  }
}, 'onTeamGoal');

// ── Troca de time ──
const onPlayerTeamChange = safeAsync(async (changedPlayer) => {
  logger.info(`[TeamDist] ${changedPlayer.name} mudou para o time ${changedPlayer.team}`);
  const players = await getPlayers();
  
  // Atualiza a Fila e os Contadores do Time
  queueManager.sync(players);
}, 'onPlayerTeamChange');

// ── Vitória de time (fim de partida com placar) ──
const onTeamVictory = safeAsync(async (scores) => {
  // scores = { red, blue } — vem do HaxBall
  const winnerTeam = scores.red > scores.blue ? 1 : 2;
  logger.info(`[Game] Vitória team ${winnerTeam}. Placar: ${scores.red}x${scores.blue}`);

  redScore  = scores.red;
  blueScore = scores.blue;

  await finalizeMatch(roomProxy, winnerTeam, scores.red, scores.blue);

  const players = await getPlayers();
  await onMatchEnd(roomProxy, winnerTeam, players);
}, 'onTeamVictory');

// ── Chute na bola ── (para tracking de gols/assistências)
const onPlayerBallKick = safeAsync(async (player) => {
  registerKick(player);
}, 'onPlayerBallKick');

const onRoomLink = safeAsync(async (url) => {
  logger.info(`[Room] Sala disponível em: ${url}`);
}, 'onRoomLink');

// ──────────────────────────────────────────────────────
// Inicialização
// ──────────────────────────────────────────────────────

async function bootstrap() {
  logger.info('[Boot] Iniciando HaxBall Headless Host — Fase 2...');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  });

  page = await browser.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') logger.error('[Browser]', text);
    else logger.info('[Browser]', text);
  });
  page.on('pageerror', err => logger.error('[Browser] Page error:', err.message));

  // ── Expõe funções Node → browser ANTES da navegação ──
  await page.exposeFunction('__nodeOnPlayerJoin',    onPlayerJoin);
  await page.exposeFunction('__nodeOnPlayerLeave',   onPlayerLeave);
  await page.exposeFunction('__nodeOnPlayerChat',    onPlayerChat);
  await page.exposeFunction('__nodeOnGameStart',     onGameStart);
  await page.exposeFunction('__nodeOnGameStop',      onGameStop);
  await page.exposeFunction('__nodeOnTeamGoal',      onTeamGoal);
  await page.exposeFunction('__nodeOnTeamVictory',   onTeamVictory);
  await page.exposeFunction('__nodeOnPlayerBallKick',onPlayerBallKick);
  await page.exposeFunction('__nodeOnPlayerTeamChange', onPlayerTeamChange);
  await page.exposeFunction('__nodeOnRoomLink',      onRoomLink);
  await page.exposeFunction('__nodeOnPlayerActivity', (p) => afkManager.updateActivity(p.id));

  // ── Injeta window.onHBLoaded ANTES da navegação (crítico!) ──
  await page.evaluateOnNewDocument((config, stadiumHbs) => {
    window.onHBLoaded = function () {
      console.log('[HaxBall] onHBLoaded — inicializando sala Fase 2...');
      const room = HBInit(config);
      window.__room = room;

      room.setCustomStadium(stadiumHbs);
      room.setScoreLimit(3);
      room.setTimeLimit(3); // 3 minutos
      room.setTeamsLock(true);

      console.log('[HaxBall] Sala configurada. Aguardando conexões...');

      room.onPlayerJoin     = p       => __nodeOnPlayerJoin(p);
      room.onPlayerLeave    = p       => __nodeOnPlayerLeave(p);
      room.onPlayerChat     = (p, m)  => { __nodeOnPlayerChat(p, m); return false; };
      room.onGameStart      = p       => __nodeOnGameStart(p);
      room.onGameStop       = p       => __nodeOnGameStop(p);
      room.onTeamGoal       = t       => __nodeOnTeamGoal(t);
      room.onTeamVictory    = s       => __nodeOnTeamVictory(s);
      room.onPlayerBallKick = p       => __nodeOnPlayerBallKick(p);
      room.onPlayerTeamChange = p     => __nodeOnPlayerTeamChange(p);
      room.onPlayerActivity   = p     => __nodeOnPlayerActivity(p);
      room.onRoomLink       = url     => { console.log('[HaxBall] Link: ' + url); __nodeOnRoomLink(url); };
    };
  }, roomConfig, STADIUM_HBS);

  afkManager.startIdleChecker(roomProxy, getPlayers);

  logger.info('[Boot] Navegando para HaxBall Headless Host...');
  await page.goto('https://html5.haxball.com/headless', { waitUntil: 'domcontentloaded' });
  logger.info('[Boot] Pronto. Aguardando link da sala...');
}

// ── Entry point ──
bootstrap().catch(err => {
  logger.error('[Boot] Falha crítica:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Process] UnhandledRejection:', String(reason));
});
