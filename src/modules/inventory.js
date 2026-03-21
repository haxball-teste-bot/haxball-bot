// src/modules/inventory.js
import { sessionManager } from '../session/sessionManager.js';
import { formatCoins } from './economy.js';

/**
 * !itens — exibe os itens da pessoa e a quantidade dele.
 * @param {object} room
 * @param {object} player
 */
export async function cmdItens(room, player) {
  const session = sessionManager.get(player.id);

  if (!session) {
    room.sendAnnouncement(`❌ Registre-se primeiro para ver seu inventário.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  room.sendAnnouncement(`🎒 ═════ SEU INVENTÁRIO ═════`, player.id, 0xF0E68C, 'normal', 0);

  // VIP Status
  if (session.is_vip && session.vipExpiresAt) {
    const expiry = new Date(session.vipExpiresAt);
    const now = new Date();
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      room.sendAnnouncement(`💎 VIP ATIVO — Restam: ${diffDays} dias`, player.id, 0xA8E6CF, 'bold', 0);
    } else {
       room.sendAnnouncement(`💎 VIP — Expirado`, player.id, 0xFF8B94, 'normal', 0);
    }
  } else if (session.is_vip) {
    room.sendAnnouncement(`💎 VIP ATIVO (Permanente/Legado)`, player.id, 0xA8E6CF, 'bold', 0);
  } else {
    room.sendAnnouncement(`💎 Sem VIP ativo`, player.id, 0xCCCCCC, 'normal', 0);
  }

  // Itens consumíveis
  let hasItems = false;
  if (session.inventory && session.inventory.size > 0) {
    for (const [key, qty] of session.inventory.entries()) {
      if (qty > 0) {
        const itemLabel = key === 'jump' ? 'Pular Fila' : key;
        room.sendAnnouncement(`📦 ${itemLabel}: ${qty} unidade(s)`, player.id, 0xFFFFFF, 'normal', 0);
        hasItems = true;
      }
    }
  }

  if (!hasItems) {
    room.sendAnnouncement(`📦 Nenhum item consumível no momento.`, player.id, 0xCCCCCC, 'normal', 0);
  }

  room.sendAnnouncement(`🎒 ═════════════════════════`, player.id, 0xF0E68C, 'normal', 0);
}
