// src/config/room.js
// Configuração da sala HaxBall Headless.
// Valores vêm das variáveis de ambiente definidas no .env
import 'dotenv/config';

/**
 * RoomConfigObject conforme documentação oficial:
 * https://github.com/haxball/haxball-issues/wiki/Headless-Host#roomconfigobject
 *
 * noPlayer: true — Recomendado pela documentação para hosts automáticos.
 * Remove o "host player" da lista, evitando comportamento indesejado.
 */
export const roomConfig = {
  roomName: process.env.ROOM_NAME || 'Sala BR',
  maxPlayers: parseInt(process.env.ROOM_MAX_PLAYERS || '12', 10),
  public: process.env.ROOM_PUBLIC === 'true',
  password: process.env.ROOM_PASSWORD || null,
  token: process.env.HAXBALL_TOKEN,
  noPlayer: true, // Obrigatório para hosts automatizados (documentação oficial)
};

if (!roomConfig.token) {
  throw new Error('[Room] HAXBALL_TOKEN é obrigatório no .env');
}
