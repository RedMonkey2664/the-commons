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

import { execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5180;
const URL = `http://localhost:${CLIENT_PORT}/`;
const SCENE_KEY = 'TownSquareScene';
const ZONE_KEYS = [
  'TownSquareScene', 'LibraryScene', 'CafeScene',
  'ArcadeScene', 'ParkScene', 'StudyRoomScene',
];

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

/**
 * Free a TCP port before binding it.
 *
 * A previous run that was interrupted can leave a server holding 2567, and the
 * only symptom is the next run's server exiting immediately — which looks like
 * a broken harness rather than a stale process.
 */
function freePort(port) {
  if (!isWin) return;
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
  } catch {
    // findstr exits non-zero when nothing matches, which is the common case.
    return;
  }
  const pids = new Set(
    out
      .split(/\r?\n/)
      .filter((line) => line.includes('LISTENING'))
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((pid) => pid && pid !== '0'),
  );
  for (const pid of pids) {
    console.log(`  freeing port ${port} (stale pid ${pid})`);
    try {
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
}

function spawnAndWait(command, args, cwd, readyPattern, label) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });

  // Kept so an early exit can report WHY, instead of just a status code.
  const output = [];

  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error(`${label} did not start in 90s`)), 90_000);
    const onData = (buffer) => {
      const text = buffer.toString();
      output.push(text);
      if (readyPattern.test(text)) {
        clearTimeout(timeout);
        resolvePromise(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      const tail = output.join('').trim().split(/\r?\n/).slice(-6).join(' | ');
      rejectPromise(new Error(`${label} exited early with code ${code}: ${tail}`));
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

/**
 * Read whichever zone scene is live, not a fixed one — from Phase 2 the players
 * can be standing in different buildings.
 */
async function netState(client) {
  return client.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const scene = key ? game.scene.getScene(key) : null;
    if (!scene?.player) return { scene: key ?? null, ready: false, remotes: [] };
    return {
      scene: key,
      ready: true,
      sessionId: scene.network?.sessionId ?? null,
      connected: Boolean(scene.network?.isConnected),
      tile: { ...scene.player.tile },
      facing: scene.player.facing,
      sitting: scene.player.isSitting,
      status: scene.player.status,
      remotes: scene.multiplayer ? scene.multiplayer.remoteSnapshot : [],
    };
  }, ZONE_KEYS);
}

/** Ask the live zone scene to transition, then wait for the new one. */
async function enterZone(client, zoneId, sceneKey) {
  await client.page.evaluate(
    ({ keys, zoneId }) => {
      const game = window.__COMMONS__.game;
      const key = keys.find((k) => game.scene.isActive(k));
      game.scene.getScene(key).transitionTo(zoneId);
    },
    { keys: ZONE_KEYS, zoneId },
  );
  await waitForZone(client, sceneKey);
}

async function waitForZone(client, sceneKey, timeout = 20_000) {
  await client.page.waitForFunction(
    (k) => {
      const game = window.__COMMONS__?.game;
      return Boolean(game?.scene?.isActive(k) && game.scene.getScene(k)?.player);
    },
    sceneKey,
    { timeout },
  );
  await client.page.waitForTimeout(600);
}

/** Press Space long enough to span frames (Phaser drops sub-frame presses). */
async function tapSpace(client) {
  await client.page.keyboard.down('Space');
  await client.page.waitForTimeout(90);
  await client.page.keyboard.up('Space');
  await client.page.waitForTimeout(200);
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
  freePort(2567);
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
  // West along the plaza from the shared spawn: clear of the fountain rim,
  // the benches and the welcome sign.
  // Both clients start on the map's spawn tile; every assertion below is
  // relative to it rather than to the column the square used to spawn on.
  const spawnTile = { x: a.tile.x, y: a.tile.y };

  await holdKey(alpha, 'KeyA', 600);
  a = await netState(alpha);
  b = await waitFor(() => netState(beta), (s) => sameTile(s.remotes[0], a.tile));

  check('A actually moved', a.tile.x < spawnTile.x, `x=${a.tile.x} from ${spawnTile.x}`);
  check("B's copy of A matches A's tile", sameTile(b.remotes[0], a.tile),
    `B saw ${JSON.stringify(b.remotes[0])}, A is ${JSON.stringify(a.tile)}`);
  check("B's copy of A faces left", b.remotes[0]?.facing === 'left', b.remotes[0]?.facing);

  // A must not have moved B.
  check(
    'A is not affected by B',
    b.tile.x === spawnTile.x && b.tile.y === spawnTile.y,
    `${JSON.stringify(b.tile)} vs spawn ${JSON.stringify(spawnTile)}`,
  );

  // --- turning in place propagates ---------------------------------------
  console.log('\nfacing sync');
  await holdKey(alpha, 'KeyW', 40); // brief: turn without committing a step
  a = await netState(alpha);
  b = await waitFor(() => netState(beta), (s) => s.remotes[0]?.facing === a.facing);
  check("B sees A's facing after a turn", b.remotes[0]?.facing === a.facing,
    `B saw ${b.remotes[0]?.facing}, A is ${a.facing}`);

  // --- server-authoritative collision ------------------------------------
  console.log('\nserver-authoritative collision');
  // Walk B east into sign_welcome at (20,20) from spawn (19,20).
  // Read rather than restated: this asserted "x === 19" for a spawn column that
  // moved when the square was redrawn, and said the signpost had been walked
  // through when in fact the test was looking at the wrong tile.
  const blockedFrom = b.tile.x;
  await holdKey(beta, 'KeyD', 500);
  b = await netState(beta);
  a = await waitFor(() => netState(alpha), (s) => s.remotes[0]?.facing === 'right');

  check('B did not walk through the signpost', b.tile.x === blockedFrom, `x=${b.tile.x}`);
  check("A's copy of B also stayed put", a.remotes[0]?.x === blockedFrom, `x=${a.remotes[0]?.x}`);
  check("A sees B turned to face the obstacle", a.remotes[0]?.facing === 'right', a.remotes[0]?.facing);

  // --- a client cannot set its own position ------------------------------
  console.log('\nposition authority');
  // Where the SERVER thinks B is, before anything is forged. Every assertion
  // below is relative to this rather than to a hard-coded tile.
  const authoritative = { x: b.tile.x, y: b.tile.y };

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
  check(
    'the forced position never reached A',
    a.remotes[0]?.x === authoritative.x && a.remotes[0]?.y === authoritative.y,
    `A saw ${a.remotes[0]?.x},${a.remotes[0]?.y}, server had ${authoritative.x},${authoritative.y}`,
  );

  // Now B sends a legitimate intent. The server computes from ITS position.
  await holdKey(beta, 'KeyW', 200);
  b = await waitFor(() => netState(beta), (s) => s.tile.x === authoritative.x, 5000);
  check('server overruled the forged position', b.tile.x === authoritative.x, JSON.stringify(b.tile));
  // A 200ms hold is one or two 130ms steps depending on where in the tween it
  // lands, so the assertion is "walked north from where the SERVER had it",
  // not an exact tile — and emphatically nowhere near the forged (5,5).
  check(
    'server put B back on its own authoritative column',
    Math.abs(b.tile.y - authoritative.y) <= 2 && b.tile.y <= authoritative.y,
    `${JSON.stringify(b.tile)} vs ${JSON.stringify(authoritative)}`,
  );
  check(
    'B is nowhere near the position it forged',
    Math.abs(b.tile.x - 5) + Math.abs(b.tile.y - 5) > 4,
    JSON.stringify(b.tile),
  );

  // --- screenshots --------------------------------------------------------
  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  await alpha.page.screenshot({ path: resolve(shotDir, 'phase1_client_a.png') });
  await beta.page.screenshot({ path: resolve(shotDir, 'phase1_client_b.png') });

  // --- zone transitions with two clients ----------------------------------
  // Both players walk into the Library. Each transition is a room LEAVE and a
  // room JOIN, so this is where presence most easily breaks: a player who
  // stays joined to the room they walked out of, or never appears in the new
  // one, looks completely normal on their own screen.
  console.log('\nmultiplayer zone transitions');

  // Driven through the scene's own transition rather than by walking onto the
  // door tile. A local teleport to the door would desync this client from the
  // server, and the resulting correction cancels the step tween mid-move — so
  // onArrive never fires and the door never triggers. The door-step path itself
  // is covered single-player in tools/phase2_world.mjs; what matters here is
  // the room LEAVE and JOIN either side of it.
  await enterZone(alpha, 'library', 'LibraryScene');
  a = await netState(alpha);
  check('A moved to the Library', a.scene === 'LibraryScene', `${a.scene}`);

  b = await waitFor(() => netState(beta), (s) => s.remotes.length === 0, 6000);
  check('B no longer sees A in the square', b.remotes.length === 0, `still ${b.remotes.length}`);

  await enterZone(beta, 'library', 'LibraryScene');
  b = await netState(beta);
  check('B followed A into the Library', b.scene === 'LibraryScene', `${b.scene}`);

  b = await waitFor(() => netState(beta), (s) => s.remotes.length === 1, 8000);
  a = await waitFor(() => netState(alpha), (s) => s.remotes.length === 1, 8000);
  check('they find each other in the Library room', b.remotes.length === 1 && a.remotes.length === 1,
    `A sees ${a.remotes.length}, B sees ${b.remotes.length}`);

  // --- status propagation -------------------------------------------------
  // 11: status flows from location and action. The other client is the only
  // place that can prove it actually left this machine.
  console.log('\nstatus sync');

  // Driven through the multiplayer system rather than by walking to a pod and
  // sitting. Placing A on a pod tile means teleporting it locally, which
  // desyncs from the server; the correction that follows calls teleport(),
  // which resets SITTING back to IDLE and stands the player straight back up.
  //
  // The sit -> status binding is covered single-player in phase2_world.mjs
  // ("status becomes studying, with no toggle"). What can only be proved with
  // two clients is the half after it: that the status actually leaves this
  // machine and lands on the other one.
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).multiplayer.pushStatus('studying');
  }, ZONE_KEYS);

  b = await waitFor(() => netState(beta), (s) => s.remotes[0]?.status === 'studying', 6000);
  check("B sees A's status as studying", b.remotes[0]?.status === 'studying', b.remotes[0]?.status);

  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).multiplayer.pushStatus('idle');
  }, ZONE_KEYS);

  b = await waitFor(() => netState(beta), (s) => s.remotes[0]?.status === 'idle', 6000);
  check('B sees A go back to idle', b.remotes[0]?.status === 'idle', b.remotes[0]?.status);

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
