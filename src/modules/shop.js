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
// Preços agora estão em Coins (price 20000 = 20.000 Coins).

import { supabase } from '../config/supabase.js';
import { sessionManager } from '../session/sessionManager.js';
import { dbCall } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { formatCoins } from './economy.js';
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
      `  [${item.key}] ${item.item_name} — ${formatCoins(item.price)}`,
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
      `❌ Saldo insuficiente! Você tem ${formatCoins(session.balance)}, o item custa ${formatCoins(item.price)}.`,
      player.id, 0xFF8B94, 'normal', 1
    );
    return;
  }

  // Verifica se já comprou (para itens únicos como VIP - agora baseado em validade)
  if (item.key === 'vip') {
    if (session.is_vip && session.vipExpiresAt) {
      const expiry = new Date(session.vipExpiresAt);
      if (expiry > new Date()) {
        room.sendAnnouncement(
          `⚠️ ${player.name}, você já possui VIP ativo até ${expiry.toLocaleDateString()}.`,
          player.id, 0xFFD3B6, 'normal', 1
        );
        return;
      }
    }
  }

  const newBalance = session.balance - item.price;

  // Debita saldo no banco
  const { error: updateError } = await dbCall(() => {
    const updates = { actual_balance: String(newBalance) };
    if (item.key === 'vip') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      updates.vip_expires_at = expiresAt.toISOString();
    }
    return supabase
      .from('user_info')
      .update(updates)
      .eq('id', session.dbId)
  });

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

  // Aplica benefício imediato ou atualiza inventário
  if (item.key === 'vip') {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    patch.is_vip = true;
    patch.vipExpiresAt = expiresAt.toISOString();
  }

  if (item.key === 'jump') {
    if (session.is_vip || session.is_admin) {
      resetSkipCooldown(player.id);
    } else {
      // Adiciona ao inventário para não-VIPs
      const currentQty = session.inventory.get('jump') || 0;
      const newQty = currentQty + 1;
      
      await dbCall(() =>
        supabase.from('inventory').upsert({
          user_id: session.dbId,
          item_key: 'jump',
          quantity: newQty,
          updated_at: new Date().toISOString()
        })
      );
      
      session.inventory.set('jump', newQty);
      patch.inventory = session.inventory;
    }
  }

  sessionManager.patch(player.id, patch);

  logger.info(`[Shop] "${player.name}" comprou "${item.item_name}" por ${item.price} coins.`);

  room.sendAnnouncement(
    `✅ Compra realizada! Você adquiriu: ${item.item_name} 🎉 Saldo restante: ${formatCoins(newBalance)}`,
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
