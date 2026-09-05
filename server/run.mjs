/**
 * Custom Next.js server that also hosts the Harvest Moon realtime game server
 * on the SAME origin (path /ws/harvest). Keeping everything on one port makes
 * the game work behind reverse proxies/preview hosts without CORS or
 * cross-origin WebSocket issues. Next's own upgrade handler (HMR in dev,
 * internal sockets) is forwarded for every other upgrade request.
 */
import http from 'node:http';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
// NOTE: in many sandboxes $HOSTNAME is the machine name, not a bind address.
const HOSTNAME = process.env.BIND_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const app = next({ dev, hostname: HOSTNAME, port: PORT });
const handle = app.getRequestHandler();
let upgradeHandler = null;
try {
  // getUpgradeHandler() must be called after prepare() in Next 16.
  upgradeHandler = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null;
} catch {
  upgradeHandler = null;
}

/** Lazy-load the game server after Next is ready (keeps require cache clean). */
let harvestServer = null;

await app.prepare();
try {
  upgradeHandler = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null;
} catch {
  upgradeHandler = null;
}

// A tiny shared HTTP server.
const server = http.createServer(async (req, res) => {
  try {
    // Health endpoint for deployment checks / diagnostics.
    if (req.url === '/api/harvest/health') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, gameServer: Boolean(harvestServer), now: Date.now() }));
      return;
    }
    await handle(req, res);
  } catch (err) {
    console.error('[server] unhandled error', err);
    try {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } catch {}
  }
});

server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.split('?')[0] === '/ws/harvest') {
    if (!harvestServer) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    harvestServer.handleUpgrade(req, socket, head);
    return;
  }
  if (upgradeHandler) {
    // Forward (HMR in dev, Next internals) — must not throw.
    Promise.resolve(upgradeHandler(req, socket, head)).catch((err) => {
      console.error('[server] next upgrade failed', err);
      try { socket.destroy(); } catch {}
    });
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOSTNAME, () => {
  // Start the game server AFTER listen so it can attach to the same HTTP server.
  import('./harvest-server.mjs').then((mod) => {
    harvestServer = mod.createHarvestServer(server);
    console.log(`[server] Next + Harvest game server listening on http://${HOSTNAME}:${PORT} (dev=${dev})`);
  }).catch((err) => {
    console.error('[server] failed to start harvest server', err);
  });
});

function shutdown() {
  console.log('[server] shutting down...');
  if (harvestServer) {
    try { harvestServer.stop(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
