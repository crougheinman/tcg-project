import { describe, expect, it } from 'vitest';
import { isSecretKey, resolveSupabaseConfig } from '../keys';

// JWT-shaped keys built in the test (header.payload.signature); the signature is irrelevant here.
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.sig`;

describe('which Supabase key a browser build may use', () => {
  it('refuses secret keys: the new sb_secret_ form and a legacy service_role JWT', () => {
    expect(isSecretKey('sb_secret_abc123')).toBe(true);
    expect(isSecretKey(jwt('service_role'))).toBe(true);
  });

  it('accepts the publishable key and the legacy anon key', () => {
    expect(isSecretKey('sb_publishable_abc123')).toBe(false);
    expect(isSecretKey(jwt('anon'))).toBe(false);
    expect(isSecretKey('not-a-jwt')).toBe(false);
  });

  it('prefers the publishable key, and falls back to the legacy anon key', () => {
    const both = resolveSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new', VITE_SUPABASE_ANON_KEY: jwt('anon') });
    expect(both.key).toBe('sb_publishable_new');
    const legacy = resolveSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') });
    expect(legacy.key).toBe(jwt('anon'));
  });

  it('cleans the URL: surrounding spaces and trailing slashes', () => {
    expect(resolveSupabaseConfig({ VITE_SUPABASE_URL: '  https://x.supabase.co/  ', VITE_SUPABASE_PUBLISHABLE_KEY: 'k' }).url).toBe('https://x.supabase.co');
  });

  it('a secret key in either variable disables online play with an explanation, instead of shipping it', () => {
    const r = resolveSupabaseConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops' });
    expect(r.key).toBeNull();
    expect(r.problem).toMatch(/secret/i);
    expect(resolveSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: jwt('service_role') }).key).toBeNull();
  });

  it('reports nothing configured as simply not configured (no problem)', () => {
    expect(resolveSupabaseConfig({})).toEqual({ url: null, key: null, problem: null });
  });
});
