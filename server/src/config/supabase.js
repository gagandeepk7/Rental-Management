import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.SUPABASE_URL || "";
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
export const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function createSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createSupabaseUserClient(token) {
  if (!supabaseUrl || !supabaseAnonKey || !token) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && (supabaseAnonKey || supabaseServiceRoleKey));
}
