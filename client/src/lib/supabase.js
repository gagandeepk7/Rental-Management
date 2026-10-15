import { createClient } from "@supabase/supabase-js";
import { validateFrontendConfig } from '../../../shared/productionConfig.mjs';

validateFrontendConfig(import.meta.env, import.meta.env.PROD);
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const isSupabaseConfigured = true;
export const supabase = createClient(supabaseUrl, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
