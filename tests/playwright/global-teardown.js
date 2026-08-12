const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const RUNTIME_FILE = path.join(__dirname, '.pw-static-server.runtime.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRuntime() {
  try {
    const raw = fs.readFileSync(RUNTIME_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
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
    if (!url) return resolve(false);
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

async function waitForDown(url, timeoutMs) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const up = await isUrlAvailable(url);
    if (!up) return true;
    await sleep(100);
  }
  return false;
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  process.kill(pid, 'SIGTERM');
}

module.exports = async () => {
  const runtime = readRuntime();
  removeRuntime();
  if (!runtime || !runtime.managed || !runtime.pid) return;

  try {
    killProcessTree(runtime.pid);
  } catch (_) {
    // ignore: already exited
  }

  await waitForDown(String(runtime.url || ''), 5000);
};
