// src/config/ratingConfig.js
// Configuração central do sistema de rating.
// Altere os valores aqui para ajustar o balanceamento sem mexer no código de lógica.

export const RATING = {
  // Pontos por evento individual
  GOAL:        +10,
  ASSIST:       +5,
  OWN_GOAL:    -10,

  // Bônus/penalidade por resultado da partida
  WIN:         +15,
  LOSS:        -10,
  DRAW:          0,

  // Rating mínimo (piso — jamais cai abaixo disso)
  MIN_RATING: 100,

  // Partida só conta rating se cada time tiver pelo menos este número de jogadores
  MIN_PER_TEAM_FOR_COMPETITIVE: 1, // 1v1 já conta; defina 2 para exigir 2v2+

  // Máximo de jogadores por time
  MAX_PER_TEAM: 3,
};
