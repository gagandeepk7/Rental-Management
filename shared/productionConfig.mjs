export function isPublicSupabaseKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'anon';
  } catch { return false; }
}

export function requireHttpsUrl(value, name, { originOnly = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || (originOnly && value !== url.origin)) {
    throw new Error(`${name} must be a public HTTPS ${originOnly ? 'origin without a path' : 'URL'}.`);
  }
  return url;
}

export function validateFrontendConfig(env, production = false) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
  if (!isPublicSupabaseKey(env.VITE_SUPABASE_ANON_KEY)) throw new Error('The frontend requires a Supabase public/anon key, never a service or secret key.');
  if (Object.keys(env).some((key) => key.startsWith('VITE_') && /SERVICE_ROLE|SECRET|DATABASE_URL|PASSWORD/.test(key))) throw new Error('Server credentials must never use the VITE_ prefix.');
  if (production) {
    requireHttpsUrl(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
    const api = env.VITE_API_URL || '/api';
    if (api !== '/api') requireHttpsUrl(api, 'VITE_API_URL');
  }
}
