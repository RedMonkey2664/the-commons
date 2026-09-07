#!/usr/bin/env node
/**
 * Phase 0 smoke test — drives a real browser and asserts real game state.
 *
 *   node tools/phase0_smoke.mjs [--headed] [--keep]
 *
 * Checks the things that are easy to break and hard to notice by eye:
 *   - the game boots and Town Square becomes active
 *   - the player spawns on the configured tile
 *   - holding a direction chains tiles continuously
 *   - tapping a direction turns in place WITHOUT moving
 *   - walking into a wall bumps: facing changes, tile does not
 *   - Space on a faced signpost opens the dialogue box and blocks movement
 *   - dismissing dialogue returns control
 *
 * Requires: npx playwright install chromium
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const PORT = 5178;
const URL = `http://localhost:${PORT}/`;

const headed = process.argv.includes('--headed');
const keepOpen = process.argv.includes('--keep');

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

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
// dev server
// ---------------------------------------------------------------------------

function startDevServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort'],
    { cwd: resolve(repoRoot, 'client'), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
  );

  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('vite did not start in 60s')), 60_000);
    const onData = (buffer) => {
      const text = buffer.toString();
      if (text.includes('ready in') || text.includes('Local:')) {
        clearTimeout(timeout);
        resolvePromise(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      rejectPromise(new Error(`vite exited early with code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// game-state helpers
// ---------------------------------------------------------------------------

const SCENE_KEY = 'TownSquareScene';

async function gameState(page) {
  return page.evaluate((sceneKey) => {
    const game = window.__COMMONS__?.game;
    const scene = game?.scene?.getScene(sceneKey);
    if (!scene?.player) return null;
    const uiScene = game.scene.getScene('UIScene');
    return {
      active: game.scene.isActive(sceneKey),
      tile: { ...scene.player.tile },
      facing: scene.player.facing,
      state: scene.player.state,
      dialogueVisible: Boolean(uiScene?.dialogue?.isVisible),
      interactableCount: scene.zoneMap.interactables.length,
      mapSize: { w: scene.zoneMap.widthInTiles, h: scene.zoneMap.heightInTiles },
    };
  }, SCENE_KEY);
}

/** Put the player on a known tile so each check starts from the same place. */
async function teleport(page, x, y, facing) {
  await page.evaluate(
    ({ sceneKey, x, y, facing }) => {
      const scene = window.__COMMONS__.game.scene.getScene(sceneKey);
      scene.player.movement.teleport({ x, y }, facing);
    },
    { sceneKey: SCENE_KEY, x, y, facing },
  );
  await page.waitForTimeout(60);
}

/**
 * Close any open dialogue box. Stepping onto a door tile opens one, so sections
 * that assume a clear screen must call this first or they inherit it.
 */
async function dismissDialogue(page) {
  for (let i = 0; i < 15; i += 1) {
    const state = await gameState(page);
    if (!state?.dialogueVisible) return;
    await tapKey(page, 'Space');
  }
}

/**
 * Press a key for long enough to span several frames.
 *
 * page.keyboard.press() fires keydown+keyup back to back, so the whole press
 * can land between two Phaser frames — and Phaser's Key.onUp clears the
 * just-down flag, swallowing it. A real key press lasts far longer than a
 * frame, so holding briefly is both more realistic and deterministic.
 */
async function tapKey(page, key, holdMs = 80) {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(120);
}

async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(220); // let the in-flight tile tween finish
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

let server;
let browser;

