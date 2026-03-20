// src/modules/shop.js
// Módulo da loja.
//
// Tabelas usadas (schema.sql):
//   - items: id, item_name, price, key
//   - log_purchase: id_user, id_item, created_at
//   - user_info: actual_balance (debitado na compra)
//
// Itens pré-existentes no banco:
//   - Vip     | price 500 | key "vip"
//   - Pular fila | price 600 | key "jump"
//
// Preços estão em centavos (price 500 = R$ 5,00).

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatBalance } from './economy.js';
import { resetSkipCooldown } from './skipQueue.js';

/**
 * !shop — Lista os itens disponíveis na loja.
 * @param {object} room
 * @param {object} player
 */
export async function cmdShop(room, player) {
  const { data: items, error } = await dbCall(() =>
    supabase.from('items').select('item_name, price, key').order('price')
  );

  if (error || !items || items.length === 0) {
    room.sendAnnouncement(
      `🛒 Loja temporariamente indisponível.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  // sendAnnouncement não suporta quebras de linha reais — enviamos mensagens separadas
  room.sendAnnouncement(`🛒 ═══════ LOJA ═══════`, player.id, 0xF0E68C, 'normal', 0);

  for (const item of items) {
    room.sendAnnouncement(
      `  [${item.key}] ${item.item_name} — R$ ${formatBalance(item.price)}`,
      player.id, 0xCCCCCC, 'normal', 0
    );
  }

  room.sendAnnouncement(
    `  Use !buy <chave> para comprar. Ex: !buy vip`,
    player.id, 0xF0E68C, 'normal', 0
  );
  room.sendAnnouncement(`🛒 ════════════════════`, player.id, 0xF0E68C, 'normal', 0);
}

/**
 * !buy <key> — Compra um item pelo key.
 * @param {object} room
 * @param {object} player
 * @param {string[]} args - args[0] = key do item
 */
export async function cmdBuy(room, player, args) {
  const session = sessionManager.get(player.id);

  if (!session) {
    room.sendAnnouncement(
      `❌ ${player.name}, registre-se antes de comprar. Use !register`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  const key = args[0]?.toLowerCase();

  if (!key) {
    room.sendAnnouncement(
      `⚠️ Uso correto: !buy <chave> (use !shop para ver as chaves)`,
      player.id, 0xFFD3B6, 'normal', 1
    );
    return;
  }

  // Busca o item pelo key
  const { data: item, error: itemError } = await dbCall(() =>
    supabase
      .from('items')
      .select('id, item_name, price, key')
      .eq('key', key)
      .maybeSingle()
  );

  if (itemError || !item) {
    room.sendAnnouncement(
      `❌ Item "${key}" não encontrado. Use !shop para ver os itens disponíveis.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  // Verifica saldo
  if (session.balance < item.price) {
    room.sendAnnouncement(
      `❌ Saldo insuficiente! Você tem R$ ${formatBalance(session.balance)}, o item custa R$ ${formatBalance(item.price)}.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  // Verifica se já comprou (para itens únicos como VIP)
  if (item.key === 'vip') {
    const { data: alreadyBought } = await dbCall(() =>
      supabase
        .from('log_purchase')
        .select('id')
        .eq('id_user', session.dbId)
        .eq('id_item', item.id)
        .maybeSingle()
    );

    if (alreadyBought) {
      room.sendAnnouncement(
        `⚠️ ${player.name}, você já possui o item "${item.item_name}".`,
        player.id, 0xFFD3B6, 'normal', 1
      );
      return;
    }
  }

  const newBalance = session.balance - item.price;

  // Debita saldo no banco
  const { error: updateError } = await dbCall(() =>
    supabase
      .from('user_info')
      .update({ actual_balance: String(newBalance) })
      .eq('id', session.dbId)
  );

  if (updateError) {
    room.sendAnnouncement(`❌ Erro ao processar compra. Tente novamente.`, player.id, 0xFF8B94, 'normal', 1);
    return;
  }

  // Registra a compra no log_purchase
  await dbCall(() =>
    supabase.from('log_purchase').insert({
      id_user: session.dbId,
      id_item: item.id,
    })
  );

  // Atualiza sessão em memória
  const patch = { balance: newBalance };

  // Aplica benefício imediato do item
  if (item.key === 'vip') {
    patch.is_vip = true;
  }
  // Item 'jump': reseta cooldown de pular fila imediatamente
  if (item.key === 'jump') {
    resetSkipCooldown(player.id);
  }

  sessionManager.patch(player.id, patch);

  logger.info(`[Shop] "${player.name}" comprou "${item.item_name}" por ${item.price} centavos.`);

  room.sendAnnouncement(
    `✅ Compra realizada! Você adquiriu: ${item.item_name} 🎉 Saldo restante: R$ ${formatBalance(newBalance)}`,
    player.id, 0xA8E6CF, 'normal', 2
  );

  if (item.key === 'vip') {
    room.sendAnnouncement(
      `💎 Status VIP ativado! Seu prefixo foi atualizado, ${player.name}.`,
      player.id, 0xF0E68C, 'normal', 2
    );
  }
  if (item.key === 'jump') {
    room.sendAnnouncement(
      `⚡ Pular Fila desbloqueado! Use !pulafila agora sem cooldown.`,
      player.id, 0xB0C4DE, 'normal', 2
    );
  }
}
