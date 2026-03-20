-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_name text,
  price integer,
  key text,
  CONSTRAINT items_pkey PRIMARY KEY (id)
);
CREATE TABLE public.log_purchase (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_user uuid,
  id_item uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT log_purchase_pkey PRIMARY KEY (id),
  CONSTRAINT log_purchase_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.user_info(id),
  CONSTRAINT log_purchase_id_item_fkey FOREIGN KEY (id_item) REFERENCES public.items(id)
);
CREATE TABLE public.match_stats (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  match_id bigint NOT NULL,
  user_id uuid NOT NULL,
  team smallint NOT NULL,
  goals smallint NOT NULL DEFAULT 0,
  assists smallint NOT NULL DEFAULT 0,
  own_goals smallint NOT NULL DEFAULT 0,
  rating_delta integer NOT NULL DEFAULT 0,
  CONSTRAINT match_stats_pkey PRIMARY KEY (id),
  CONSTRAINT match_stats_match_fkey FOREIGN KEY (match_id) REFERENCES public.matches(id),
  CONSTRAINT match_stats_user_fkey FOREIGN KEY (user_id) REFERENCES public.user_info(id)
);
CREATE TABLE public.matches (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  winner_team smallint,
  is_competitive boolean NOT NULL DEFAULT false,
  red_score smallint DEFAULT 0,
  blue_score smallint DEFAULT 0,
  CONSTRAINT matches_pkey PRIMARY KEY (id)
);
CREATE TABLE public.money_recharge (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  id_user uuid,
  balance_recharged integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT money_recharge_pkey PRIMARY KEY (id),
  CONSTRAINT money_recharge_id_user_fkey FOREIGN KEY (id_user) REFERENCES public.user_info(id)
);
CREATE TABLE public.user_info (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  haxball_name text,
  actual_balance text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_admin boolean,
  auth_key text UNIQUE,
  rating integer NOT NULL DEFAULT 1000,
  login_pin text,
  session_token text,
  session_token_expires_at timestamp with time zone,
  skip_queue_used_at timestamp with time zone,
  CONSTRAINT user_info_pkey PRIMARY KEY (id)
);