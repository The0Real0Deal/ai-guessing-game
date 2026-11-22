import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

function getEnvValue(keys: string[]): string {
  const env = import.meta.env as Record<string, string | undefined>;
  for (const key of keys) {
    const value = env[key];
    if (value && value.trim()) return value.trim();
  }
  return '';
}

export function getSupabaseConfig(): { url: string; anonKey: string } {
  const url =
    getEnvValue(['NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL']) ||
    (typeof window !== 'undefined' ? localStorage.getItem('catgame_supabase_url') || '' : '');

  const anonKey =
    getEnvValue(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY']) ||
    (typeof window !== 'undefined' ? localStorage.getItem('catgame_supabase_anon_key') || '' : '');

  return { url: url.trim(), anonKey: anonKey.trim() };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey && url.startsWith('http'));
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cachedClient) return cachedClient;

  const { url, anonKey } = getSupabaseConfig();
  cachedClient = createClient(url, anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  return cachedClient;
}

export function saveRuntimeSupabaseConfig(url: string, anonKey: string) {
  localStorage.setItem('catgame_supabase_url', url.trim());
  localStorage.setItem('catgame_supabase_anon_key', anonKey.trim());
  cachedClient = null;
}

export function clearRuntimeSupabaseConfig() {
  localStorage.removeItem('catgame_supabase_url');
  localStorage.removeItem('catgame_supabase_anon_key');
  cachedClient = null;
}
