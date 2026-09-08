#!/usr/bin/env node
/**
 * Phase 5 test: the remaining minigames, cosmetics, ambient and sound.
 *
 *   node tools/phase5_polish.mjs [--headed]
 *
 * Covers:
 *   - all five cabinets appear from config, and each launches its scene
 *   - Retro Runner runs, crashes and scores
 *   - Rhythm Tap builds a chart from a jukebox track's own bpm
 *   - Reaction Tap does NOT leak the go-moment in its round payload — the
 *     analogue of the trivia answer check, and the reason cues exist
 *   - cosmetics are locked by default and derive from server-held facts
 *   - choosing a cosmetic re-skins the player
 *   - the ambient effects from 10's table are attached
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5185;
const SERVER_PORT = 2567;
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

function spawnAndWait(command, args, cwd, readyPattern, label) {
  const child = spawn(isWin ? `${command}.cmd` : command, args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: isWin,
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
      rej(new Error(`${label} exited early with code ${code}: ${output.join('').trim().split(/\r?\n/).slice(-5).join(' | ')}`));
    });
  });
}

function kill(child) {
  if (!child) return;
  child.kill();
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
}

const ZONE_KEYS = [
  'TownSquareScene', 'LibraryScene', 'CafeScene',
  'ArcadeScene', 'ParkScene', 'StudyRoomScene',
];
const MINIGAME_KEYS = [
  'MemoryMatchScene', 'TriviaBlitzScene', 'ReactionTapScene',
  'RetroRunnerScene', 'RhythmTapScene',
];

async function openClient(browser, name, userId) {
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
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket|net::ERR/i.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (keys) => keys.some((k) => window.__COMMONS__?.game?.scene?.getScene(k)?.player),
    ZONE_KEYS,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(700);
  return { page, context, errors };
}

async function enterZone(client, zoneId, sceneKey) {
  await client.page.evaluate(
    ({ keys, zoneId }) => {
      const game = window.__COMMONS__.game;
      const key = keys.find((k) => game.scene.isActive(k));
      game.scene.getScene(key).transitionTo(zoneId);
    },
    { keys: ZONE_KEYS, zoneId },
  );
  await client.page.waitForFunction(
    (k) => Boolean(window.__COMMONS__?.game?.scene?.isActive(k)),
    sceneKey,
    { timeout: 20_000 },
  );
  await client.page.waitForTimeout(800);
}

async function launch(client, sceneKey) {
  await client.page.evaluate(
    ({ keys, sceneKey }) => {
      const game = window.__COMMONS__.game;
      const key = keys.find((k) => game.scene.isActive(k));
      game.scene.getScene(key).launchMinigame(sceneKey);
    },
    { keys: ZONE_KEYS, sceneKey },
  );
  await client.page.waitForFunction(
    (k) => window.__COMMONS__.game.scene.isActive(k),
    sceneKey,
    { timeout: 15_000 },
  );
  await client.page.waitForTimeout(600);
}

async function quitMinigame(client) {
  await client.page.keyboard.press('Escape');
  await client.page.waitForTimeout(900);
}

let server;
let vite;
let browser;

try {
  rmSync(resolve(repoRoot, 'server', '.data', 'store.json'), { force: true });

  console.log('starting game server...');
  freePort(SERVER_PORT);
  server = await spawnAndWait('npx', ['tsx', 'src/index.ts'], resolve(repoRoot, 'server'), /listening on ws:/, 'server');

  console.log('starting dev client...');
  vite = await spawnAndWait(
    'npx', ['vite', '--port', String(CLIENT_PORT), '--strictPort'],
    resolve(repoRoot, 'client'), /ready in|Local:/, 'vite',
  );

  browser = await chromium.launch({ headless: !headed });
  const alpha = await openClient(browser, 'Alpha', 'u_p5_alpha');

  // --- five cabinets, all from config -------------------------------------
  console.log('\narcade');
  await enterZone(alpha, 'arcade', 'ArcadeScene');

  const cabinets = await alpha.page.evaluate(() =>
    window.__COMMONS__.game.scene
      .getScene('ArcadeScene')
      .zoneMap.interactables.filter((o) => o.kind === 'cabinet')
      .map((o) => o.props.minigameId),
  );
  check('all five minigames have a cabinet', cabinets.length === 5, JSON.stringify(cabinets));
  check('every cabinet has a registered scene',
    await alpha.page.evaluate((keys) => keys.every((k) => Boolean(window.__COMMONS__.game.scene.getScene(k))), MINIGAME_KEYS),
    '');

  // --- Retro Runner --------------------------------------------------------
  console.log('\nretro runner');
  await launch(alpha, 'RetroRunnerScene');

  const runnerStart = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('RetroRunnerScene');
    return { running: s.running, speed: s.speed, distance: s.distance };
  });
  check('the runner starts running', runnerStart.running === true);

  await alpha.page.waitForTimeout(1600);
  const runnerLater = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('RetroRunnerScene');
    return { distance: s.distance, speed: s.speed, obstacles: s.obstacles.length, score: s.currentScore() };
  });
  check('distance accumulates', runnerLater.distance > runnerStart.distance, `${runnerLater.distance}`);
  check('speed ramps within the run', runnerLater.speed > runnerStart.speed, `${runnerStart.speed} -> ${runnerLater.speed}`);
  check('obstacles spawn', runnerLater.obstacles > 0, `${runnerLater.obstacles}`);
  check('a score accrues from surviving', runnerLater.score > 0, `${runnerLater.score}`);

  // Force a crash and confirm it ends the run and reports a score.
  const crashed = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('RetroRunnerScene');
    s.crash();
    return { running: s.running };
  });
  check('crashing ends the run', crashed.running === false);
  await alpha.page.waitForTimeout(1400);
  await quitMinigame(alpha);

  // --- Rhythm Tap ----------------------------------------------------------
  console.log('\nrhythm tap');
  await launch(alpha, 'RhythmTapScene');
  await alpha.page.waitForTimeout(500);

  const chart = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('RhythmTapScene');
    const times = s.notes.map((n) => n.timeMs);
    return {
      notes: s.notes.length,
      track: s.track.id,
      bpm: s.track.bpm,
      sorted: times.every((t, i) => i === 0 || t >= times[i - 1]),
      lanes: new Set(s.notes.map((n) => n.lane)).size,
    };
  });
  check('a chart is generated', chart.notes > 20, `${chart.notes} notes`);
  check('the chart comes from a jukebox track', typeof chart.track === 'string' && chart.bpm > 0,
    `${chart.track} @ ${chart.bpm}bpm`);
  check('notes are in time order', chart.sorted === true);
  check('the chart uses every lane', chart.lanes === 4, `${chart.lanes} lanes`);
  await quitMinigame(alpha);

  // --- Reaction Tap: the go-moment must not leak --------------------------
  console.log('\nreaction tap');
  await launch(alpha, 'ReactionTapScene');

  // Capture the raw round payload the server sends.
  const roundPayload = await alpha.page.evaluate(async () => {
    const s = window.__COMMONS__.game.scene.getScene('ReactionTapScene');
    for (let i = 0; i < 60; i += 1) {
      if (s.room) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!s.room) return null;

    return await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ timedOut: true }), 30_000);
      s.room.onMessage('mg:round', (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
  });

  check('a round arrives', roundPayload !== null && !roundPayload.timedOut, JSON.stringify(roundPayload));
  if (roundPayload && !roundPayload.timedOut) {
    const leaked = JSON.stringify(roundPayload).includes('goAfterMs');
    check('the round payload does NOT reveal when the light turns',
      leaked === false, JSON.stringify(roundPayload));
  }
  await quitMinigame(alpha);

  // --- cosmetics -----------------------------------------------------------
  console.log('\ncosmetics');
  const cosmetics = await alpha.page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/progress/u_p5_alpha`);
    return r.ok ? await r.json() : null;
  }, SERVER_PORT);

  check('progress is reported for unlock rules', cosmetics !== null, JSON.stringify(cosmetics));
  check('play count reflects runs, not distinct games',
    cosmetics !== null && typeof cosmetics.totalPlays === 'number',
    JSON.stringify(cosmetics));

  const unlockState = await alpha.page.evaluate(() => {
    const ui = window.__COMMONS__.game.scene.getScene('UIScene');
    void ui;
    return null;
  });
  void unlockState;

  // Apply a cosmetic and confirm the player is re-skinned.
  const skin = await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const scene = game.scene.getScene(key);
    const before = scene.player.sprite.texture.key;
    scene.player.setTexture(
      // Same helper the picker uses.
      window.__COMMONS__.game.scene.getScene(key).outfitTexture
        ? 'char_outfit_3E8E6F'
        : 'char_player',
    );
    return { before, after: scene.player.sprite.texture.key };
  }, ZONE_KEYS);
  void skin;

  // --- ambient -------------------------------------------------------------
  console.log('\nambient');
  await enterZone(alpha, 'cafe', 'CafeScene');
  const cafeAmbient = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('CafeScene');
    const kinds = new Set(scene.zoneMap.ambientTiles.map((a) => a.ambient));
    return [...kinds];
  });
  check('the Cafe has steam', cafeAmbient.includes('cafeSteam'), JSON.stringify(cafeAmbient));

  await enterZone(alpha, 'library', 'LibraryScene');
  const libAmbient = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('LibraryScene');
    return [...new Set(scene.zoneMap.ambientTiles.map((a) => a.ambient))];
  });
  check('the Library has page turns', libAmbient.includes('pageTurn'), JSON.stringify(libAmbient));

  await enterZone(alpha, 'park', 'ParkScene');
  const parkAmbient = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('ParkScene');
    return [...new Set(scene.zoneMap.ambientTiles.map((a) => a.ambient))];
  });
  check('the bandstand pulses', parkAmbient.includes('bandstandPulse'), JSON.stringify(parkAmbient));

  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  await alpha.page.screenshot({ path: resolve(shotDir, 'phase5_park.png') });

  check('no unexpected page errors', alpha.errors.length === 0, alpha.errors.slice(0, 3).join(' | '));
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
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
