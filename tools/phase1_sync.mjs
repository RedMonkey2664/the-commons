#!/usr/bin/env node
/**
 * Phase 1 multiplayer sync test.
 *
 *   node tools/phase1_sync.mjs [--headed]
 *
 * Boots the real Colyseus server and two independent browser contexts, then
 * asserts they agree. State desync is the highest-risk-of-silent-bugs part of
 * this build — it looks fine on the screen you're watching and wrong on the one
 * you aren't — so every check compares ONE CLIENT'S VIEW OF ANOTHER against
 * that other client's own state, rather than checking either in isolation.
 *
 * Covered:
 *   - both clients connect, see each other, and get distinct sessions
 *   - walking propagates: B's copy of A converges on A's real tile
 *   - turning in place propagates (facing is state, not just animation)
 *   - server-authoritative collision: a blocked move moves nobody
 *   - a client CANNOT set its own position — a locally forced teleport is
 *     overruled by the server and never reaches the other client
 *   - disconnect removes the avatar
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5180;
const URL = `http://localhost:${CLIENT_PORT}/`;
const SCENE_KEY = 'TownSquareScene';

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

// ---------------------------------------------------------------------------
// processes
// ---------------------------------------------------------------------------

const isWin = process.platform === 'win32';

function spawnAndWait(command, args, cwd, readyPattern, label) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });

  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error(`${label} did not start in 90s`)), 90_000);
    const onData = (buffer) => {
      const text = buffer.toString();
      if (readyPattern.test(text)) {
        clearTimeout(timeout);
        resolvePromise(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      rejectPromise(new Error(`${label} exited early with code ${code}`));
    });
  });
}

function kill(child) {
  if (!child) return;
  child.kill();
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
}

// ---------------------------------------------------------------------------
// client helpers
// ---------------------------------------------------------------------------

async function openClient(browser, displayName) {
  const context = await browser.newContext({ viewport: { width: 640, height: 440 } });
  // Separate contexts mean separate localStorage, so the two clients don't
  // share an identity. Seed the name to skip the title screen.
  await context.addInitScript((name) => {
    localStorage.setItem('commons.session', JSON.stringify({ displayName: name }));
  }, displayName);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (key) => Boolean(window.__COMMONS__?.game?.scene?.getScene(key)?.player),
    SCENE_KEY,
    { timeout: 30_000 },
  );
  // Wait for the room join to settle.
  await page.waitForFunction(
    (key) => Boolean(window.__COMMONS__?.game?.scene?.getScene(key)?.network?.isConnected),
    SCENE_KEY,
    { timeout: 30_000 },
  );

  return { page, context, errors, displayName };
}

async function netState(client) {
  return client.page.evaluate((key) => {
    const scene = window.__COMMONS__.game.scene.getScene(key);
    return {
      sessionId: scene.network?.sessionId ?? null,
      connected: Boolean(scene.network?.isConnected),
      tile: { ...scene.player.tile },
      facing: scene.player.facing,
      remotes: scene.multiplayer ? scene.multiplayer.remoteSnapshot : [],
    };
  }, SCENE_KEY);
}

async function holdKey(client, key, ms) {
  await client.page.keyboard.down(key);
  await client.page.waitForTimeout(ms);
  await client.page.keyboard.up(key);
  await client.page.waitForTimeout(300);
}

/** Poll until `predicate` holds or the budget runs out. Returns the last value. */
async function waitFor(fn, predicate, timeoutMs = 4000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, stepMs));
    last = await fn();
  }
  return last;
}

const sameTile = (a, b) => a && b && a.x === b.x && a.y === b.y;

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

let server;
let vite;
let browser;

