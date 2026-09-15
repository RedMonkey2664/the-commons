#!/usr/bin/env node
/**
 * Phase 9 test: focus time, and the worlds it buys.
 *
 *   node tools/phase9_progression.mjs [--headed]
 *
 * The claim this suite defends is the one the whole progression system rests
 * on: THE HOURS ARE REAL. Everything else — the map, the rocket, the unlock
 * moment — is decoration on a number, and a number that can be inflated by
 * waiting on a menu, pausing, or opening a developer panel is worthless as a
 * record of studying.
 *
 * So it asserts, against a real server writing real rows:
 *   - a session is recorded ONCE, and for the time actually focused
 *   - paused time is not counted, by either side
 *   - the total survives a reload, because it lives on the server
 *   - developer simulation moves what is DISPLAYED and never what is STORED
 *
 * It runs its own server on its own port with its own DATA_DIR, so it can
 * write real study rows without touching the store you have been playing in.
 *
 * It is slow by nature: MIN_STUDY_SECONDS is 20, so a session that counts has
 * to last longer than that. Roughly two minutes end to end.
 */

import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5192;
const SERVER_PORT = 2572;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const isWin = process.platform === 'win32';
const headed = process.argv.includes('--headed');

/** Long enough to clear MIN_STUDY_SECONDS (20) with room for scheduling. */
const FOCUS_MS = 24_000;
const PAUSE_MS = 7_000;

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

function spawnAndWait(command, args, readyPattern, label, env = {}) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin, env: { ...process.env, ...env },
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
      rej(new Error(`${label} exited early (${code}): ${output.join('').trim().split(/\r?\n/).slice(-5).join(' | ')}`));
    });
  });
}

function kill(child) {
  if (!child) return;
  child.kill();
  if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
}

/** The progression facts, read out of the running game. */
const PROGRESS_STATE = `(() => {
  const p = window.__COMMONS__.progression;
  const game = window.__COMMONS__.game;
  const map = game.scene.getScene('WorldMapScene');
  const ui = game.scene.getScene('UIScene');
  return {
    focusSeconds: p.focusSeconds,
    realFocusSeconds: p.realFocusSeconds,
    simulated: p.isSimulated,
    currentWorld: p.currentWorld.id,
    destination: p.destination ? p.destination.id : null,
    rocketReady: p.rocketReady,
    sessionCount: p.sessionCount,
    reachable: p.isReachable,
    mapActive: !!map && map.scene.isActive(),
    planets: map && map.scene.isActive() ? map.planets.length : 0,
    cardStatus: map && map.scene.isActive() ? map.cardStatus.text : null,
    summaryVisible: ui?.summary?.isVisible ?? false,
  };
})()`;

let server;
let vite;
let browser;
const dataDir = mkdtempSync(join(tmpdir(), 'commons-phase9-'));

