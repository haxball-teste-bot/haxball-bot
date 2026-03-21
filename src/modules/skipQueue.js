// src/modules/skipQueue.js
// Sistema de pular fila com cooldown por cargo e item comprado.
//
// Regras de cooldown:
//   VIP   → 1 uso grátis a cada 15 minutos
//   Admin → 1 uso grátis a cada 1 minuto
//   Item  → comprar "jump" reseta o cooldown imediatamente (uso instantâneo)
//
// O cooldown é verificado na sessão (skip_queue_used_at) e persistido no banco.
// Quando o item "jump" é comprado na loja, a loja chama resetSkipCooldown().

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { queueManager } from './queueManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Cooldowns em milisegundos
const COOLDOWN_VIP_MS   = 15 * 60 * 1000; //  15 minutos
const COOLDOWN_ADMIN_MS =  1 * 60 * 1000; //   1 minuto

/**
 * Verifica se o jogador pode pular fila com base no cargo e cooldown.
 * @param {object} session - SessionData do jogador
 * @returns {{ allowed: boolean, reason?: string, cooldownLeft?: number }}
 */
function checkCooldown(session) {
  const now = Date.now();
  const lastUsed = session.skipQueueUsedAt ? new Date(session.skipQueueUsedAt).getTime() : 0;

  let cooldownMs = null;

  if (session.is_admin) {
    cooldownMs = COOLDOWN_ADMIN_MS;
  } else if (session.is_vip) {
    cooldownMs = COOLDOWN_VIP_MS;
  } else {
    // Para não-VIP/não-Admin, verifica o inventário
    const qty = session.inventory.get('jump') || 0;
    if (qty > 0) {
      return { allowed: true, useInventory: true };
    }
    return { allowed: false, reason: 'Apenas VIPs e Admins podem pular fila de graça. Compre "Pular Fila" na !loja!' };
  }

  const elapsed = now - lastUsed;
  if (elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
    return { allowed: false, reason: `Cooldown ativo. Tente novamente em ${timeStr}.`, cooldownLeft: remaining };
  }

  return { allowed: true };
}

/**
 * !pulafila — Move o jogador para o topo da fila.
 * @param {object} room
 * @param {object} player
 */
export async function cmdSkipQueue(room, player) {
  const session = sessionManager.get(player.id);

  if (!session) {
    room.sendAnnouncement(
      `❌ ${player.name}, você precisa estar registrado. Use !register`,
      player.id, 0xDDDDDD, 'normal', 1
    );
    return;
  }

  // Verifica se está na fila (espectadores)
  if (!queueManager.isInQueue(player.id)) {
    room.sendAnnouncement(
      `⚠️ ${player.name}, você não está na fila. Pular fila só funciona para espectadores aguardando.`,
      player.id, 0xDDDDDD, 'normal', 1
    );
    return;
  }

  const pos = queueManager.position(player.id);
  if (pos === 1) {
    room.sendAnnouncement(
      `⚠️ ${player.name}, você já está no topo da fila!`,
      player.id, 0xDDDDDD, 'normal', 1
    );
    return;
  }

  // Verifica cooldown
  const check = checkCooldown(session);
  if (!check.allowed) {
    room.sendAnnouncement(
      `⏳ ${player.name}, ${check.reason}`,
      player.id, 0xDDDDDD, 'normal', 1
    );
    return;
  }

  // Executa o pulo
  queueManager.moveToFront(player.id);

  if (check.useInventory) {
    // Consome item do inventário
    const newQty = session.inventory.get('jump') - 1;
    session.inventory.set('jump', newQty);
    
    await dbCall(() =>
      supabase
        .from('inventory')
        .update({ quantity: newQty })
        .eq('user_id', session.dbId)
        .eq('item_key', 'jump')
    );
    
    room.sendAnnouncement(`⚡ ${player.name} usou um item "Pular Fila" para ir ao topo!`, null, 0xA8E6CF, 'normal', 1);
  } else {
    // Atualiza timestamp de uso no banco e na sessão (VIP/Admin)
    const now = new Date().toISOString();
    await dbCall(() =>
      supabase
        .from('user_info')
        .update({ skip_queue_used_at: now })
        .eq('id', session.dbId)
    );
    sessionManager.patch(player.id, { skipQueueUsedAt: now });

    const cargo = session.is_admin ? '⚙️ Admin' : '💎 VIP';
    room.sendAnnouncement(
      `⚡ ${player.name} [${cargo}] pulou para o topo da fila!`,
      null, 0xA8E6CF, 'normal', 1
    );
  }
  logger.info(`[SkipQueue] "${player.name}" pulou para o topo da fila.`);
}

/**
 * Reseta o cooldown de pular fila (chamado pela loja ao comprar item "jump").
 * @param {number} playerId
 */
export function resetSkipCooldown(playerId) {
  sessionManager.patch(playerId, { skipQueueUsedAt: null });
  logger.info(`[SkipQueue] Cooldown resetado para playerId=${playerId} (item jump comprado).`);
}

/**
 * !fila — Exibe a fila atual de espectadores.
 * @param {object} room
 * @param {object} player
 */
export function cmdViewQueue(room, player) {
  const snapshot = queueManager.snapshot();

  if (snapshot.length === 0) {
    room.sendAnnouncement(`📋 Fila vazia.`, player.id, 0xDDDDDD, 'normal', 0);
    return;
  }

  room.sendAnnouncement(`📋 ══ FILA DE ESPERA (${snapshot.length}) ══`, player.id, 0xDDDDDD, 'normal', 0);
  snapshot.forEach((pid, i) => {
    const s = sessionManager.get(pid);
    const name = s?.haxball_name ?? `Player#${pid}`;
    const badge = s?.is_admin ? '⚙️' : s?.is_vip ? '💎' : '';
    room.sendAnnouncement(`  ${i + 1}. ${badge} ${name}`, player.id, 0xCCCCCC, 'normal', 0);
  });
}
