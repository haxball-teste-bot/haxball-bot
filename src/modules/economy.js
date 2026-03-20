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

/** Formata centavos para exibição: 1000 → "10,00" */
export function formatBalance(cents) {
  const n = Number(cents);
  if (isNaN(n)) return '0,00';
  return (n / 100).toFixed(2).replace('.', ',');
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
    `💰 ${player.name}, seu saldo atual: R$ ${formatBalance(session.balance)}`,
    player.id, 0x00CCFF, 'bold', 1
  );
}

/**
 * !addmoney <valor> [nick] — Adiciona saldo ao jogador (Somente Admins).
 * Se o nick não for informado, adiciona para quem digitou. O alvo deve estar na sala.
 *
 * @param {object} room
 * @param {object} player
 * @param {string[]} args - args[0] = valor, args[1..] = nick (opcional)
 */
export async function cmdAddMoney(room, player, args) {
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
      `⚠️ Uso correto: !addmoney <valor> [nick] (ex: !addmoney 500 = R$ 5,00)`,
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
  logger.info(`[Economy] Admin "${player.name}" adicionou +${amount} centavos para "${targetSession.haxball_name}".`);

  if (targetId === player.id) {
    room.sendAnnouncement(
      `✅ Recarga de R$ ${formatBalance(amount)} aplicada a você. Novo saldo: R$ ${formatBalance(newBalance)}`,
      player.id, 0xA8E6CF, 'normal', 2
    );
  } else {
    room.sendAnnouncement(
      `✅ Recarga de R$ ${formatBalance(amount)} aplicada para ${targetSession.haxball_name}.`,
      player.id, 0xA8E6CF, 'normal', 2
    );
    room.sendAnnouncement(
      `💰 Você recebeu R$ ${formatBalance(amount)} do Admin ${player.name}!`,
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
