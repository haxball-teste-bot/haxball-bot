// src/modules/auth.js
// Módulo de autenticação e identificação de jogadores.
//
// Estratégia de identificação:
//   - player.auth (público ID do HaxBall) é o identificador principal.
//   - player.auth e player.conn SÓ estão disponíveis no evento onPlayerJoin.
//   - Armazenamos auth_key na tabela user_info para linkar sessão futura.
//   - Se player.auth for null (validação falhou), o jogador não pode ser identificado.
//
// Nota sobre autenticação futura:
//   - Quando o site for implementado, auth_key pode ser complementado com login real.
//   - Por ora, player.auth é suficiente para evitar duplicidade por sessão.

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';

const INITIAL_BALANCE = 1000; // Saldo inicial em centavos (R$ 10,00)

/** Gera hash SHA-256 de uma string */
function hashPassword(pass) {
  return createHash('sha256').update(pass).digest('hex');
}

/**
 * Carrega dados do jogador do banco ao entrar na sala e salva na sessão.
 * DEVE ser chamado apenas dentro do handler onPlayerJoin, onde player.auth está disponível.
 *
 * @param {object} player - PlayerObject do HaxBall (com .auth e .conn disponíveis)
 */
export async function loadPlayerSession(player) {
  if (!player.auth) {
    logger.warn(`[Auth] Jogador "${player.name}" (id=${player.id}) sem player.auth — não é possível identificar.`);
    return;
  }

  const { data, error } = await dbCall(() =>
    supabase
      .from('user_info')
      .select('id, haxball_name, actual_balance, is_admin, rating, skip_queue_used_at')
      .eq('auth_key', player.auth)
      .maybeSingle()
  );

  if (error) return;

  if (!data) {
    // Jogador não registrado — sem sessão ainda
    logger.info(`[Auth] Jogador "${player.name}" entrou sem cadastro.`);
    return;
  }

  // Verifica se tem VIP (comprou o item com key 'vip')
  const { data: vipData } = await dbCall(() =>
    supabase
      .from('log_purchase')
      .select('id, items!inner(key)')
      .eq('id_user', data.id)
      .eq('items.key', 'vip')
      .maybeSingle()
  );

  const session = {
    dbId: data.id,
    haxball_name: data.haxball_name,
    balance: parseInt(data.actual_balance, 10) || 0,
    is_admin: data.is_admin === true,
    is_vip: !!vipData,
    rating: data.rating ?? 1000,
    skipQueueUsedAt: data.skip_queue_used_at || null,
    auth_key: player.auth,
  };

  sessionManager.set(player.id, session);
  logger.info(`[Auth] Sessão carregada para "${player.name}" (admin=${session.is_admin}, vip=${session.is_vip}, saldo=${session.balance})`);
}

/**
 * Registra um jogador novo via comando !register <senha>.
 * Cria a linha em user_info com nome, saldo inicial, auth_key e password_hash.
 *
 * @param {object} room - RoomObject da API HaxBall
 * @param {object} player - PlayerObject (com .auth disponível se veio do onPlayerJoin; aqui obtemos via getPlayer)
 * @param {string[]} args - Argumentos passados no chat (ex: ["minhasenha"])
 */
export async function registerPlayer(room, player, args) {
  // Obtemos a sessão atual — player.auth NÃO está disponível aqui pois estamos
  // em onPlayerChat, não onPlayerJoin. Usamos o auth_key guardado na sessão ao entrar.
  const session = sessionManager.get(player.id);

  // Verifica se já tem sessão (já registrado)
  if (session && session.dbId) {
    room.sendAnnouncement(
      `⚠️ ${player.name}, você já possui uma conta registrada!`,
      player.id, 0xFFAA00, 'bold', 1
    );
    return;
  }

  // Recupera o auth_key temporário capturado no join, guardado em _pendingAuth
  const authKey = _pendingAuth.get(player.id);

  if (!authKey) {
    room.sendAnnouncement(
      `❌ ${player.name}, não foi possível identificar sua conta. Reconecte e tente novamente.`,
      player.id, 0xFF4444, 'bold', 1
    );
    return;
  }

  // Verifica duplicidade no banco
  const { data: existing } = await dbCall(() =>
    supabase
      .from('user_info')
      .select('id')
      .eq('auth_key', authKey)
      .maybeSingle()
  );

  if (existing) {
    room.sendAnnouncement(
      `⚠️ ${player.name}, esse ID já está vinculado a uma conta existente.`,
      player.id, 0xFFAA00, 'bold', 1
    );
    return;
  }

  const password = args[0];
  if (!password || password.length < 4) {
    room.sendAnnouncement(
      `⚠️ Uso: !register <senha> (mínimo 4 caracteres)`,
      player.id, 0xFFAA00, 'bold', 1
    );
    return;
  }

  const passHash = hashPassword(password);

  // Cria o registro
  const { data: newUser, error } = await dbCall(() =>
    supabase
      .from('user_info')
      .insert({
        haxball_name: player.name,
        actual_balance: String(INITIAL_BALANCE),
        is_admin: false,
        auth_key: authKey,
        password_hash: passHash,
      })
      .select()
      .single()
  );

  if (error || !newUser) {
    room.sendAnnouncement(
      `❌ ${player.name}, erro ao criar conta. Tente novamente.`,
      player.id, 0xFF4444, 'bold', 1
    );
    return;
  }

  // Cria sessão
  const newSession = {
    dbId: newUser.id,
    haxball_name: newUser.haxball_name,
    balance: INITIAL_BALANCE,
    is_admin: false,
    is_vip: false,
    rating: 1000,
    auth_key: authKey,
  };
  sessionManager.set(player.id, newSession);

  room.sendAnnouncement(
    `✅ Conta criada com sucesso! Bem-vindo(a), ${player.name}! 🎉 Saldo inicial: R$ ${formatBalance(INITIAL_BALANCE)}`,
    player.id, 0x00FF88, 'bold', 2
  );

  logger.info(`[Auth] Novo jogador registrado: "${player.name}" (dbId=${newUser.id})`);
}

/**
 * Map temporário para guardar player.auth durante a sessão (disponível só no onPlayerJoin).
 * Não é a sessão completa — serve apenas para que !register possa acessar o auth_key.
 * @type {Map<number, string>}
 */
export const _pendingAuth = new Map();

/**
 * Registra o auth_key no mapa temporário quando o jogador entra.
 * Deve ser chamado em onPlayerJoin antes de loadPlayerSession.
 */
export function capturePlayerAuth(player) {
  if (player.auth) {
    _pendingAuth.set(player.id, player.auth);
  }
}

/**
 * Remove o auth_key temporário quando o jogador sai.
 */
export function releasePlayerAuth(playerId) {
  _pendingAuth.delete(playerId);
}

/** Formata centavos para exibição em R$ */
function formatBalance(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}
