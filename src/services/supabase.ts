import { createClient } from '@supabase/supabase-js';

// Obfuscated to prevent easy scraping
const supabaseUrl = 'oc.esabapus.pzxjyeyvszkqwirrdwyo//:sptth'.split('').reverse().join('');
const supabaseAnonKey = 'zFnPVRon_QRp-4KvBEe2X_Imp8sU9nk_elbahsilbup_bs'.split('').reverse().join('');

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
    heartbeatIntervalMs: 2500,
  },
});
