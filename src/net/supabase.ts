import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseConfig } from './keys';

// The publishable key (VITE_SUPABASE_PUBLISHABLE_KEY) is preferred; the legacy anon key
// (VITE_SUPABASE_ANON_KEY) still works until Supabase retires it. See net/keys.ts.
const { url, key, problem } = resolveSupabaseConfig({
  // read each variable by name so Vite can inline it in the production build
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
});
if (problem) console.error(`[supabase] ${problem}`);

export const hasSupabase = Boolean(url && key);

// Only PvP needs this. PvAI / hotseat run with this null.
export const supabase = hasSupabase ? createClient(url!, key!) : null;
