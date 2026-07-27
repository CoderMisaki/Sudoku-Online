import { createClient } from '@supabase/supabase-js';

// Obfuscated to prevent easy scraping
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Create a single supabase client for interacting with your database

export const isSupabaseEnvValid = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== '' && supabaseAnonKey !== '');

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
  realtime: {
    params: {
      eventsPerSecond: 50,
    },
  },
});
