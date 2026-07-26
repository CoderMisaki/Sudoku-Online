with open('src/services/supabase.ts', 'r') as f:
    content = f.read()

new_content = content.replace(
    "const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';",
    "const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';"
).replace(
    "const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';",
    "const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';"
)

env_validation = """
export const isSupabaseEnvValid = Boolean(
  supabaseUrl &&
  !supabaseUrl.includes('placeholder') &&
  supabaseAnonKey &&
  !supabaseAnonKey.includes('placeholder')
);
"""

new_content = new_content.replace(
    "export const supabase = createClient(supabaseUrl, supabaseAnonKey, {",
    env_validation + "\nexport const supabase = createClient(\n  supabaseUrl || 'https://placeholder.supabase.co',\n  supabaseAnonKey || 'placeholder-key',\n  {"
)

with open('src/services/supabase.ts', 'w') as f:
    f.write(new_content)
