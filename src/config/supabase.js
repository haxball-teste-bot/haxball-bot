// src/config/supabase.js
// Cliente Supabase usando a Service Role Key para acesso irrestrito (server-side only).
// NUNCA exponha esta key no frontend.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('[Supabase] SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios no .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Desativamos o gerenciamento de sessão pois usamos service key diretamente
    persistSession: false,
    autoRefreshToken: false,
  },
});
