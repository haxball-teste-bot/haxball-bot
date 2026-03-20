-- ================================================================
-- MIGRAÇÃO NECESSÁRIA para o sistema HaxBall Headless
-- Execute este SQL no SQL Editor do Supabase antes de iniciar o bot.
-- ================================================================

-- Adiciona coluna auth_key em user_info para identificar jogadores pelo
-- player.auth do HaxBall (único identificador disponível na API Headless).
-- player.auth é um "public ID" do jogador, disponível APENAS no evento onPlayerJoin.
ALTER TABLE public.user_info
  ADD COLUMN IF NOT EXISTS auth_key text UNIQUE;

-- Índice para lookup rápido por auth_key ao carregar sessão de jogador
CREATE INDEX IF NOT EXISTS idx_user_info_auth_key ON public.user_info (auth_key);

-- ================================================================
-- Verificação: estrutura final esperada da tabela user_info
-- ================================================================
-- id             uuid        PK, gen_random_uuid()
-- haxball_name   text        Nome no HaxBall no momento do registro
-- actual_balance text        Saldo em centavos (ex: "1000" = R$ 10,00)
-- created_at     timestamptz DEFAULT now()
-- is_admin       boolean     Acesso ao comando !getadmin
-- auth_key       text        UNIQUE — player.auth capturado no onPlayerJoin
