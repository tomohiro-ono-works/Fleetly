const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.PW_STATIC_HOST || '127.0.0.1';
const PORT = Number(process.env.PW_STATIC_PORT || 4173);
const URL = `http://${HOST}:${PORT}/static/home.html`;
const RUNTIME_FILE = path.join(__dirname, '.pw-static-server.runtime.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeRuntime(data) {
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function removeRuntime() {
  try {
    fs.unlinkSync(RUNTIME_FILE);
  } catch (_) {
    // ignore
  }
}

function isUrlAvailable(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const status = Number(res.statusCode || 0);
      res.resume();
      resolve(status >= 200 && status <= 403);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    if (await isUrlAvailable(url)) return true;
    await sleep(100);
  }
  return false;
}

module.exports = async () => {
  if (await isUrlAvailable(URL)) {
    writeRuntime({ managed: false, host: HOST, port: PORT, url: URL, pid: null });
    return;
  }

  const child = spawn(
    process.execPath,
    ['playwright_static_server.js', '--host', HOST, '--port', String(PORT)],
    {
      cwd: __dirname,
      stdio: 'ignore',
      windowsHide: true,
    }
  );

  if (!child.pid) {
    throw new Error('failed to start static server process');
  }

  child.unref();
  writeRuntime({ managed: true, host: HOST, port: PORT, url: URL, pid: child.pid });

  const ok = await waitForUrl(URL, 120000);
  if (ok) return;

  removeRuntime();
  throw new Error(`static server did not become ready: ${URL}`);
};
