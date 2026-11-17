// Which Supabase credentials the browser build may use, as pure functions so they can be tested.
//
// Everything with a VITE_ prefix is copied into the JavaScript every visitor downloads. That is fine for
// the project URL and a *publishable* key (they are built for browsers), and a serious leak for a secret
// key. A recognisably secret key fails the build (vite.config.ts) and is refused at runtime here.

export interface SupabaseConfig {
  url: string | null;
  key: string | null;
  /** Why the key was refused (a secret key in a public variable), if it was. */
  problem: string | null;
}

/** Is this a server-only key: the new `sb_secret_…` form, or a legacy JWT whose role is `service_role`? */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * Pick the URL and key from the build's environment. The publishable key (`sb_publishable_…`) wins; the
 * legacy anon key is still read so existing setups keep working until Supabase retires it.
 */
export function resolveSupabaseConfig(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}): SupabaseConfig {
  const url = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '') || null;
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim() || null;
  if (key && isSecretKey(key)) {
    return {
      url,
      key: null,
      problem: 'A secret (service_role) key was found in a VITE_ variable. Use the publishable key instead.',
    };
  }
  return { url, key, problem: null };
}
