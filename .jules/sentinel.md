
# 2025-07-27 - [Sudoku Together] Bugfixes and optimizations
- Avoid useRealtime duplicate hook mountings to prevent Supabase websocket collision
\n# 2025-07-27 - [Anti-Cheat & Security] Client-side state and websocket spoofing prevention\n- Removed `solution` unencrypted keys from local storage and real-time state.\n- Enforced server-side route checking for solution verifications.\n- Secured `sync_state` updates on WebSocket from spoofing and restricted it to host.
