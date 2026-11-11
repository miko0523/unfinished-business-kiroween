import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

export const SUBPATH_PREFIX = '/unfinished-business/';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 用 Node 内置 http 把 dist/ 挂在 /unfinished-business/ 前缀下，模拟 GitHub Pages 子路径。 */
export async function startSubpathServer(distDir = resolve('dist')): Promise<{ server: Server; origin: string }> {
  const root = resolve(distDir);
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith(SUBPATH_PREFIX)) {
        res.writeHead(404).end('not found');
        return;
      }
      let rel = decodeURIComponent(url.pathname.slice(SUBPATH_PREFIX.length));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(root, rel));
      if (file !== root && !file.startsWith(root + '/')) {
        res.writeHead(403).end('forbidden');
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    })();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('subpath server failed to bind');
  return { server, origin: `http://127.0.0.1:${addr.port}` };
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((ok) => server.close(() => ok()));
}
