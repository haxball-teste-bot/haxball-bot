// src/modules/tempBan.js
import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatCoins } from './economy.js';

const TEMPBAN_COST = 5000;
const BAN_DURATION_MIN = 15;

/**
 * !tempban <nick> <motivo> — compra um tempban de 15 minutos de um jogador.
 * @param {object} roomProxy
 * @param {object} player
 * @param {string[]} args
 */
export async function cmdTempBan(roomProxy, player, args) {
  const session = sessionManager.get(player.id);
  if (!session) return;

  const targetSearch = args[0];
  const reason = args.slice(1).join(' ') || 'Nenhum motivo fornecido.';

  if (!targetSearch) {
    roomProxy.sendAnnouncement(`⚠️ Uso: !tempban <nick> <motivo> (Custo: ${formatCoins(TEMPBAN_COST)})`, player.id, 0xFFD3B6, 'normal', 1);
    return;
  }

  if (session.balance < TEMPBAN_COST) {
    roomProxy.sendAnnouncement(`❌ Saldo insuficiente! Você precisa de ${formatCoins(TEMPBAN_COST)}.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  // Busca o alvo na sala
  const allIds = sessionManager.allIds();
  let targetSession = null;
  let targetId = null;

  for (const pid of allIds) {
    const s = sessionManager.get(pid);
    if (s?.haxball_name.toLowerCase().includes(targetSearch.toLowerCase())) {
      targetSession = s;
      targetId = pid;
      break;
    }
  }

  if (!targetId || !targetSession) {
    roomProxy.sendAnnouncement(`❌ Jogador "${targetSearch}" não encontrado na sala.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  if (targetSession.is_admin) {
     roomProxy.sendAnnouncement(`❌ Você não pode banir um Admin.`, player.id, 0xFF8B94, 'normal', 1);
     return;
  }

  const expiresAt = new Date(Date.now() + BAN_DURATION_MIN * 60 * 1000).toISOString();

  // Deduz saldo
  const newBalance = session.balance - TEMPBAN_COST;
  const { error: updateError } = await dbCall(() =>
    supabase
      .from('user_info')
      .update({ actual_balance: String(newBalance) })
      .eq('id', session.dbId)
  );

  if (updateError) {
    roomProxy.sendAnnouncement(`❌ Erro ao processar compra.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  sessionManager.patch(player.id, { balance: newBalance });

  // Registra banimento
  await dbCall(() =>
    supabase.from('temp_bans').insert({
      auth_key: targetSession.auth_key,
      expires_at: expiresAt,
      reason: reason,
    })
  );

  logger.info(`[TempBan] "${player.name}" baniu "${targetSession.haxball_name}" por 15 min. Motivo: ${reason}`);

  roomProxy.sendAnnouncement(`🚫 ${targetSession.haxball_name} foi banido temporariamente por ${player.name}! (${BAN_DURATION_MIN} min)`, null, 0xFFB7B2, 'bold', 2);
  
  // Kicka o jogador
  roomProxy.kickPlayer(targetId, `🚫 Você foi banido por 15 min. Comprado por ${player.name}. Motivo: ${reason}`, false);
}
