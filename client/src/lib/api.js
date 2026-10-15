import { resolveApiBaseUrl } from '../../../shared/apiUrl.mjs';
import { createApiClient } from './apiClient.js';

const apiUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL, { production: import.meta.env.PROD });
export const apiFetch = createApiClient(apiUrl);