try {
  console.log('starting game server...');
  server = await spawnAndWait('npx', ['tsx', 'src/index.ts'], resolve(repoRoot, 'server'), /listening on ws:/, 'server');

  console.log('starting dev client...');
  vite = await spawnAndWait(
    'npx',
    ['vite', '--port', String(CLIENT_PORT), '--strictPort'],
    resolve(repoRoot, 'client'),
    /ready in|Local:/,
    'vite',
  );

  browser = await chromium.launch({ headless: !headed });

  console.log('\nconnect');
  const alpha = await openClient(browser, 'Alpha');
  const beta = await openClient(browser, 'Beta');
  await alpha.page.waitForTimeout(900);

  let a = await netState(alpha);
  let b = await netState(beta);

  check('client A connected', a.connected === true);
  check('client B connected', b.connected === true);
  check('sessions are distinct', a.sessionId !== b.sessionId, `${a.sessionId} / ${b.sessionId}`);

  b = await waitFor(() => netState(beta), (s) => s.remotes.length === 1);
  a = await waitFor(() => netState(alpha), (s) => s.remotes.length === 1);
  check('A sees exactly one other player', a.remotes.length === 1, `saw ${a.remotes.length}`);
  check('B sees exactly one other player', b.remotes.length === 1, `saw ${b.remotes.length}`);
  check('B\'s copy of A is A\'s session', b.remotes[0]?.id === a.sessionId);

  // --- walking propagates -------------------------------------------------
  console.log('\nmovement sync');
  await holdKey(alpha, 'KeyW', 600);
  a = await netState(alpha);
  b = await waitFor(() => netState(beta), (s) => sameTile(s.remotes[0], a.tile));

  check('A actually moved', a.tile.y < 12, `y=${a.tile.y}`);
  check("B's copy of A matches A's tile", sameTile(b.remotes[0], a.tile),
    `B saw ${JSON.stringify(b.remotes[0])}, A is ${JSON.stringify(a.tile)}`);
  check("B's copy of A faces up", b.remotes[0]?.facing === 'up', b.remotes[0]?.facing);

  // A must not have moved B.
  check('A is not affected by B', b.tile.x === 15 && b.tile.y === 12, JSON.stringify(b.tile));

  // --- turning in place propagates ---------------------------------------
  console.log('\nfacing sync');
  await holdKey(alpha, 'KeyA', 40); // brief: turn without committing a step
  a = await netState(alpha);
  b = await waitFor(() => netState(beta), (s) => s.remotes[0]?.facing === a.facing);
  check("B sees A's facing after a turn", b.remotes[0]?.facing === a.facing,
    `B saw ${b.remotes[0]?.facing}, A is ${a.facing}`);

  // --- server-authoritative collision ------------------------------------
  console.log('\nserver-authoritative collision');
  // Walk B east into sign_welcome at (16,12) from spawn (15,12).
  await holdKey(beta, 'KeyD', 500);
  b = await netState(beta);
  a = await waitFor(() => netState(alpha), (s) => s.remotes[0]?.facing === 'right');

  check('B did not walk through the signpost', b.tile.x === 15, `x=${b.tile.x}`);
  check("A's copy of B also stayed put", a.remotes[0]?.x === 15, `x=${a.remotes[0]?.x}`);
  check("A sees B turned to face the obstacle", a.remotes[0]?.facing === 'right', a.remotes[0]?.facing);

  // --- a client cannot set its own position ------------------------------
  console.log('\nposition authority');
  // Force B's LOCAL position somewhere it never legitimately walked. The server
  // knows nothing about this, so its next validated move must overrule it.
  await beta.page.evaluate((key) => {
    window.__COMMONS__.game.scene.getScene(key).player.movement.teleport({ x: 5, y: 5 }, 'down');
  }, SCENE_KEY);
  await beta.page.waitForTimeout(200);

  const forced = await netState(beta);
  check('local teleport took effect client-side', forced.tile.x === 5 && forced.tile.y === 5, JSON.stringify(forced.tile));

  // A never saw the bogus position, because it was never sent.
  a = await netState(alpha);
  check("the forced position never reached A", a.remotes[0]?.x === 15, `A saw x=${a.remotes[0]?.x}`);

  // Now B sends a legitimate intent. The server computes from ITS position.
  await holdKey(beta, 'KeyW', 200);
  b = await waitFor(() => netState(beta), (s) => s.tile.x === 15, 5000);
  check('server overruled the forged position', b.tile.x === 15, JSON.stringify(b.tile));
  check('server put B back on its own authoritative column', b.tile.y <= 12 && b.tile.y >= 10, JSON.stringify(b.tile));

  // --- screenshots --------------------------------------------------------
  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  await alpha.page.screenshot({ path: resolve(shotDir, 'phase1_client_a.png') });
  await beta.page.screenshot({ path: resolve(shotDir, 'phase1_client_b.png') });

  // --- disconnect ---------------------------------------------------------
  console.log('\ndisconnect');
  await alpha.context.close();
  b = await waitFor(() => netState(beta), (s) => s.remotes.length === 0, 6000);
  check('B sees A disappear on disconnect', b.remotes.length === 0, `still ${b.remotes.length}`);

  const allErrors = [...alpha.errors, ...beta.errors];
  check('no uncaught page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error('\nharness error:', error);
} finally {
  await browser?.close();
  kill(vite);
  kill(server);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
process.exit(0);
