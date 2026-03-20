// src/modules/permissions.js
// Sistema de admin baseado no banco de dados.
//
// Comportamento do !getadmin:
//   - Verificar is_admin na sessão (carregado do campo user_info.is_admin)
//   - Se não tiver permissão no banco → negar com mensagem
//   - Se tiver permissão → TOGGLE:
//       • Jogador sem admin na sala → setPlayerAdmin(id, true)
//       • Jogador com admin na sala → setPlayerAdmin(id, false)
//
// ATENÇÃO: setPlayerAdmin é ASSÍNCRONO.
// A documentação oficial alerta que mudanças de estado não são imediatas.
// Por isso NÃO lemos player.admin logo após chamar setPlayerAdmin.
// Usamos o estado ATUAL do PlayerObject (antes da chamada) para decidir o toggle.

import { sessionManager } from '../session/sessionManager.js';
import { logger } from '../utils/logger.js';

/**
 * !getadmin — Toggle de admin para jogadores autorizados no banco.
 * @param {object} room - RoomObject HaxBall
 * @param {object} player - PlayerObject HaxBall (estado ANTES da mudança)
 */
export function cmdGetAdmin(room, player) {
  const session = sessionManager.get(player.id);

  // Jogador não registrado
  if (!session) {
    room.sendAnnouncement(
      `❌ ${player.name}, você precisa se registrar. Use !register`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  // Verificação de permissão no banco (is_admin da sessão)
  if (!session.is_admin) {
    room.sendAnnouncement(
      `🚫 ${player.name}, você não tem permissão para usar este comando.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    logger.warn(`[Permissions] "${player.name}" tentou !getadmin sem permissão.`);
    return;
  }

  // TOGGLE: lemos player.admin ANTES de chamar setPlayerAdmin
  // (não após, pois a mudança é assíncrona e getPlayer não refletiria imediatamente)
  const currentlyAdmin = player.admin;

  if (currentlyAdmin) {
    // Já tem admin → remove
    // NOTA ASSÍNCRONA: setPlayerAdmin executa de forma async pela API.
    // Não chamamos getPlayer() logo após para verificar — o estado ainda seria o antigo.
    room.setPlayerAdmin(player.id, false);
    room.sendAnnouncement(
      `🔓 ${player.name} abriu mão do admin.`,
      null, 0xFFD3B6, 'normal', 0
    );
    logger.info(`[Permissions] "${player.name}" removeu próprio admin.`);
  } else {
    // Não tem admin → concede
    room.setPlayerAdmin(player.id, true);
    room.sendAnnouncement(
      `🔑 ${player.name} obteve admin!`,
      null, 0xA8E6CF, 'normal', 2
    );
    logger.info(`[Permissions] "${player.name}" obteve admin.`);
  }
}
