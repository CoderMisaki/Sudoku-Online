import { createClient } from '@supabase/supabase-js';

// Obfuscated to prevent easy scraping
const u1 = ['https://oyw', 'drriwq', 'kzsvye', 'yjxzp.su', 'pabase.co'].join('');
const k1 = ['sb_publis', 'hable_kn', '9Us8pmI_X2eEBv', 'K4-pRQ_noR', 'VPnFz'].join('');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || u1;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || k1;

// Create a single supabase client for interacting with your database

export const isSupabaseEnvValid = true;

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
