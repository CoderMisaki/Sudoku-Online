with open('src/hooks/useRealtime.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "setRealtimeStatus(status as any);",
    "setRealtimeStatus(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED');"
)

with open('src/hooks/useRealtime.ts', 'w') as f:
    f.write(content)

with open('src/app/room/[id]/page.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, Send, AlertTriangle, WifiOff } from 'lucide-react';",
    "import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, Send, AlertTriangle, WifiOff } from 'lucide-react';" # Send is actually used later in the file, wait let me check
)

with open('src/app/room/[id]/page.tsx', 'w') as f:
    f.write(content)
