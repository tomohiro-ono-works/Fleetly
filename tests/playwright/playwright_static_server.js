const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const repoRoot = path.resolve(__dirname, '..', '..');
const staticRoot = path.resolve(repoRoot, 'static');

function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 4173 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = String(argv[i] || '').trim();
    const value = String(argv[i + 1] || '').trim();
    if (key === '--host' && value) {
      out.host = value;
      i += 1;
      continue;
    }
    if (key === '--port' && value) {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0 && n < 65536) out.port = n;
      i += 1;
    }
  }
  return out;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function resolveStaticFile(requestUrl) {
  let pathname = '/';
  try {
    pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  } catch (_) {
    return null;
  }
  if (!pathname.startsWith('/static/')) return null;
  const relative = pathname.slice('/static/'.length);
  if (!relative) return null;
  const candidate = path.resolve(staticRoot, relative);
  if (!candidate.startsWith(staticRoot + path.sep) && candidate !== staticRoot) return null;
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  return candidate;
}

const args = parseArgs(process.argv);
const server = http.createServer((req, res) => {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Only GET and HEAD are allowed.');
    return;
  }
  const filePath = resolveStaticFile(req.url || '/');
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }
  fs.readFile(filePath, (error, body) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to read file.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  });
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  // Failsafe: force-exit if close callback does not fire.
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

server.listen(args.port, args.host, () => {
  // Keep the line stable because Playwright prints it in webServer logs.
  console.log(`Serving playwright static assets on http://${args.host}:${args.port}/static/home.html`);
});
