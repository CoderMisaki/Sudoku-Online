const fs = require('fs');
const content = fs.readFileSync('src/services/supabase.ts', 'utf8');

const updatedContent = content
  .replace(/const u1 = \['https:\/\/oyw', 'drriwq', 'kzsvye', 'yjxzp\.su', 'pabase\.co'\]\.join\(''\);\nconst k1 = \['sb_publis', 'hable_kn', '9Us8pmI_X2eEBv', 'K4-pRQ_noR', 'VPnFz'\]\.join\(''\);\n\nconst supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL \|\| u1;\nconst supabaseAnonKey = process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \|\| k1;/g,
  `const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';\nconst supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';`)
  .replace(/export const isSupabaseEnvValid = true;/g, `export const isSupabaseEnvValid = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== '' && supabaseAnonKey !== '');`);

fs.writeFileSync('src/services/supabase.ts', updatedContent);
