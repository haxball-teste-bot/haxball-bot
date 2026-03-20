// src/modules/help.js
// Módulo de ajuda — exibe comandos disponíveis ao jogador.
// Usando cores sofisticadas (Soft Blue, Khaki, Gainsboro).

export function cmdHelp(room, player) {
  const lines = [
    { text: '═══════ COMANDOS ═══════', color: 0xB0C4DE, style: 'normal' },
    { text: '📋 Conta:', color: 0xF0E68C, style: 'normal' },
    { text: '  !register <snh> — Criar conta com senha', color: 0xDCDCDC, style: 'normal' },
    { text: '  !login <snh>    — Logar em outra máquina', color: 0xDCDCDC, style: 'normal' },
    { text: '💰 Economia:', color: 0xF0E68C, style: 'normal' },
    { text: '  !saldo          — Ver saldo', color: 0xDCDCDC, style: 'normal' },
    { text: '  !addmoney <v>   — Adicionar saldo (Admin)', color: 0xDCDCDC, style: 'normal' },
    { text: '🛒 Loja:', color: 0xF0E68C, style: 'normal' },
    { text: '  !shop           — Listar itens', color: 0xDCDCDC, style: 'normal' },
    { text: '  !buy <chave>    — Comprar item (ex: !buy vip)', color: 0xDCDCDC, style: 'normal' },
    { text: '⏳ Fila:', color: 0xF0E68C, style: 'normal' },
    { text: '  !fila           — Ver fila de espera', color: 0xDCDCDC, style: 'normal' },
    { text: '  !pulafila       — Pular fila (VIP / Admin)', color: 0xDCDCDC, style: 'normal' },
    { text: '🏅 Rating:', color: 0xF0E68C, style: 'normal' },
    { text: '  !rating         — Ver seu rating atual', color: 0xDCDCDC, style: 'normal' },
    { text: '⚙️  Admin / Outros:', color: 0xF0E68C, style: 'normal' },
    { text: '  !getadmin       — Toggle admin (se autorizado)', color: 0xDCDCDC, style: 'normal' },
    { text: '  !bb             — Sair da sala rapidamente', color: 0xDCDCDC, style: 'normal' },
    { text: '  !help           — Este menu', color: 0xDCDCDC, style: 'normal' },
    { text: '════════════════════════', color: 0xB0C4DE, style: 'normal' },
  ];

  for (const line of lines) {
    room.sendAnnouncement(line.text, player.id, line.color, line.style, 0);
  }
}
