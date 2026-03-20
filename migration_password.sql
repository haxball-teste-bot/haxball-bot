-- migration_password.sql
ALTER TABLE public.user_info 
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Se desejar remover o login_pin antigo:
-- ALTER TABLE public.user_info DROP COLUMN IF EXISTS login_pin;
