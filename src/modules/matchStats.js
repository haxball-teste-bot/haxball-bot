// src/modules/matchStats.js
// Coleta de estatísticas de partida em memória.
// Os dados são persistidos no banco apenas ao fim de cada partida (onGameStop).
//
// LIMITAÇÕES REAIS DA API HAXBALL — como rastreamos gols e assistências:
//
//   A API fornece:
//     - onTeamGoal(team)     → qual time marcou, mas NÃO quem chutou
//     - onPlayerBallKick(player) → qual jogador chutou a bola (qualquer toque)
//     - onPositionsReset()   → chamado após cada gol (posições resetadas)
//
//   APROXIMAÇÃO TÉCNICA (padrão da comunidade HaxBall):
//     - Último jogador a chutar antes do gol → marcador do gol
//     - Penúltimo jogador a chutar (se for do mesmo time) → assistência
//     - Se o marcador for do time adversário → gol contra
//
//   NOTA: Essa aproximação tem casos extremos (ex: desvios de bola),
//   mas é a melhor solução disponível dentro da API oficial.

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { RATING, COINS } from '../config/ratingConfig.js';

// ── Estado interno da partida atual ──────────────────────────────────────────

/** ID da partida atual no banco (null = sem partida) */
let currentMatchId = null;

/** true se a partida atual for competitiva (conta rating) */
let isCompetitive = false;

/** Estado de Streak (Vitórias Seguidas) */
let currentStreak = 0;
let lastWinnerTeam = 0; // 1=red, 2=blue

/** Map<playerId, { goals, assists, ownGoals, saves, passes, team, coinsEarned }> */
const statsMap = new Map();

/** Últimos dois chutadores: [mais recente, anterior] */
let lastKickers = [null, null]; // [{ playerId, team, x, y }, { playerId, team, x, y }]

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Inicializa o tracking da partida.
 * Chamado em onGameStart. Cria linha na tabela matches.
 * @param {object} room
 * @param {number} redCount - jogadores no time vermelho
 * @param {number} blueCount - jogadores no time azul
 */
export async function startMatch(room, redCount, blueCount) {
  statsMap.clear();
  lastKickers = [null, null];

  // Partida é competitiva se cada time tiver pelo menos 3 jogadores (3v3)
  isCompetitive = (redCount >= 3 && blueCount >= 3);

  const { data, error } = await dbCall(() =>
    supabase
      .from('matches')
      .insert({ is_competitive: isCompetitive })
      .select('id')
      .single()
  );

  if (error || !data) {
    logger.error('[MatchStats] Falha ao criar partida no banco.');
    currentMatchId = null;
    return;
  }

  currentMatchId = data.id;

  // Registra jogadores ativos na partida (vindos da sessão)
  const allIds = sessionManager.allIds();
  for (const pid of allIds) {
    const session = sessionManager.get(pid);
    if (!session) continue;
    // Verificar time será feito dinamicamente via onPlayerTeamChange ou estado da sessão
    // Por ora inicializamos sem time — será setado no primeiro toque ou goal
    statsMap.set(pid, { goals: 0, assists: 0, ownGoals: 0, saves: 0, passes: 0, team: 0, coinsEarned: 0 });
  }

  logger.info(`[MatchStats] Partida ${currentMatchId} iniciada (competitiva=${isCompetitive}, ${redCount}v${blueCount})`);

  if (!isCompetitive) {
    room.sendAnnouncement(
      `⚠️ Partida não competitiva — rating e resultados não serão contabilizados.`,
      null, 0xFF8800, 'small-italic', 0
    );
  }
}

/**
 * Registra um chute de bola.
 * Chamado em onPlayerBallKick. Atualiza a fila de últimos chutadores.
 * @param {object} player - PlayerObject HaxBall
 */
export function registerKick(player) {
  const kicker = { playerId: player.id, team: player.team, x: player.x, y: player.y };

  // 1. Detecção de Passe
  // Se o último chutador era do mesmo time e não era o próprio jogador
  if (lastKickers[0] && lastKickers[0].team === player.team && lastKickers[0].playerId !== player.id) {
    const passStats = statsMap.get(lastKickers[0].playerId);
    if (passStats) {
      passStats.passes++;
      passStats.coinsEarned += COINS.PASS;
    }
  }

  // 2. Detecção de Defesa (Save)
  // Se o jogador chutou na sua própria área de defesa (Red < -400, Blue > 400)
  const isDefenseArea = (player.team === 1 && player.x < -400) || (player.team === 2 && player.x > 400);
  if (isDefenseArea) {
    const defenseStats = statsMap.get(player.id);
    if (defenseStats) {
      defenseStats.saves++;
      defenseStats.coinsEarned += COINS.SAVE;
    }
  }

  lastKickers = [kicker, lastKickers[0]]; // desloca a fila

  // Registra time do jogador nas stats
  if (statsMap.has(player.id)) {
    const s = statsMap.get(player.id);
    if (s.team === 0) s.team = player.team; // seta time na primeira ocorrência
  } else {
    statsMap.set(player.id, { goals: 0, assists: 0, ownGoals: 0, saves: 0, passes: 0, team: player.team, coinsEarned: 0 });
  }
}

