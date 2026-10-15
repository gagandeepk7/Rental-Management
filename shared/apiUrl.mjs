import { requireHttpsUrl } from './productionConfig.mjs';

// Express mounts its entire application router at /api. Normalize that mount
// once here; individual callers continue to pass paths such as /profile.
export function resolveApiBaseUrl(value, { production = false } = {}) {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (!configured && production) throw new Error('VITE_API_URL is required for the Render backend.');
  const input = configured || 'http://localhost:5000/api';
  let url;
  try { url = new URL(input); } catch { throw new Error('VITE_API_URL must be an absolute backend URL.'); }
  if (production) requireHttpsUrl(input, 'VITE_API_URL');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_URL must be an HTTP(S) backend URL without credentials, query parameters, or a fragment.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (path && path !== '/api') throw new Error('VITE_API_URL must be the backend origin or end with /api.');
  return `${url.origin}/api`;
}

export function buildApiUrl(baseUrl, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /^\/api(?:\/|\?|$)/.test(path)) {
    throw new Error('API paths must start with a single / and omit the shared /api prefix.');
  }
  return `${baseUrl}${path}`;
}
