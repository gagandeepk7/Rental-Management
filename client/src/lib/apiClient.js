import { buildApiUrl } from '../../../shared/apiUrl.mjs';

export function createApiClient(baseUrl, fetchRequest = globalThis.fetch) {
  return async function apiFetch(path, options = {}, accessToken) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetchRequest(buildApiUrl(baseUrl, path), { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  };
}
