-- ================================================================
-- MIGRATION FASE 2 — Rating, Alt-Login, Skip-Queue, Match Stats
-- Execute no SQL Editor do Supabase em ordem.
-- ================================================================

-- ────────────────────────────────────────
-- 1. Extensões em user_info
-- ────────────────────────────────────────

-- Rating do jogador (ELO-like, começa em 1000)
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS rating integer NOT NULL DEFAULT 1000;

-- Login alternativo: PIN hasheado (sha256 hex string)
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS login_pin text;            -- hash SHA-256 do PIN

-- Token de sessão de login alternativo (gerado ao usar !login)
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS session_token text;
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS session_token_expires_at timestamp with time zone;

-- Skip-queue: controle de cooldown
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS skip_queue_used_at timestamp with time zone; -- último uso de skip

-- ────────────────────────────────────────
-- 2. Tabela: matches (partidas)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matches (
  id            bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  started_at    timestamp with time zone NOT NULL DEFAULT now(),
  ended_at      timestamp with time zone,
  winner_team   smallint,          -- 1=red, 2=blue, 0=empate, NULL=não terminada
  is_competitive boolean NOT NULL DEFAULT false, -- true somente quando ≥2v2
  red_score     smallint DEFAULT 0,
  blue_score    smallint DEFAULT 0,
  CONSTRAINT matches_pkey PRIMARY KEY (id)
);

-- ────────────────────────────────────────
-- 3. Tabela: match_stats (estatísticas por jogador por partida)
-- ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_stats (
  id           bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  match_id     bigint NOT NULL,
  user_id      uuid NOT NULL,
  team         smallint NOT NULL,     -- time do jogador nessa partida (1 ou 2)
  goals        smallint NOT NULL DEFAULT 0,
  assists      smallint NOT NULL DEFAULT 0,
  own_goals    smallint NOT NULL DEFAULT 0,
  rating_delta integer NOT NULL DEFAULT 0,  -- variação de rating aplicada ao fim
  CONSTRAINT match_stats_pkey PRIMARY KEY (id),
  CONSTRAINT match_stats_match_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id),
  CONSTRAINT match_stats_user_fkey  FOREIGN KEY (user_id)  REFERENCES public.user_info(id),
  CONSTRAINT match_stats_unique UNIQUE (match_id, user_id)
);

-- ────────────────────────────────────────
-- 4. Índices
-- ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_match_stats_match  ON public.match_stats (match_id);
CREATE INDEX IF NOT EXISTS idx_match_stats_user   ON public.match_stats (user_id);
CREATE INDEX IF NOT EXISTS idx_user_info_rating   ON public.user_info (rating DESC);
CREATE INDEX IF NOT EXISTS idx_user_info_token    ON public.user_info (session_token);

-- ────────────────────────────────────────
-- 5. Verificação das novas colunas de user_info esperadas
-- ────────────────────────────────────────
-- Colunas esperadas após esta migration:
--   id, haxball_name, actual_balance, created_at, is_admin, auth_key (fase 1)
--   rating, login_pin, session_token, session_token_expires_at, skip_queue_used_at (fase 2)
