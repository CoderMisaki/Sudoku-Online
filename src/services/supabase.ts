import { createClient } from '@supabase/supabase-js';

// Kredensial Supabase langsung tanpa process.env
export const SUPABASE_URL = 'https://oywdrriwqkzsvyeyjxzp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_kn9Us8pmI_X2eEBvK4-pRQ_noRVPnFz';

export const isSupabaseEnvValid = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

console.log('[Supabase Init] Initializing Supabase Client with direct endpoint:', SUPABASE_URL);

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  }
);