export function getLastKickerName() {
  const scorer = lastKickers[0];
  if (!scorer) return null;
  const session = sessionManager.get(scorer.playerId);
  return session?.haxball_name || null;
}

/**
 * Registra um gol.
 * Chamado em onTeamGoal. Determina marcador e assistência via lastKickers.
 * @param {object} room
 * @param {number} teamId - time que marcou (1=red, 2=blue)
 */
export function registerGoal(room, teamId) {
  if (!currentMatchId) return;

  const scorer  = lastKickers[0]; // último a chutar
  const assister = lastKickers[1]; // penúltimo a chutar

  if (!scorer) {
    logger.warn('[MatchStats] Gol sem chutador rastreado (primeiro toque da partida?)');
    return;
  }

  const isOwnGoal = scorer.team !== teamId; // marcou no próprio gol

  const scorerStats = statsMap.get(scorer.playerId);
  if (scorerStats) {
    if (isOwnGoal) {
      scorerStats.ownGoals++;
      logger.info(`[MatchStats] Gol contra de playerId=${scorer.playerId}`);
    } else {
      scorerStats.goals++;
      scorerStats.coinsEarned += COINS.GOAL;
      logger.info(`[MatchStats] Gol de playerId=${scorer.playerId}`);
    }
  }

  // Assistência: penúltimo chutador, mesmo time que o marcador e não é o mesmo jogador
  if (
    !isOwnGoal &&
    assister &&
    assister.team === scorer.team &&
    assister.playerId !== scorer.playerId
  ) {
    const assisterStats = statsMap.get(assister.playerId);
    if (assisterStats) {
      assisterStats.assists++;
      logger.info(`[MatchStats] Assistência de playerId=${assister.playerId}`);
    }
  }

  // Reset lastKickers após gol (posições serão resetadas pelo onPositionsReset)
  lastKickers = [null, null];
}

/**
 * Finaliza a partida, calcula rating e persiste no banco.
 * Chamado em onGameStop.
 * @param {object} room
 * @param {number|null} winnerTeam - 1=red, 2=blue, 0=empate, null=sem resultado
 * @param {number} redScore
 * @param {number} blueScore
 */