try {
  freePort(SERVER_PORT);
  freePort(CLIENT_PORT);

  console.log(`server data dir: ${dataDir}`);
  server = await spawnAndWait('npm', ['start', '--workspace', 'server'], /listening on/, 'server', {
    PORT: String(SERVER_PORT),
    DATA_DIR: dataDir,
    NODE_ENV: 'development',
  });

  vite = await spawnAndWait(
    'npm',
    ['run', 'dev', '--workspace', 'client', '--', '--port', String(CLIENT_PORT), '--strictPort'],
    /Local:|ready in/i,
    'vite',
  );

  browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  // A fresh user each run: totals accumulate per user, and a suite that passes
  // only on an empty store is a suite that passes once.
  const userId = `u_phase9_${Date.now().toString(36)}`;
  await context.addInitScript((id) => {
    localStorage.setItem('commons.session', JSON.stringify({ displayName: 'Journey', userId: id }));
    localStorage.removeItem('commons.progression');
  }, userId);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const open = async () => {
    await page.goto(`http://localhost:${CLIENT_PORT}/?server=${SERVER_URL}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
      undefined,
      { timeout: 45_000 },
    );
    // Into the Library, where the focus pods are.
    await page.evaluate(() => {
      window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player).transitionTo('library');
    });
    await page.waitForFunction(() => Boolean(window.__COMMONS__?.game?.scene?.isActive('LibraryScene')), undefined, { timeout: 25_000 });
    await page.waitForTimeout(900);
  };

  const playerTile = () => page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    return { x: scene.player.tile.x, y: scene.player.tile.y, facing: scene.player.facing };
  });

  /**
   * WALK there, rather than teleporting.
   *
   * A client-side teleport is a move the server never agreed to, and with a
   * server connected it is correctly overruled — the player snaps back to their
   * last authoritative tile mid-test. Walking sends the same intents a person
   * would, so the server and the client agree about where the session happened.
   */
  const walkTo = async (target, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let lastKey = null;
    let stuck = 0;

    while (Date.now() < deadline) {
      const at = await playerTile();
      if (at.x === target.x && at.y === target.y) return true;

      const dx = target.x - at.x;
      const dy = target.y - at.y;
      const horizontal = dx > 0 ? 'KeyD' : 'KeyA';
      const vertical = dy > 0 ? 'KeyS' : 'KeyW';

      // Prefer the longer axis; when a wall or a bookcase stops progress, take
      // the other one for a step. Enough to cross an open room without a
      // pathfinder living in the test suite.
      let key = Math.abs(dx) >= Math.abs(dy) ? (dx !== 0 ? horizontal : vertical) : (dy !== 0 ? vertical : horizontal);
      if (stuck >= 2) {
        key = key === horizontal ? vertical : horizontal;
        stuck = 0;
      }

      await page.keyboard.down(key);
      await page.waitForTimeout(200);
      await page.keyboard.up(key);
      await page.waitForTimeout(90);

      const now = await playerTile();
      if (now.x === at.x && now.y === at.y) stuck += 1;
      else stuck = 0;
      lastKey = key;
    }
    void lastKey;
    return false;
  };

  const sitAtPod = async () => {
    const spot = await page.evaluate(() => {
      const scene = window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
      const here = scene.player.tile;
      // The nearest pod, so the walk is as short as the map allows.
      const pods = scene.zoneMap.interactables.filter((o) => o.kind === 'focus_pod');
      let best = null;
      for (const pod of pods) {
        for (const option of [
          { facing: 'up', tile: { x: pod.tile.x, y: pod.tile.y + 1 } },
          { facing: 'down', tile: { x: pod.tile.x, y: pod.tile.y - 1 } },
          { facing: 'left', tile: { x: pod.tile.x + 1, y: pod.tile.y } },
          { facing: 'right', tile: { x: pod.tile.x - 1, y: pod.tile.y } },
        ]) {
          if (!scene.zoneMap.isWalkable(option.tile)) continue;
          const distance = Math.abs(option.tile.x - here.x) + Math.abs(option.tile.y - here.y);
          if (!best || distance < best.distance) best = { ...option, distance };
        }
      }
      return best;
    });

    const arrived = await walkTo(spot.tile);
    check('walked to a focus pod', arrived === true, JSON.stringify(spot?.tile));

    // Face it, then sit. Tapping turns in place without stepping.
    const turn = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }[spot.facing];
    await page.keyboard.press(turn);
    await page.waitForTimeout(220);
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => window.__COMMONS__.game.scene.getScene('FocusScene')?.scene?.isActive?.() === true,
      undefined,
      { timeout: 10_000 },
    );
  };

  /** Leave Focus Mode and wait for the server write to land. */
  const leaveAndSettle = async () => {
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__COMMONS__.game.scene.getScene('FocusScene')?.scene?.isActive?.() !== true,
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(4500);
  };

  await open();

  console.log('\nrecording a session');
  let state = await page.evaluate(PROGRESS_STATE);
  check('a fresh player starts at zero', state.realFocusSeconds === 0, `${state.realFocusSeconds}s`);
  check('the server is reachable', state.reachable === true);
  check('a fresh player is in the first world', state.currentWorld === 'home', state.currentWorld);

  await sitAtPod();
  await page.waitForTimeout(FOCUS_MS);
  await leaveAndSettle();

  state = await page.evaluate(PROGRESS_STATE);
  const recorded = state.realFocusSeconds;
  check(
    'the session was recorded, once, for what it was worth',
    recorded >= FOCUS_MS / 1000 - 4 && recorded <= FOCUS_MS / 1000 + 12,
    `${recorded}s for a ${FOCUS_MS / 1000}s session`,
  );
  check('it counts as one session', state.sessionCount === 1, String(state.sessionCount));
  check('the session summary appeared', state.summaryVisible === true);

  // The HUD's level line is the real total, not a number of its own.
  await page.waitForTimeout(1200);
  let hudLevel = await page.evaluate(`(() => {
    const hud = window.__COMMONS__.game.scene.getScene('UIScene').hud;
    return {
      label: hud.levelLabel.text,
      hours: hud.levelHours.text,
      total: window.__COMMONS__.progression.focusSeconds,
    };
  })()`);
  check(
    'the HUD shows the recorded focus hours and level',
    hudLevel.label === 'LV.01' && hudLevel.hours === `${(hudLevel.total / 3600).toFixed(1)}h`,
    JSON.stringify(hudLevel),
  );

  console.log('\npersistence');
  await open();
  await page.waitForFunction(
    () => window.__COMMONS__.progression.realFocusSeconds > 0,
    undefined,
    { timeout: 15_000 },
  ).catch(() => {});
  state = await page.evaluate(PROGRESS_STATE);
  check('the total survives a reload', Math.abs(state.realFocusSeconds - recorded) <= 1, `${state.realFocusSeconds}s vs ${recorded}s`);

  console.log('\npaused time is not focus time');
  await sitAtPod();
  await page.waitForTimeout(FOCUS_MS / 2);
  await page.keyboard.press('p');
  await page.waitForTimeout(PAUSE_MS);
  await page.keyboard.press('p');
  await page.waitForTimeout(FOCUS_MS / 2);
  await leaveAndSettle();

  state = await page.evaluate(PROGRESS_STATE);
  const second = state.realFocusSeconds - recorded;
  check(
    'the pause was subtracted from the recorded time',
    second >= FOCUS_MS / 1000 - 5 && second < FOCUS_MS / 1000 + PAUSE_MS / 1000 - 2,
    `${second}s recorded for ${FOCUS_MS / 1000}s focused + ${PAUSE_MS / 1000}s paused`,
  );

  console.log('\ndeveloper simulation');
  const realBefore = state.realFocusSeconds;
  await page.evaluate(() => window.__COMMONS__.progression.simulateHours(15));
  state = await page.evaluate(PROGRESS_STATE);
  check('simulation moves the displayed total', state.simulated === true && state.focusSeconds === 15 * 3600, `${state.focusSeconds}s`);
  check('simulation does NOT move the real total', state.realFocusSeconds === realBefore, `${state.realFocusSeconds}s vs ${realBefore}s`);
  check('simulated hours unlock worlds', state.rocketReady === true && state.destination === 'forest', String(state.destination));

  // 15h opens Low Orbit, the third world: level 3.
  await page.waitForTimeout(1200);
  hudLevel = await page.evaluate(`(() => {
    const hud = window.__COMMONS__.game.scene.getScene('UIScene').hud;
    return {
      label: hud.levelLabel.text,
      hours: hud.levelHours.text,
      total: window.__COMMONS__.progression.focusSeconds,
    };
  })()`);
  check('the HUD level follows the worlds the hours open', hudLevel.label === 'LV.03' && hudLevel.hours === '15.0h', JSON.stringify(hudLevel));

  console.log('\nthe journey screen');
  await page.keyboard.press('j');
  await page.waitForTimeout(1600);
  state = await page.evaluate(PROGRESS_STATE);
  check('J opens the world map', state.mapActive === true);
  check('every world is on the map', state.planets === 5, String(state.planets));

  // A locked world must be visible but clearly locked.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  state = await page.evaluate(PROGRESS_STATE);
  check('locked worlds show what they cost', /LOCKED/.test(state.cardStatus ?? ''), String(state.cardStatus));

  console.log('\nrocket travel');
  await page.evaluate(() => window.__COMMONS__.game.scene.getScene('WorldMapScene').tryLaunch());
  await page.waitForFunction(
    () => window.__COMMONS__.progression.currentWorld.id !== 'home',
    undefined,
    { timeout: 20_000 },
  ).catch(() => {});
  state = await page.evaluate(PROGRESS_STATE);
  check('the rocket travels to the unlocked world', state.currentWorld === 'forest', state.currentWorld);
  check('the map survives the trip', state.mapActive === true);

  console.log('\nsimulation cannot corrupt real progression');
  await page.evaluate(() => window.__COMMONS__.progression.endSimulation());
  state = await page.evaluate(PROGRESS_STATE);
  check('ending simulation restores the real total', state.focusSeconds === realBefore && state.simulated === false, `${state.focusSeconds}s`);
  check(
    'a world entered under simulation is not kept',
    state.currentWorld === 'home',
    `${state.currentWorld} with ${state.focusSeconds}s of real focus`,
  );

  await page.evaluate(() => window.__COMMONS__.progression.resetSimulation());
  state = await page.evaluate(PROGRESS_STATE);
  check('developer reset only resets the simulation', state.realFocusSeconds === realBefore, `${state.realFocusSeconds}s`);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness: ${error.message}`);
  console.error(error);
} finally {
  await browser?.close();
  kill(vite);
  kill(server);
  freePort(SERVER_PORT);
  freePort(CLIENT_PORT);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* windows file locks */ }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
