#!/usr/bin/env node
/**
 * Phase 7b test: the ONE-URL deployment.
 *
 *   node tools/phase7b_single_origin.mjs [--headed]
 *
 * phase7_deploy.mjs covers the two-origin shape — a static client on one host,
 * the game server on another, the server URL supplied to the bundle. This suite
 * covers the shape that is actually recommended for hosting the game, because
 * it is the one with nothing to configure: the server serves the client it was
 * deployed with, so there is a single origin.
 *
 * That removes both settings that can be wrong. The client derives `wss://`
 * from the page it was loaded by, so no server address is baked in or pasted;
 * and a same-origin request is not a CORS request, so no allowlist has to name
 * the client back. Testing it separately matters because those are exactly the
 * two things a first deploy gets wrong, and a suite that supplies both by hand
 * cannot notice that neither was needed.
 *
 * So this suite deliberately builds with VITE_SERVER_URL UNSET and starts the
 * server with ALLOWED_ORIGINS UNSET — the state a host leaves them in when you
 * configure nothing — and then plays two browsers against the result.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const PORT = 2571;
const ORIGIN = `http://localhost:${PORT}`;
const isWin = process.platform === 'win32';
const headed = process.argv.includes('--headed');

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function freePort(port) {
  if (!isWin) return;
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const pid of new Set(
    out.split(/\r?\n/).filter((l) => l.includes('LISTENING')).map((l) => l.trim().split(/\s+/).pop()),
  )) {
    if (pid && pid !== '0') {
      try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' }); } catch { /* gone */ }
    }
  }
}

function spawnAndWait(command, args, cwd, readyPattern, label, env = {}) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin, env: { ...process.env, ...env },
  });
  const output = [];
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} did not start in 90s`)), 90_000);
    const on = (b) => {
      const text = b.toString();
      output.push(text);
      if (readyPattern.test(text)) { clearTimeout(t); res(child); }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', (code) => {
      clearTimeout(t);
      rej(new Error(`${label} exited early (${code}): ${output.join('').trim().split(/\r?\n/).slice(-6).join(' | ')}`));
    });
  });
}

function kill(child) {
  if (!child) return;
  child.kill();
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let server;
let browser;

try {
  freePort(PORT);
  rmSync(resolve(repoRoot, 'server', '.data', 'store.json'), { force: true });

  // --- build the way a host builds it, configuring nothing -----------------
  console.log('building the client bundle (this is the slow part)...');
  const distDir = resolve(repoRoot, 'client', 'dist');
  rmSync(distDir, { recursive: true, force: true });

  // VITE_SERVER_URL is deliberately stripped rather than merely left alone: a
  // developer with it exported would otherwise test a different deployment.
  const buildEnv = { ...process.env, NODE_ENV: 'production' };
  delete buildEnv.VITE_SERVER_URL;
  execSync('npm run build --workspace client', { cwd: repoRoot, stdio: 'inherit', env: buildEnv });

  check('the build produced a bundle', existsSync(join(distDir, 'index.html')));

  const bundle = walk(distDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  // Rule 4 in resolveServerUrl(): with nothing configured, a production build
  // falls through to the page's own origin. If the dev default survived into
  // the bundle instead, every visitor's browser would dial their own machine —
  // which is the failure the first deployment of this game actually shipped.
  check('the localhost dev default did not ship', !bundle.includes('ws://localhost:2567'));

  // --- start the server the way a host starts it ---------------------------
  const startEnv = { NODE_ENV: 'production', PORT: String(PORT) };
  delete startEnv.ALLOWED_ORIGINS;
  server = await spawnAndWait(
    'npm', ['start', '--workspace', 'server'], repoRoot,
    /listening on/, 'server', startEnv,
  );

  const index = await fetch(`${ORIGIN}/`);
  check('the server serves the client at /', index.ok &&
    (index.headers.get('content-type') ?? '').includes('text/html'),
    `${index.status} ${index.headers.get('content-type')}`);

  const health = await fetch(`${ORIGIN}/health`).then((r) => r.json());
  check('the API is still mounted under the client', health.ok === true, JSON.stringify(health));

  // publicDir is the repo-level assets/ folder, so the maps the browser fetches
  // ship inside dist rather than being read off the server's own disk.
  const map = await fetch(`${ORIGIN}/maps/town_square.json`);
  check('map assets are served from the bundle', map.ok, String(map.status));

  // The SPA fallback returns index.html for unknown paths, and Colyseus owns
  // /matchmake — if the fallback swallowed it, joining would fail with HTML.
  const matchmake = await fetch(`${ORIGIN}/matchmake/joinOrCreate/zone`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  check('the SPA fallback does not swallow /matchmake',
    !(matchmake.headers.get('content-type') ?? '').includes('text/html'),
    String(matchmake.headers.get('content-type')));

  // --- two real browsers, on the one origin --------------------------------
  console.log('\nplaying from the deployed origin');
  browser = await chromium.launch({ headless: !headed });

  const open = async (name, userId) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await context.addInitScript(
      ({ name, userId }) => {
        localStorage.setItem('commons.session', JSON.stringify({ displayName: name, userId }));
        // A server remembered from an earlier session would defeat the point:
        // this asserts the origin alone is enough.
        localStorage.removeItem('commons.serverUrl');
      },
      { name, userId },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
      undefined,
      { timeout: 45_000 },
    );
    return { page, errors };
  };

  const alpha = await open('Alpha', 'u_p7b_alpha');
  const beta = await open('Beta', 'u_p7b_beta');

  const online = async (client) =>
    client.page
      .waitForFunction(
        () => window.__COMMONS__.game.scene.getScene('UIScene')?.hud?.isConnected === true,
        undefined,
        { timeout: 25_000 },
      )
      .then(() => true)
      .catch(() => false);

  check('a visitor connects with nothing configured', await online(alpha));
  check('a second visitor connects too', await online(beta));

  await alpha.page.waitForTimeout(1500);

  const roster = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    return (scene.multiplayer?.roster ?? []).map((p) => p.displayName);
  });
  check('the two visitors are in the same town', roster.includes('Beta'), JSON.stringify(roster));

  const status = await alpha.page.evaluate(() => {
    const hud = window.__COMMONS__.game.scene.getScene('UIScene').hud;
    return { connected: hud.isConnected, label: hud.statusLabel.text };
  });
  check('the HUD reports ONLINE, not OFFLINE',
    status.connected === true && status.label === 'ONLINE', JSON.stringify(status));

  // Nothing was pasted and no ?server= was used, so a stored override would
  // mean the connection came from somewhere other than the page's own origin.
  const remembered = await alpha.page.evaluate(() => localStorage.getItem('commons.serverUrl'));
  check('no server override was needed or stored', remembered === null, String(remembered));

  const errors = [...alpha.errors, ...beta.errors];
  check('no page errors from the production bundle', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness: ${error.message}`);
  console.error(error);
} finally {
  await browser?.close();
  kill(server);
  freePort(PORT);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
