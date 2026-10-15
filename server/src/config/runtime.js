import { isPublicSupabaseKey, requireHttpsUrl } from '../../../shared/productionConfig.mjs';

export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const generatedOrigins = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL].filter(Boolean).map((host) => `https://${host}`);
  const origins = [...new Set([...(env.FRONTEND_ORIGIN || '').split(',').map((item) => item.trim()).filter(Boolean), ...generatedOrigins])];
  if (!production && !origins.length) origins.push('http://localhost:5173');
  if (production) {
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      if (!env[name]) throw new Error(`${name} is required in production.`);
    }
    requireHttpsUrl(env.SUPABASE_URL, 'SUPABASE_URL');
    if (!isPublicSupabaseKey(env.SUPABASE_ANON_KEY)) throw new Error('SUPABASE_ANON_KEY must be a public key.');
    if (!origins.length) throw new Error('FRONTEND_ORIGIN or Vercel system domain variables are required in production.');
    origins.forEach((origin) => requireHttpsUrl(origin, 'FRONTEND_ORIGIN', { originOnly: true }));
  }
  const proxyHops = Number(env.TRUST_PROXY_HOPS ?? (env.VERCEL ? 1 : 0));
  if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a nonnegative integer.');
  return { production, origins, proxyHops, authRedirect: `${origins[0]}/reset-password` };
}
