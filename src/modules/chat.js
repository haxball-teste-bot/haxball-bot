// src/modules/chat.js
// Formatação de mensagens de chat com prefixos de cargo e rating.
// Cores sofisticadas e não-chamativas para um ar premium.

import { sessionManager } from '../session/sessionManager.js';

const COLORS = {
  admin: 0xE97451, // Soft Coral
  vip:   0xF0E68C, // Khaki / Soft Gold
  user:  0xE0E0E0, // Soft White
  guest: 0xAAAAAA, // Medium Grey
};

const PREFIXES = {
  admin: '⚙️',
  vip:   '💎',
  user:  '👤',
  guest: '',
};

export function getPlayerRank(session) {
  if (!session) return 'guest';
  if (session.is_admin) return 'admin';
  if (session.is_vip)   return 'vip';
  return 'user';
}

/**
 * Formata e reenvia mensagem com prefixo de cargo e rating após o nome.
 * @param {object} room
 * @param {object} player
 * @param {string} message
 */
export function broadcastChat(room, player, message) {
  const session = sessionManager.get(player.id);
  const rank    = getPlayerRank(session);
  const prefix  = PREFIXES[rank];
  const color   = COLORS[rank];
  const style   = 'normal'; // Mantendo normal para ser discreto e elegante

  // Rating exibido após o nome — somente para jogadores registrados
  const ratingTag = session?.rating != null ? ` | (${session.rating})` : '';

  const name = session?.haxball_name ?? player.name;
  const formatted = prefix
    ? `${prefix} ${name}${ratingTag}: ${message}`
    : `${name}${ratingTag}: ${message}`;

  room.sendAnnouncement(formatted, null, color, style, 0);
}
