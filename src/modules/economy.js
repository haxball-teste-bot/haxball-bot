// src/modules/economy.js
// Módulo de economia — gerencia saldo e rating do jogador.
//
// Tabelas usadas (schema.sql):
//   - user_info: actual_balance (text), rating (integer)
//   - money_recharge: log de recargas (id_user, balance_recharged)


import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Formata valor para exibição em Coins: 1000 → "1.000 Coins" */
export function formatCoins(amount) {
  const n = Number(amount);
  if (isNaN(n)) return '0 Coins';
  // Formata com separador de milhar (ponto) e sufixo "Coins"
  return n.toLocaleString('pt-BR') + ' Coins';
}

/**
 * !saldo — Mostra o saldo atual do jogador.
 * @param {object} room - RoomObject HaxBall
 * @param {object} player - PlayerObject HaxBall
 */
export function cmdSaldo(room, player) {
  const session = sessionManager.get(player.id);

  if (!session) {
    room.sendAnnouncement(
      `❌ ${player.name}, você precisa se registrar primeiro. Use !register`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  room.sendAnnouncement(
    `💰 ${player.name}, seu saldo atual: ${formatCoins(session.balance)}`,
    player.id, 0x00CCFF, 'bold', 1
  );
}

/**
 * !addcoins <valor> [nick] — Adiciona moedas ao jogador (Somente Admins).
 * Se o nick não for informado, adiciona para quem digitou. O alvo deve estar na sala.
 *
 * @param {object} room
 * @param {object} player
 * @param {string[]} args - args[0] = valor, args[1..] = nick (opcional)
 */
export async function cmdAddCoins(room, player, args) {
  const adminSession = sessionManager.get(player.id);

  if (!adminSession?.is_admin) {
    room.sendAnnouncement(
      `❌ Comando restrito para administradores.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  const amount = parseInt(args[0], 10);
  if (!args[0] || isNaN(amount) || amount <= 0) {
    room.sendAnnouncement(
      `⚠️ Uso correto: !addcoins <valor> [nick] (ex: !addcoins 1000)`,
      player.id, 0xFFD3B6, 'normal', 1
    );
    return;
  }

  // Define target: se houver args[1+], procura pelo nick. Senão, é o próprio admin.
  let targetSession = null;
  let targetId = null;

  if (args.length > 1) {
    const targetNick = args.slice(1).join(' ').toLowerCase();
    const allIds = sessionManager.allIds();
    for (const pid of allIds) {
      const s = sessionManager.get(pid);
      if (s?.haxball_name.toLowerCase() === targetNick || s?.haxball_name.toLowerCase().includes(targetNick)) {
        targetSession = s;
        targetId = pid;
        break;
      }
    }

    if (!targetSession) {
      room.sendAnnouncement(
        `❌ Jogador "${targetNick}" não encontrado na sala.`,
        player.id, 0xFF8B94, 'normal', 1
      );
      return;
    }
  } else {
    targetSession = adminSession;
    targetId = player.id;
  }

  const newBalance = targetSession.balance + amount;

  // Atualiza no banco
  const { error: updateError } = await dbCall(() =>
    supabase
      .from('user_info')
      .update({ actual_balance: String(newBalance) })
      .eq('id', targetSession.dbId)
  );

  if (updateError) {
    room.sendAnnouncement(
      `❌ Erro ao atualizar saldo. Tente novamente.`,
      player.id, 0xFF4444, 'bold', 1
    );
    return;
  }

  // Registra no banco
  await dbCall(() =>
    supabase.from('money_recharge').insert({
      id_user: targetSession.dbId,
      balance_recharged: amount,
    })
  );

  // Atualiza sessão
  sessionManager.patch(targetId, { balance: newBalance });
  logger.info(`[Economy] Admin "${player.name}" adicionou +${amount} coins para "${targetSession.haxball_name}".`);

  if (targetId === player.id) {
    room.sendAnnouncement(
      `✅ Recarga de ${formatCoins(amount)} aplicada a você. Novo saldo: ${formatCoins(newBalance)}`,
      player.id, 0xA8E6CF, 'normal', 2
    );
  } else {
    room.sendAnnouncement(
      `✅ Recarga de ${formatCoins(amount)} aplicada para ${targetSession.haxball_name}.`,
      player.id, 0xA8E6CF, 'normal', 2
    );
    room.sendAnnouncement(
      `💰 Você recebeu ${formatCoins(amount)} do Admin ${player.name}!`,
      targetId, 0xA8E6CF, 'normal', 2
    );
  }
}

/**
 * !rating — Mostra o rating atual do jogador.
 */
export function cmdRating(room, player) {
  const session = sessionManager.get(player.id);

  if (!session) {
    room.sendAnnouncement(
      `❌ ${player.name}, você precisa se registrar. Use !register`,
      player.id, 0xFF4444, 'bold', 1
    );
    return;
  }

  const rating = session.rating ?? 1000;
  room.sendAnnouncement(
    `🏅 ${player.name}, seu rating atual: ${rating}`,
    player.id, 0x00CCFF, 'bold', 1
  );
}

/**
 * !status [nick] — Exibe estatísticas completas de um jogador.
 */
export async function cmdStatus(room, player, args) {
  let targetNick = args.join(' ').trim();
  let targetUser = null;

  if (targetNick) {
    // Busca por nick no banco
    const { data, error } = await dbCall(() =>
      supabase
        .from('user_info')
        .select('id, haxball_name, rating')
        .ilike('haxball_name', `%${targetNick}%`)
        .maybeSingle()
    );
    if (!data || error) {
      room.sendAnnouncement(`❌ Jogador "${targetNick}" não encontrado no banco.`, player.id, 0xFF8B94, 'normal', 1);
      return;
    }
    targetUser = data;
  } else {
    // Status do próprio jogador
    const session = sessionManager.get(player.id);
    if (!session) {
      room.sendAnnouncement(`❌ Você precisa se registrar primeiro.`, player.id, 0xFF8B94, 'normal', 1);
      return;
    }
    targetUser = { id: session.dbId, haxball_name: session.haxball_name, rating: session.rating };
  }

  // Busca estatísticas acumuladas
  const { data: statsData, error: statsError } = await dbCall(() =>
    supabase
      .from('match_stats')
      .select('goals, assists, passes, team, matches(winner_team)')
      .eq('user_id', targetUser.id)
  );

  if (statsError || !statsData) {
    room.sendAnnouncement(`❌ Erro ao buscar estatísticas de ${targetUser.haxball_name}.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  const totalMatches = statsData.length;
  if (totalMatches === 0) {
    room.sendAnnouncement(`📊 ${targetUser.haxball_name} ainda não jogou nenhuma partida registrada.`, player.id, 0x00CCFF, 'bold', 1);
    return;
  }

  let totalGoals = 0;
  let totalPasses = 0;
  let wins = 0;
  let losses = 0;

  statsData.forEach(s => {
    totalGoals += s.goals || 0;
    totalPasses += s.passes || 0;
    
    const winner = s.matches?.winner_team;
    if (winner !== null && winner !== 0) {
      if (s.team === winner) wins++;
      else losses++;
    }
  });

  const winRate = ((wins / totalMatches) * 100).toFixed(1);
  const goalsPerMatch = (totalGoals / totalMatches).toFixed(2);

  room.sendAnnouncement(`📊 STATUS: ${targetUser.haxball_name.toUpperCase()} (Rating: ${targetUser.rating})`, player.id, 0xF0E68C, 'bold', 1);
  room.sendAnnouncement(`⚽ Gols: ${totalGoals} (${goalsPerMatch}/jogo)`, player.id, 0xFFFFFF, 'normal', 1);
  room.sendAnnouncement(`🤝 Passes: ${totalPasses} | 🏟️ Jogos: ${totalMatches}`, player.id, 0xFFFFFF, 'normal', 1);
  room.sendAnnouncement(`✅ Vitórias: ${wins} | ❌ Derrotas: ${losses} | 🔥 Win Rate: ${winRate}%`, player.id, 0xFFFFFF, 'normal', 1);
}

/**
 * !top — Exibe o ranking dos 10 melhores jogadores por rating.
 */
export async function cmdTop(room, player) {
  const { data, error } = await dbCall(() =>
    supabase
      .from('user_info')
      .select('haxball_name, rating')
      .order('rating', { ascending: false })
      .limit(10)
  );

  if (error || !data) {
    room.sendAnnouncement(`❌ Erro ao carregar o ranking.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  room.sendAnnouncement(`🏆 TOP 10 RANKING 🏆`, player.id, 0xFFD700, 'bold', 1);
  data.forEach((u, i) => {
    const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}.`));
    room.sendAnnouncement(`${medal} ${u.haxball_name} — Rating: ${u.rating}`, player.id, 0xFFFFFF, 'normal', 1);
  });
}
