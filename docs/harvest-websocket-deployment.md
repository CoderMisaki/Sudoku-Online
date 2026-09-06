# Harvest Moon — WebSocket Deployment Checklist

The game is realtime multiplayer over a **native, persistent WebSocket**
endpoint served by a **custom Node HTTP server**:

- Page + API: Next.js (same origin, same port)
- Realtime: `GET /ws/harvest` → `101 Switching Protocols` (see `server/run.mjs`
  + `server/harvest-server.mjs`)
- Health: `GET /api/harvest/health` → `{ ok, gameServer, websocketPath }`

## The one rule

> **Production MUST run `node server/run.mjs` (via `npm start`) on a host that
> supports long-lived WebSocket upgrades.**

A green HTTP deploy does **not** imply the game works. If the host cannot do
persistent `Upgrade: websocket` connections, the client will correctly cycle
`connecting → hello-timeout → reconnecting → error` — that is the client
telling the truth about a broken transport, not a client bug.

## Hosts

| Host | Persistent `/ws/harvest`? | Notes |
|---|---|---|
| VPS / bare metal (any) | ✅ | Run `npm run build && npm start`, proxy WS through nginx/Caddy |
| Railway / Render / Fly.io / Northflank | ✅ | Use the Node service with `npm start`; keep one instance per region (in-memory worlds) |
| Vercel / Netlify / Cloudflare Pages / any serverless-only host | ❌ | No persistent WS upgrade — **do not deploy the game server here** |

Multi-instance note: worlds live in server memory (+ disk persistence per
instance). If you scale horizontally, add sticky sessions per `roomCode` or an
external pub/sub — out of scope for the default single-instance setup.

## Verify a deploy (2 minutes)

1. HTTP is up:

   ```bash
   curl -s https://YOUR_HOST/api/harvest/health
   # expect: {"ok":true,"gameServer":true,"websocketPath":"/ws/harvest",...}
   ```

   `gameServer:false` means the game module failed to load — check server logs.

2. The WebSocket upgrade works (must print `101`):

   ```bash
   curl -si -N \
     -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" \
     -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
     https://YOUR_HOST/ws/harvest | head -n 1
   # expect: HTTP/1.1 101 Switching Protocols
   ```

   Anything else (`404`, `426`, `503`, hang) = the reverse proxy / platform is
   eating the upgrade. Fix the proxy (`proxy_set_header Upgrade ...`) or move
   to a host from the ✅ column.

3. In the browser console you should see the healthy handshake, never a loop:

   ```
   [harvest] websocket opening
   [harvest] websocket open
   [harvest] hello sent
   [harvest] hello_ack received   (or: snapshot received)
   ```

## Reverse-proxy snippet (nginx)

```nginx
location /ws/harvest {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400s;
  proxy_send_timeout 86400s;
}
```

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP+WS listen port |
| `BIND_HOST` | `0.0.0.0` | Listen address |
| `NODE_ENV=production` | dev | `npm start` sets production mode |