try {
  console.log('starting dev server...');
  server = await startDevServer();

  browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  // Seed an identity so boot skips the Phase 1 title screen. No server is
  // started here on purpose: this asserts the zone stays fully playable
  // single-player when the connection fails.
  await context.addInitScript(() => {
    localStorage.setItem('commons.session', JSON.stringify({ displayName: 'Solo' }));
  });
  const page = await context.newPage();

  // This suite runs with NO server on purpose, so a refused websocket is the
  // expected offline path, not a defect. Everything else is a real error.
  const isExpectedOffline = (text) =>
    /ERR_CONNECTION_REFUSED|WebSocket|ws:\/\/localhost|net::ERR/i.test(text);

  const consoleErrors = [];
  page.on('pageerror', (error) => {
    if (!isExpectedOffline(String(error))) consoleErrors.push(String(error));
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedOffline(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Boot can involve a map fetch; give it room.
  await page.waitForFunction(
    (sceneKey) => {
      const game = window.__COMMONS__?.game;
      return Boolean(game?.scene?.getScene(sceneKey)?.player);
    },
    SCENE_KEY,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(400);

  console.log('\nboot');
  const boot = await gameState(page);
  check('Town Square scene is active', boot?.active === true);
  check('map is 30x22', boot?.mapSize.w === 30 && boot?.mapSize.h === 22, JSON.stringify(boot?.mapSize));
  check('10 interactables parsed from the map', boot?.interactableCount === 10, `got ${boot?.interactableCount}`);
  check('player spawned at (15,12)', boot?.tile.x === 15 && boot?.tile.y === 12, JSON.stringify(boot?.tile));

  // --- holding a direction chains tiles ---------------------------------
  console.log('\nmovement');
  await teleport(page, 15, 12, 'down');
  await holdKey(page, 'KeyW', 700);
  const afterWalk = await gameState(page);
  const tilesMoved = 12 - afterWalk.tile.y;
  // 700ms of held input at 130ms/tile, minus the 60ms turn, is ~4-5 tiles.
  check('holding W walks several tiles north', tilesMoved >= 3 && tilesMoved <= 6, `moved ${tilesMoved}`);
  check('player faces up after walking north', afterWalk.facing === 'up', afterWalk.facing);
  check('player returns to IDLE after the key is released', afterWalk.state === 'IDLE', afterWalk.state);

  // --- turn in place -----------------------------------------------------
  // Driven with explicit timestamps against a paused scene. A wall-clock tap
  // through Playwright cannot reliably land inside a 60ms window, and a flaky
  // test of a real behaviour is worse than no test of it.
  const turn = await page.evaluate((sceneKey) => {
    const game = window.__COMMONS__.game;
    const scene = game.scene.getScene(sceneKey);
    game.scene.pause(sceneKey);

    const movement = scene.player.movement;
    const sample = () => ({ x: movement.tile.x, y: movement.tile.y, facing: movement.facing });

    movement.teleport({ x: 15, y: 12 }, 'down');
    movement.update(0, 'left');    // first frame: turn, start the timer
    const atStart = sample();
    movement.update(30, 'left');   // 30ms < turnInPlaceMs: still turning
    const midTurn = sample();
    movement.update(100, 'left');  // past the delay: commit the step
    const afterDelay = sample();

    movement.teleport({ x: 15, y: 12 }, 'left');
    movement.update(200, 'left');  // already facing left: no delay at all
    const alreadyFacing = sample();

    game.scene.resume(sceneKey);
    return { atStart, midTurn, afterDelay, alreadyFacing };
  }, SCENE_KEY);
  await page.waitForTimeout(250);

  check('first frame of a turn faces the new direction', turn.atStart.facing === 'left', turn.atStart.facing);
  check('a turn does not move on the first frame', turn.atStart.x === 15, `x=${turn.atStart.x}`);
  check('still stationary partway through the turn delay', turn.midTurn.x === 15, `x=${turn.midTurn.x}`);
  check('steps once the turn delay elapses', turn.afterDelay.x === 14, `x=${turn.afterDelay.x}`);
  check('no turn delay when already facing that way', turn.alreadyFacing.x === 14, `x=${turn.alreadyFacing.x}`);

  // --- collision --------------------------------------------------------
  console.log('\ncollision');
  // sign_welcome blocks (16,12); the player at (15,12) faces it by pressing D.
  await teleport(page, 15, 12, 'down');
  await holdKey(page, 'KeyD', 400);
  const afterBump = await gameState(page);
  check('walking into the signpost does not move the player', afterBump.tile.x === 15, `x=${afterBump.tile.x}`);
  check('player still turns to face the obstacle', afterBump.facing === 'right', afterBump.facing);

  // Map edge / tree border.
  await teleport(page, 15, 2, 'up');
  await holdKey(page, 'KeyW', 500);
  const afterEdge = await gameState(page);
  check('cannot walk off the map through the north gate wall', afterEdge.tile.y >= 0 && afterEdge.tile.y <= 2, `y=${afterEdge.tile.y}`);
  check('stepping onto a door tile fires its interaction', afterEdge.dialogueVisible === true);

  // --- interaction + dialogue -------------------------------------------
  console.log('\ninteraction');
  // The north-gate check above steps onto the park door, which opens a
  // "not open yet" dialogue. Clear it before asserting on a fresh one.
  await dismissDialogue(page);
  await teleport(page, 15, 12, 'right'); // facing sign_welcome at (16,12)
  await tapKey(page, 'Space');
  await page.waitForTimeout(220);
  const inDialogue = await gameState(page);
  check('Space on a faced signpost opens the dialogue box', inDialogue.dialogueVisible === true);
  check('player is BLOCKED while dialogue is open', inDialogue.state === 'BLOCKED', inDialogue.state);

  // Movement must be inert while blocked.
  await holdKey(page, 'KeyS', 300);
  const duringDialogue = await gameState(page);
  check('WASD is ignored while dialogue is open', duringDialogue.tile.y === 12, `y=${duringDialogue.tile.y}`);

  // Space through every page until it closes.
  await dismissDialogue(page);
  await page.waitForTimeout(250);
  const afterDialogue = await gameState(page);
  check('dialogue closes on repeated Space', afterDialogue.dialogueVisible === false);
  check('control returns to the player after dialogue', afterDialogue.state === 'IDLE', afterDialogue.state);

  // --- NPC --------------------------------------------------------------
  await teleport(page, 13, 13, 'left'); // facing npc_wanderer at (12,13)
  await tapKey(page, 'Space');
  await page.waitForTimeout(220);
  const npcDialogue = await gameState(page);
  check('Space on a faced NPC opens dialogue', npcDialogue.dialogueVisible === true);
  await tapKey(page, 'Space');

  // --- screenshot -------------------------------------------------------
  console.log('\ncapture');
  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });

  // Close dialogue and take a clean world shot.
  await dismissDialogue(page);
  await teleport(page, 15, 12, 'down');
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(shotDir, 'phase0_town_square.png') });

  await teleport(page, 15, 12, 'right');
  await tapKey(page, 'Space');
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(shotDir, 'phase0_dialogue.png') });
  console.log(`  wrote ${shotDir}`);

  check('no unexpected page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // The whole point of running this suite serverless: the zone must stay
  // playable when the connection fails.
  const offline = await page.evaluate((sceneKey) => {
    const scene = window.__COMMONS__.game.scene.getScene(sceneKey);
    return { connected: Boolean(scene.network?.isConnected), hasPlayer: Boolean(scene.player) };
  }, SCENE_KEY);
  check('runs single-player with no server', offline.connected === false && offline.hasPlayer === true);

  if (keepOpen) {
    console.log('\n--keep: leaving the browser open. Ctrl+C to exit.');
    await new Promise(() => {});
  }
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error('\nharness error:', error);
} finally {
  await browser?.close();
  if (server) {
    server.kill();
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(server.pid), '/f', '/t'], { stdio: 'ignore' });
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
process.exit(0);