export async function finalizeMatch(room, winnerTeam, redScore, blueScore) {
  if (!currentMatchId) return;

  const matchId = currentMatchId;
  currentMatchId = null;

  // Atualiza a partida com resultado
  await dbCall(() =>
    supabase
      .from('matches')
      .update({
        ended_at: new Date().toISOString(),
        winner_team: winnerTeam ?? null,
        red_score: redScore ?? 0,
        blue_score: blueScore ?? 0,
      })
      .eq('id', matchId)
  );

  if (!isCompetitive) {
    logger.info('[MatchStats] Partida não competitiva — sem rating aplicado.');
    statsMap.clear();
    return;
  }

  // Calcula e aplica rating para cada jogador
  const ratingUpdates = [];

  for (const [playerId, stats] of statsMap.entries()) {
    const session = sessionManager.get(playerId);
    if (!session?.dbId || stats.team === 0) continue;

    // Pontos de eventos individuais
    let delta = 0;
    delta += stats.goals    * RATING.GOAL;
    delta += stats.assists  * RATING.ASSIST;
    delta += stats.ownGoals * RATING.OWN_GOAL;

    // Bônus/penalidade por resultado
    if (winnerTeam !== null && winnerTeam !== 0) {
      if (stats.team === winnerTeam)  delta += RATING.WIN;
      else                            delta += RATING.LOSS;
    }

    // Rating mínimo
    const newRating = Math.max(RATING.MIN_RATING, (session.rating ?? 1000) + delta);
    stats.ratingDelta = newRating - (session.rating ?? 1000);

    ratingUpdates.push({
      dbId:   session.dbId,
      playerId,
      matchId,
      stats,
      newRating,
      delta:  stats.ratingDelta,
    });
  }

  // ── Recompensa por Vitória (10 Coins) + Sistema de Streak ──
  if (winnerTeam !== null && winnerTeam !== 0) {
    // Atualiza Streak
    if (winnerTeam === lastWinnerTeam) {
      currentStreak++;
    } else {
      lastWinnerTeam = winnerTeam;
      currentStreak = 1;
    }

    const streakBonus = 1 + (0.1 * currentStreak); // 10% por streak (1.1x no 1º win, 1.2x no 2º, etc)
    const winners = [];
    
    for (const [playerId, stats] of statsMap.entries()) {
      if (stats.team === winnerTeam) {
        winners.push(playerId);
        stats.coinsEarned += COINS.WIN;
        
        // Aplica o multiplicador de streak no total de coins ganhos na partida
        stats.coinsEarned = Math.floor(stats.coinsEarned * streakBonus);
      }
    }

    if (winners.length > 0) {
      const teamName = winnerTeam === 1 ? 'Vermelho' : 'Azul';
      logger.info(`[Streak] Time ${teamName} agora com ${currentStreak} vitórias seguidas. Bônus: ${Math.round((streakBonus-1)*100)}%`);
    }
  } else {
    // Empate ou jogo parado reseta streak? O usuário não especificou. 
    // Geralmente empate mantém ou reseta. Vou manter o streak se não houver vencedor claro, 
    // mas se for 0x0 ou cancelado, talvez deva resetar. 
    // Vou resetar apenas se houver um perdedor, mas aqui winnerTeam é null ou 0.
    if (winnerTeam === 0) {
        currentStreak = 0;
        lastWinnerTeam = 0;
    }
  }

  // Persiste match_stats e atualiza rating/saldo em paralelo
  await Promise.all(ratingUpdates.map(async ({ dbId, playerId, matchId, stats, newRating, delta }) => {
    const session = sessionManager.get(playerId);
    if (!session) return;

    // 1. Insert em match_stats
    await dbCall(() =>
      supabase.from('match_stats').insert({
        match_id:    matchId,
        user_id:     dbId,
        team:        stats.team,
        goals:       stats.goals,
        assists:     stats.assists,
        own_goals:   stats.ownGoals,
        passes:      stats.passes,
        saves:       stats.saves,
        rating_delta: delta,
      })
    );

    // 2. Atualiza Rating e Saldo em user_info
    const newBalance = (session.balance || 0) + stats.coinsEarned;
    await dbCall(() =>
      supabase
        .from('user_info')
        .update({ 
          rating: newRating,
          actual_balance: String(newBalance)
        })
        .eq('id', dbId)
    );

    // 3. Atualiza sessão em memória
    sessionManager.patch(playerId, { 
      rating: newRating,
      balance: newBalance
    });

    logger.info(`[MatchStats] Finalizando player ${session.haxball_name}: Rating ${newRating} (${delta}), Saldo +${stats.coinsEarned}`);

    // 4. Envia Estatística Privada (Requisitado pelo usuário)
    const statsMsg = `📊 FIM DE JOGO: ⚽${stats.goals} Gols | 🛡️${stats.saves} Defesas | 🤝${stats.passes} Passes | ⚠️${stats.ownGoals} GC | 💰 +${stats.coinsEarned} Coins`;
    room.sendAnnouncement(statsMsg, playerId, 0x00FF7F, 'bold', 2);
  }));

  // Anuncia resultados no chat
  if (ratingUpdates.length > 0) {
    room.sendAnnouncement(`🏆 ══ RESULTADO DA PARTIDA ══`, null, 0xF0E68C, 'normal', 0);
    for (const { playerId, stats, delta } of ratingUpdates) {
      const session = sessionManager.get(playerId);
      if (!session) continue;
      const sign = delta >= 0 ? '+' : '';
      room.sendAnnouncement(
        `  ${session.haxball_name}: ⚽${stats.goals} 🅰️${stats.assists} | Rating: ${sign}${delta}`,
        null, delta >= 0 ? 0xA8E6CF : 0xFF8B94, 'normal', 0
      );
    }
    room.sendAnnouncement(`🏆 ═══════════════════════`, null, 0xF0E68C, 'normal', 0);
  }

  statsMap.clear();
  lastKickers = [null, null];
}

/** @returns {boolean} true se há partida em andamento */
export function isMatchActive() {
  return currentMatchId !== null;
}

/** Retorna informações do streak atual */
export function getStreakInfo() {
  return {
    streak: currentStreak,
    teamName: lastWinnerTeam === 1 ? 'Vermelho' : (lastWinnerTeam === 2 ? 'Azul' : 'Nenhum'),
    bonusPercent: Math.round(currentStreak * 10)
  };
}
