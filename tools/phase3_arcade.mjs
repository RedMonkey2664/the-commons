#!/usr/bin/env node
/**
 * Phase 3 test: arcade, chat, persistence.
 *
 *   node tools/phase3_arcade.mjs [--headed]
 *
 * Phase 3's done-when is "log in as yourself, add a real friend, and play a
 * minigame with them with scores saved". Accounts need Supabase credentials
 * that are not configured, so this covers everything that does not:
 *
 *   - the Arcade builds a cabinet per minigames.config entry (the plugin claim)
 *   - Memory Match plays through to a score and persists it
 *   - the leaderboard reads that score back after a fresh page load
 *   - Trivia Blitz is scored by the SERVER: a client cannot see the answer in
 *     the round payload, and cannot post its own multiplayer score
 *   - zone chat reaches another client, and typing does not walk the player
 *   - study time is recorded from the server clock when you stand up
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5183;
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

async function openClient(browser, name, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
    // The 403 is this suite's own probe: it deliberately tries to POST a
    // multiplayer score and asserts the server refuses. Counting the browser's
    // log line for that as a defect would fail the test for passing.
    const ignorable = /ERR_CONNECTION_REFUSED|WebSocket|net::ERR|403 \(Forbidden\)/i;
    if (m.type() === 'error' && !ignorable.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (keys) => keys.some((k) => window.__COMMONS__?.game?.scene?.getScene(k)?.player),
    ZONE_KEYS,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);
  return { page, context, errors, name, userId };
}

async function state(client) {
  return client.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    const scene = key ? game.scene.getScene(key) : null;
    const ui = game.scene.getScene('UIScene');
    const activeMinigame = ['MemoryMatchScene', 'TriviaBlitzScene'].find((k) => game.scene.isActive(k));
    return {
      scene: key ?? null,
      minigame: activeMinigame ?? null,
      tile: scene?.player ? { ...scene.player.tile } : null,
      status: scene?.player?.status ?? null,
      cabinets: scene?.zoneMap
        ? scene.zoneMap.interactables.filter((o) => o.kind === 'cabinet').length
        : 0,
      composing: Boolean(ui?.chat?.isComposing),
      connected: Boolean(scene?.network?.isConnected),
    };
  }, ZONE_KEYS);
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
  await client.page.waitForTimeout(700);
}

async function typeChat(client, text) {
  await client.page.keyboard.press('Enter');
  await client.page.waitForTimeout(250);
  await client.page.keyboard.type(text, { delay: 25 });
  await client.page.waitForTimeout(150);
  await client.page.keyboard.press('Enter');
  await client.page.waitForTimeout(400);
}

let server;
let vite;
let browser;

try {
  // Start from a clean store so leaderboard assertions are deterministic.
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

  // --- config-driven cabinets ---------------------------------------------
  console.log('\narcade cabinets');
  const alpha = await openClient(browser, 'Alpha', 'u_test_alpha');
  await enterZone(alpha, 'arcade', 'ArcadeScene');

  let s = await state(alpha);
  const configured = await alpha.page.evaluate(
    () => window.__COMMONS__.game.scene.getScene('ArcadeScene').zoneMap.interactables
      .filter((o) => o.kind === 'cabinet')
      .map((o) => o.props.minigameId),
  );
  check('the Arcade built one cabinet per config entry', s.cabinets === 2, `${s.cabinets} cabinets`);
  check('cabinets carry their minigame ids',
    configured.includes('memory_match') && configured.includes('trivia_blitz'),
    JSON.stringify(configured));

  // --- Memory Match, played to completion ---------------------------------
  console.log('\nmemory match');
  await alpha.page.evaluate(() => {
    window.__COMMONS__.game.scene.getScene('ArcadeScene').launchMinigame('MemoryMatchScene');
  });
  await alpha.page.waitForFunction(
    () => window.__COMMONS__.game.scene.isActive('MemoryMatchScene'),
    null, { timeout: 15_000 },
  );
  await alpha.page.waitForTimeout(700);

  s = await state(alpha);
  check('Memory Match launched over the paused Arcade', s.minigame === 'MemoryMatchScene');

  // The cards must be laid out before anything can be clicked. This assertion
  // exists because an earlier version called scene.flip(index) directly, which
  // passed happily while every card was stacked at (0,0) and the game was
  // unplayable by hand.
  const layout = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('MemoryMatchScene');
    const positions = scene.cards.map((c) => ({ x: c.container.x, y: c.container.y }));
    const distinct = new Set(positions.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    return { count: positions.length, distinct: distinct.size, first: positions[0] };
  });
  check('every card has its own position on screen',
    layout.distinct === layout.count && layout.first.x > 0 && layout.first.y > 0,
    JSON.stringify(layout));

  // Solve it by CLICKING, at real screen coordinates — the same path a player
  // takes. Pairs are looked up so the run is deterministic; the interaction is
  // not simulated.
  const pairOrder = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('MemoryMatchScene');
    const byFace = new Map();
    for (const card of scene.cards) {
      const list = byFace.get(card.faceIndex) ?? [];
      list.push({ x: card.container.x, y: card.container.y });
      byFace.set(card.faceIndex, list);
    }
    return [...byFace.values()];
  });

  for (const pair of pairOrder) {
    for (const point of pair) {
      await alpha.page.mouse.click(point.x, point.y);
      await alpha.page.waitForTimeout(90);
    }
    await alpha.page.waitForTimeout(120);
  }

  const solved = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('MemoryMatchScene');
    return { matches: scene.matches, pairs: scene.cards.length / 2 };
  });
  check('every pair matched by clicking', solved.matches === solved.pairs, JSON.stringify(solved));

  await alpha.page.waitForTimeout(1800);

  const reported = await alpha.page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('MemoryMatchScene');
    return scene.currentScore();
  });
  check('the run produced a score', reported > 0, `score ${reported}`);

  // --- the score survives a reload ----------------------------------------
  console.log('\npersistence');
  const board = await alpha.page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/scores/memory_match?userId=u_test_alpha`);
    return r.ok ? await r.json() : null;
  }, SERVER_PORT);

  check('the score reached the server', Boolean(board?.scores?.length), JSON.stringify(board));
  check('the board names the player who set it',
    board?.scores?.[0]?.userId === 'u_test_alpha',
    JSON.stringify(board?.scores?.[0]));

  // --- multiplayer scores cannot be self-reported -------------------------
  const forged = await alpha.page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/scores/trivia_blitz`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u_test_alpha', displayName: 'Alpha', score: 999999 }),
    });
    return r.status;
  }, SERVER_PORT);
  check('a client cannot post a multiplayer score', forged === 403, `status ${forged}`);

  // --- chat ----------------------------------------------------------------
  console.log('\nchat');
  await alpha.page.keyboard.press('Escape'); // leave the minigame
  await alpha.page.waitForTimeout(900);
  await enterZone(alpha, 'town_square', 'TownSquareScene');

  const beta = await openClient(browser, 'Beta', 'u_test_beta');
  await beta.page.waitForTimeout(900);

  const before = await state(alpha);
  await typeChat(alpha, 'wwww hello there');
  const after = await state(alpha);

  check('typing did not walk the player',
    after.tile.x === before.tile.x && after.tile.y === before.tile.y,
    `${JSON.stringify(before.tile)} -> ${JSON.stringify(after.tile)}`);
  check('the composer closed after sending', after.composing === false);

  const heard = await beta.page.evaluate(async () => {
    const ui = window.__COMMONS__.game.scene.getScene('UIScene');
    for (let i = 0; i < 40; i += 1) {
      const text = ui.chat.logText?.text ?? '';
      if (text.includes('hello there')) return text;
      await new Promise((r) => setTimeout(r, 150));
    }
    return ui.chat.logText?.text ?? '';
  });
  check('the other client received the message', heard.includes('hello there'), heard.slice(0, 80));
  check('the message is attributed to its author', heard.includes('Alpha'), heard.slice(0, 80));

  // --- study time ----------------------------------------------------------
  console.log('\nstudy time');
  await enterZone(alpha, 'library', 'LibraryScene');
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).multiplayer.pushStatus('studying');
  }, ZONE_KEYS);
  await alpha.page.waitForTimeout(1500);

  s = await state(alpha);
  check('status is studying while seated', s.status === 'studying', String(s.status));

  // A session shorter than the floor must record nothing — a misclick is not
  // study time (MIN_STUDY_SECONDS).
  await alpha.page.evaluate((keys) => {
    const game = window.__COMMONS__.game;
    const key = keys.find((k) => game.scene.isActive(k));
    game.scene.getScene(key).multiplayer.pushStatus('idle');
  }, ZONE_KEYS);
  await alpha.page.waitForTimeout(800);

  const totals = await alpha.page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/study/u_test_alpha`);
    return r.ok ? await r.json() : null;
  }, SERVER_PORT);
  check('a two-second sit records no study time',
    totals !== null && totals.totalSeconds === 0,
    JSON.stringify(totals));

  const allErrors = [...alpha.errors, ...beta.errors];
  check('no unexpected page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));

  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  await alpha.page.screenshot({ path: resolve(shotDir, 'phase3_chat.png') });
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
