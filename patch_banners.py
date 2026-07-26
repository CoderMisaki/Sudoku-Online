import re

with open('src/app/room/[id]/page.tsx', 'r') as f:
    content = f.read()

# Add imports
content = content.replace(
    "import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, Send } from 'lucide-react';",
    "import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, Send, AlertTriangle, WifiOff } from 'lucide-react';\nimport { isSupabaseEnvValid } from '../../../services/supabase';"
)

# Extract new properties from useRealtime
content = content.replace(
    "const { broadcastMove, broadcastCursor, lockCell, locks, messages, broadcastChat } = useRealtime(roomId);",
    "const { broadcastMove, broadcastCursor, lockCell, locks, messages, broadcastChat, realtimeStatus, connectionError } = useRealtime(roomId);"
)

# Add banners under header
banners = """
      {/* BANNER 1: Jika ENV Vercel / Supabase Belum Valid */}
      {!isSupabaseEnvValid && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ENV NOT VALID:</strong> Environment Variables Supabase (<code className="bg-red-500/20 px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_URL</code> & <code className="bg-red-500/20 px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) belum dipasang atau masih placeholder di Vercel. Fitur multiplayer realtime mati.
          </span>
        </div>
      )}

      {/* BANNER 2: Jika ENV Valid tapi WebSockets Supabase Offline / Channel Error */}
      {isSupabaseEnvValid && (realtimeStatus === 'CHANNEL_ERROR' || realtimeStatus === 'TIMED_OUT' || connectionError) && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-500 px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-center gap-2 text-center">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>ROOM OFFLINE:</strong> {connectionError || `Koneksi WebSocket gagal (${realtimeStatus})`}. Pastikan fitur Realtime di Dashboard Supabase telah diaktifkan.
          </span>
        </div>
      )}
"""

content = content.replace(
    "      </header>\n\n      {/* Main Content */}",
    f"      </header>\n{banners}\n      {{/* Main Content */}}"
)

with open('src/app/room/[id]/page.tsx', 'w') as f:
    f.write(content)
