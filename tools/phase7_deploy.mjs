#!/usr/bin/env node
/**
 * Phase 7 test: the deployed shape, not the dev shape.
 *
 *   node tools/phase7_deploy.mjs [--headed]
 *
 * Every other suite runs the client through the Vite dev server on the same
 * host as the game server. A real deployment is neither of those things: the
 * client is a pre-built static bundle on one origin, the server is on another,
 * and the server URL is frozen into the bundle at BUILD time. That difference
 * is not cosmetic — it is exactly why the first Vercel deploy showed OFFLINE
 * for every visitor while every existing test passed.
 *
 * So this suite:
 *   - builds the client the way a host builds it, with VITE_SERVER_URL set
 *   - proves the URL was actually baked in, and that the localhost default is
 *     NOT what ships
 *   - serves the bundle from a DIFFERENT origin to the server, so the request
 *     is genuinely cross-origin
 *   - connects two browsers and checks they reach ONLINE and see each other
 *   - checks the CORS allowlist both accepts and refuses
 *
 * The build deliberately points at 127.0.0.1 while the page is served from
 * localhost. Those are different origins to a browser, which is what makes the
 * cross-origin path real rather than simulated — and it also means the
 * assertion "the configured URL was baked in" cannot pass by accident, because
 * the compiled-in default is localhost.
 */

import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const STATIC_PORT = 4173;
const SERVER_PORT = 2567;
const SERVER_HOST = '127.0.0.1';
const CLIENT_ORIGIN = `http://localhost:${STATIC_PORT}`;
const SERVER_URL = `ws://${SERVER_HOST}:${SERVER_PORT}`;
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

/** The dumbest possible static host — stands in for Vercel. */
function serveStatic(root, port) {
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  };
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = join(root, url === '/' ? 'index.html' : url);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((res) => server.listen(port, () => res(server)));
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
let staticServer;
let browser;

try {
  rmSync(resolve(repoRoot, 'server', '.data', 'store.json'), { force: true });

  // --- build the client the way a host would ------------------------------
  console.log('building the client bundle (this is the slow part)...');
  const distDir = resolve(repoRoot, 'client', 'dist');
  rmSync(distDir, { recursive: true, force: true });

  execSync('npm run build --workspace client', {
    cwd: repoRoot,
    stdio: 'pipe',
    env: { ...process.env, VITE_SERVER_URL: SERVER_URL },
  });

  console.log('\nbuild output');
  check('the build produced an index.html', existsSync(join(distDir, 'index.html')));

  const bundles = walk(distDir).filter((f) => f.endsWith('.js'));
  check('the build produced JavaScript', bundles.length > 0, `${bundles.length} files`);

  const allJs = bundles.map((f) => readFileSync(f, 'utf8')).join('\n');
  check('the configured server URL is baked into the bundle',
    allJs.includes(SERVER_URL), SERVER_URL);
  // The whole Vercel failure in one assertion: a bundle still carrying the dev
  // default points every visitor at their own machine.
  check('the localhost dev default did NOT ship',
    !allJs.includes('ws://localhost:2567'), 'bundle still contains ws://localhost:2567');

  // Maps must be in the bundle too — the client loads them at runtime.
  check('map JSON is published with the bundle',
    existsSync(join(distDir, 'maps', 'town_square.json')));

  // --- start the server the way a host would ------------------------------
  console.log('\nstarting server with a CORS allowlist...');
  freePort(SERVER_PORT);
  server = await spawnAndWait(
    'npm', ['start', '--workspace', 'server'], repoRoot, /listening on ws:/, 'server',
    { NODE_ENV: 'production', ALLOWED_ORIGINS: CLIENT_ORIGIN, PORT: String(SERVER_PORT) },
  );

  staticServer = await serveStatic(distDir, STATIC_PORT);

  // --- CORS, from outside a browser ---------------------------------------
  console.log('\ncors');
  const allowed = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}/health`, {
    headers: { Origin: CLIENT_ORIGIN },
  });
  check('the allowed origin is echoed back',
    allowed.headers.get('access-control-allow-origin') === CLIENT_ORIGIN,
    String(allowed.headers.get('access-control-allow-origin')));

  const refused = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}/health`, {
    headers: { Origin: 'https://not-your-site.example' },
  });
  check('an origin outside the allowlist is not granted access',
    refused.headers.get('access-control-allow-origin') === null,
    String(refused.headers.get('access-control-allow-origin')));

  // --- two real browsers, on the static origin ----------------------------
  console.log('\nplaying from the built bundle');
  browser = await chromium.launch({ headless: !headed });

  const open = async (name, userId) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await context.addInitScript(
      ({ name, userId }) => {
        localStorage.setItem('commons.session', JSON.stringify({ displayName: name, userId }));
      },
      { name, userId },
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(CLIENT_ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
      undefined,
      { timeout: 45_000 },
    );
    return { page, errors };
  };

  const alpha = await open('Alpha', 'u_p7_alpha');
  const beta = await open('Beta', 'u_p7_beta');

  // Connection is the whole point, so wait for it rather than sampling once.
  const online = async (client) =>
    client.page
      .waitForFunction(
        () => window.__COMMONS__.game.scene.getScene('UIScene')?.hud?.isConnected === true,
        undefined,
        { timeout: 25_000 },
      )
      .then(() => true)
      .catch(() => false);

  check('the built client connects to the server', await online(alpha));
  check('a second built client connects too', await online(beta));

  await alpha.page.waitForTimeout(1500);

  const roster = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    return (scene.multiplayer?.roster ?? []).map((p) => p.displayName);
  });
  check('they see each other across origins', roster.includes('Beta'), JSON.stringify(roster));

  const status = await alpha.page.evaluate(() => {
    const hud = window.__COMMONS__.game.scene.getScene('UIScene').hud;
    return { connected: hud.isConnected, label: hud.statusLabel.text };
  });
  check('the HUD reports ONLINE, not OFFLINE',
    status.connected === true && status.label === 'ONLINE', JSON.stringify(status));

  const errors = [...alpha.errors, ...beta.errors];
  check('no page errors from the production bundle', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness: ${error.message}`);
  console.error(error);
} finally {
  await browser?.close();
  staticServer?.close();
  kill(server);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
