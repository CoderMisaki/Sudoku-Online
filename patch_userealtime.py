import re

with open('src/hooks/useRealtime.ts', 'r') as f:
    content = f.read()

# Add states
state_addition = """
  // Status koneksi WebSocket
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
"""

content = content.replace("  useEffect(() => {", state_addition)

# Update return statement
content = content.replace(
    "return { broadcastCursor, broadcastMove, lockCell, locks, messages, broadcastChat };",
    "return { broadcastCursor, broadcastMove, lockCell, locks, messages, broadcastChat, realtimeStatus, connectionError };"
)

# Replace request_state to use syncHostState properly if it's not already
# The provided code already has syncHostState being called, but the user requested:
# .on('broadcast', { event: 'request_state' }, () => { ... })
# to check if store.room.hostId === userId

content = content.replace(
    """.on('broadcast', { event: 'request_state' }, () => {
        syncHostState();
      })""",
    """.on('broadcast', { event: 'request_state' }, () => {
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === userId) {
          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: { room: store.room, grid: store.grid, solution: store.solution }
          });
        }
      })"""
)

# Update presence join sync handling
join_match = re.search(r"\.on\('presence', \{ event: 'join' \}, \(\{ newPresences \}\) => \{.*?\n          if \(changed\) \{.*?\n          \}\n          syncHostState\(\);\n        \}", content, re.DOTALL)
if join_match:
    new_join = join_match.group(0).replace(
        "if (changed) {\n            store.setRoom({ ...store.room, players: newPlayers });\n          }\n          syncHostState();",
        """if (changed) {
            const updatedRoom = { ...store.room, players: newPlayers };
            store.setRoom(updatedRoom);
            channel.send({
              type: 'broadcast',
              event: 'sync_state',
              payload: { room: updatedRoom, grid: store.grid, solution: store.solution }
            });
          }"""
    )
    content = content.replace(join_match.group(0), new_join)

# Update subscribe block
sub_match = re.search(r"\.subscribe\(async \(status\) => \{.*?\n      \}\);", content, re.DOTALL)
if sub_match:
    new_sub = """.subscribe(async (status, err) => {
        setRealtimeStatus(status as any);
        if (err) {
          setConnectionError(err.message || 'Gagal terhubung ke WebSocket channel.');
        }

        if (status === 'SUBSCRIBED') {
          setConnectionError(null);
          await channel.track({
            user_id: userId,
            username: username,
            online_at: new Date().toISOString(),
          });

          channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: { userId }
          });
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionError('CHANNEL_ERROR: Koneksi WebSocket ditolak atau channel error.');
        } else if (status === 'TIMED_OUT') {
          setConnectionError('TIMED_OUT: Server Supabase tidak merespons (Timeout).');
        }
      });"""
    content = content.replace(sub_match.group(0), new_sub)

with open('src/hooks/useRealtime.ts', 'w') as f:
    f.write(content)
