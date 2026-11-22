import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Lightweight dev-only in-memory state + SSE sync bridge.
 * Allows testing multi-device (Main Screen + Host Panel + Phones on same Wi-Fi)
 * during `npm run dev` even before Supabase credentials are configured.
 * Production builds on Vercel use Supabase Realtime directly.
 */
function localDevSyncPlugin(): Plugin {
  const rooms = new Map<string, string>();
  const clients = new Map<string, Set<ServerResponse>>();

  function broadcast(code: string, payload: string) {
    const subs = clients.get(code);
    if (!subs) return;
    for (const res of subs) {
      res.write(`data: ${payload}\n\n`);
    }
  }

  return {
    name: 'local-dev-sync',
    configureServer(server) {
      server.middlewares.use('/api/local-sync', (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const code = (url.searchParams.get('code') || '').trim();

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (!code) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing room code' }));
          return;
        }

        // SSE stream for instant updates
        if (req.method === 'GET' && url.pathname === '/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(': connected\n\n');

          if (!clients.has(code)) clients.set(code, new Set());
          clients.get(code)!.add(res);

          req.on('close', () => {
            clients.get(code)?.delete(res);
          });
          return;
        }

        // Fetch current room snapshot
        if (req.method === 'GET') {
          const data = rooms.get(code);
          res.setHeader('Content-Type', 'application/json');
          if (!data) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: 'Room not found' }));
            return;
          }
          res.end(data);
          return;
        }

        // Save room snapshot or broadcast event
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (url.pathname === '/event') {
                broadcast(code, JSON.stringify({ kind: 'event', event: parsed }));
              } else {
                const serialized = JSON.stringify(parsed);
                rooms.set(code, serialized);
                broadcast(code, JSON.stringify({ kind: 'snapshot', snapshot: parsed }));
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localDevSyncPlugin()],
  // Support both VITE_* and Vercel's Supabase integration NEXT_PUBLIC_* env vars
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 3000,
    host: true,
  },
});
