// src/modules/altLogin.js
// Login alternativo para jogadores fora do computador de casa.
//
// LIMITAÇÃO REAL DA API HAXBALL:
//   Não existe login nativo na sala. player.auth muda quando o jogador usa
//   outra máquina/rede, pois depende do storage local do browser.
//
// ESTRATÉGIA IMPLEMENTADA — Senha e nick implícito:
//   1. Jogador registra uma senha: !register <senha>
//      - Senha é armazenada como SHA-256 hex no banco (user_info.password_hash)
//   2. Para logar de outra máquina:
//      - O jogador entra com seu nick usual. Ex: entra como "Def"
//      - Digita: !login <senha>
//      - Sistema busca usuário pelo `player.name` ("Def") + verifica password_hash.
//      - Se correto, VINCULA a nova `auth_key` (token atual do browser) permanentemente à conta.
//      - Carrega a sessão normalmente.
//
// SEGURANÇA:
//   - Senha nunca armazenada em texto puro
//   - !login só funciona se o jogador NÃO tiver sessão ativa.

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';
import { _pendingAuth } from './auth.js';

/** Gera hash SHA-256 de uma string */
function hashPassword(pass) {
  return createHash('sha256').update(pass).digest('hex');
}

/**
 * !login <senha> — Autentica um jogador que está em outra máquina.
 * Só funciona se o jogador ainda não tiver sessão carregada, usando seu próprio `player.name`.
 */
export async function cmdLogin(room, player, args) {
  // Se já tem sessão, não precisa de login alternativo
  if (sessionManager.get(player.id)) {
    room.sendAnnouncement(
      `⚠️ ${player.name}, você já está logado!`,
      player.id, 0xFFAA00, 'bold', 1
    );
    return;
  }

  if (args.length < 1) {
    room.sendAnnouncement(
      `⚠️ Uso: !login <senha>`,
      player.id, 0xFFAA00, 'bold', 1
    );
    return;
  }

  const password = args[0];
  const passHash = hashPassword(password);
  const authKey = _pendingAuth.get(player.id);

  // Busca usuário por nome atual (case-insensitive) + senha hash
  const { data: user, error } = await dbCall(() =>
    supabase
      .from('user_info')
      .select('id, haxball_name, actual_balance, is_admin, rating')
      .ilike('haxball_name', player.name)
      .eq('password_hash', passHash)
      .maybeSingle()
  );

  if (error || !user) {
    room.sendAnnouncement(
      `❌ Senha incorreta ou nome de usuário não registrado.`,
      player.id, 0xFF4444, 'bold', 1
    );
    logger.warn(`[Login] Tentativa de login falhou para nome="${player.name}"`);
    return;
  }

  // Verifica se já existe sessão ativa para esse dbId em outro player (segurança)
  const allSessions = sessionManager.allIds();
  for (const pid of allSessions) {
    const s = sessionManager.get(pid);
    if (s?.dbId === user.id && pid !== player.id) {
      room.sendAnnouncement(
        `❌ Essa conta já está ativa na sala.`,
        player.id, 0xFF4444, 'bold', 1
      );
      return;
    }
  }

  // Verifica VIP
  const { data: vipData } = await dbCall(() =>
    supabase
      .from('log_purchase')
      .select('id, items!inner(key)')
      .eq('id_user', user.id)
      .eq('items.key', 'vip')
      .maybeSingle()
  );

  // Registra nova auth_key no banco para logins automáticos futuros
  if (authKey) {
    await dbCall(() =>
      supabase
        .from('user_info')
        .update({ auth_key: authKey })
        .eq('id', user.id)
    );
  }

  // Carrega sessão
  const session = {
    dbId: user.id,
    haxball_name: user.haxball_name,
    balance: parseInt(user.actual_balance, 10) || 0,
    is_admin: user.is_admin === true,
    is_vip: !!vipData,
    rating: user.rating ?? 1000,
    auth_key: authKey, 
  };

  sessionManager.set(player.id, session);

  room.sendAnnouncement(
    `✅ Login realizado com sucesso! Bem-vindo de volta, ${user.haxball_name}!`,
    player.id, 0x00FF88, 'bold', 2
  );
  logger.info(`[Login] "${user.haxball_name}" autenticado via !login (playerId=${player.id}, authKey atualizada)`);
}
