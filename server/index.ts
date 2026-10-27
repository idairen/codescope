import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app';
const base = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
const production = process.argv.includes('--production');
const vite = production
  ? undefined
  : await (
      await import('vite')
    ).createServer({
      root: base,
      server: {
        middlewareMode: true,
        host: '127.0.0.1',
        hmr: { host: '127.0.0.1' },
        allowedHosts: ['localhost', '127.0.0.1'],
      },
      appType: 'spa',
    });
const app = createApplication({
  base,
  port,
  dataDir: process.env.CODESCOPE_DATA_DIR ?? path.join(base, '.codescope'),
  fallback: (req, res) => {
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    void (async () => {
      try {
        const requested = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
        const candidate = path.resolve(base, 'dist', '.' + requested);
        if (
          !candidate.startsWith(path.join(base, 'dist') + path.sep) &&
          candidate !== path.join(base, 'dist')
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        const file = path.extname(requested) ? candidate : path.join(base, 'dist/index.html');
        const data = await fs.readFile(file);
        res.setHeader(
          'Content-Type',
          file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/html; charset=utf-8',
        );
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    })();
  },
});
const server = http.createServer(app.handler);
server.on('error', (error) => {
  console.error(`CodeScope could not listen on 127.0.0.1:${port}: ${error.message}`);
  app.close();
  void vite?.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`CodeScope: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    app.close();
    server.close();
    void vite?.close();
    process.exit(0);
  });
