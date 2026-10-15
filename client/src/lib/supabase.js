import { createClient } from "@supabase/supabase-js";

export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://pahijsiqpbuofnbmoybh.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhaGlqc2lxcGJ1b2ZuYm1veWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NTc4MDMsImV4cCI6MjEwNzUzMzgwM30.3IaV8azELSPk7s7fpZYB3ovnd1iwzCZ2F6hXAYE_vew";

export const isSupabaseConfigured =
  supabaseAnonKey !==
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhaGlqc2lxcGJ1b2ZuYm1veWJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NTc4MDMsImV4cCI6MjEwNzUzMzgwM30.3IaV8azELSPk7s7fpZYB3ovnd1iwzCZ2F6hXAYE_vew";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
  },
});
