import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oywdrriwqkzsvyeyjxzp.supabase.co';
const supabaseAnonKey = 'sb_publishable_kn9Us8pmI_X2eEBvK4-pRQ_noRVPnFz';

export const isSupabaseEnvValid = true;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    realtime: {
      params: {
        eventsPerSecond: 50,
      },
      heartbeatIntervalMs: 2500,
    },
  }
);
