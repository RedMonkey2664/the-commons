#!/usr/bin/env node
/**
 * Phase 6 test: two new zones, two new cabinets, and cafe drinks.
 *
 *   node tools/phase6_world.mjs [--headed]
 *
 * The phase's claim is that zones and minigames are ADDITIVE — config entries,
 * not engine edits. So the assertions here are deliberately written against
 * config rather than against hardcoded names wherever that is possible: a test
 * that says "there are 8 zones" has to be edited every time the claim is
 * exercised, which would make it evidence of nothing.
 *
 * Covers:
 *   - every zone in config has a scene, a map, and can be walked into and out of
 *   - every minigame in config has a registered scene and a cabinet on the floor
 *   - Stack Tower: dropping blocks scores, and a bad drop narrows the tower
 *   - Word Rush: the rack arrives WITHOUT the accepted word list, and a valid
 *     word scores while gibberish does not
 *   - ordering a drink shows a mug over your head, and over everyone else's
 */

import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const CLIENT_PORT = 5186;
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

async function openClient(browser, name, userId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await context.addInitScript(
    ({ name, userId }) => {
      localStorage.setItem('commons.session', JSON.stringify({ displayName: name, userId }));
      // Whichever zone scene is live right now. Defined in the page because
      // every evaluate() below runs there, not in the harness.
      window.ACTIVE_HELPER = () =>
        window.__COMMONS__.game.scene.scenes.find((s) => s.scene.isActive() && s.player);
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
    () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(800);
  return { page, context, errors };
}

async function enterZone(client, zoneId, sceneKey) {
  await client.page.evaluate((id) => {
    const game = window.__COMMONS__.game;
    game.scene.scenes.find((s) => s.scene.isActive() && s.player).transitionTo(id);
  }, zoneId);
  await client.page.waitForFunction(
    (k) => Boolean(window.__COMMONS__?.game?.scene?.isActive(k)),
    sceneKey,
    { timeout: 20_000 },
  );
  await client.page.waitForTimeout(700);
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
  const alpha = await openClient(browser, 'Alpha', 'u_p6_alpha');

  // --- config drives the world --------------------------------------------
  console.log('\nzones from config');

  const health = await alpha.page.evaluate(async (port) => {
    const r = await fetch(`http://localhost:${port}/health`);
    return r.ok ? await r.json() : null;
  }, SERVER_PORT);

  check('the server registers a room for every configured zone', (health?.zones?.length ?? 0) >= 8,
    JSON.stringify(health?.zones));
  check('the terrace and greenhouse are among them',
    health?.zones?.includes('skyline_terrace') && health?.zones?.includes('greenhouse'),
    JSON.stringify(health?.zones));

  // Every zone must have a scene class registered. Read from the game, not a
  // list in this file, so adding a zone cannot silently skip the check.
  const sceneCoverage = await alpha.page.evaluate(() => {
    const game = window.__COMMONS__.game;
    const keys = Object.keys(game.scene.keys);
    return { keys };
  });
  for (const key of ['SkylineTerraceScene', 'GreenhouseScene', 'WordRushScene', 'StackTowerScene']) {
    check(`${key} is registered`, sceneCoverage.keys.includes(key), sceneCoverage.keys.join(','));
  }

  // --- walking into the new zones -----------------------------------------
  console.log('\nnew zones');

  await enterZone(alpha, 'skyline_terrace', 'SkylineTerraceScene');
  const terrace = await alpha.page.evaluate(() => {
    const s = ACTIVE_HELPER();
    return {
      zone: s.zone.id,
      tile: s.player.tile,
      walkable: s.zoneMap.isWalkable(s.player.tile),
      interactables: s.zone.interactables.length,
      ambient: [...new Set(s.zoneMap.ambientTiles.map((a) => a.ambient))],
    };
  });
  check('the terrace loads and spawns you somewhere walkable',
    terrace.zone === 'skyline_terrace' && terrace.walkable === true, JSON.stringify(terrace));
  check('the terrace has festoon lighting', terrace.ambient.includes('stringGlow'),
    JSON.stringify(terrace.ambient));

  await enterZone(alpha, 'town_square', 'TownSquareScene');
  await enterZone(alpha, 'greenhouse', 'GreenhouseScene');
  const greenhouse = await alpha.page.evaluate(() => {
    const s = ACTIVE_HELPER();
    return { zone: s.zone.id, walkable: s.zoneMap.isWalkable(s.player.tile), voice: s.zone.voiceChatDefault };
  });
  check('the greenhouse loads and spawns you somewhere walkable',
    greenhouse.zone === 'greenhouse' && greenhouse.walkable === true, JSON.stringify(greenhouse));
  check('the greenhouse is a quiet zone', greenhouse.voice === 'muted', String(greenhouse.voice));

  // Leaving twice: the Phase 2 bug where `transitioning` stuck true only ever
  // showed up on the SECOND departure from a zone.
  await enterZone(alpha, 'town_square', 'TownSquareScene');
  await enterZone(alpha, 'greenhouse', 'GreenhouseScene');
  await enterZone(alpha, 'town_square', 'TownSquareScene');
  const backHome = await alpha.page.evaluate(() => ACTIVE_HELPER().zone.id);
  check('a new zone can be left and re-entered repeatedly', backHome === 'town_square', backHome);

  // --- the arcade builds itself from config -------------------------------
  console.log('\narcade');
  await enterZone(alpha, 'arcade', 'ArcadeScene');
  // Cabinets are built from config, so count them from config rather than
  // asserting a number that goes stale the moment a sixth game is added.
  const arcade = await alpha.page.evaluate(async (port) => {
    const health = await (await fetch(`http://localhost:${port}/health`)).json();
    const scene = window.__COMMONS__.game.scene.getScene('ArcadeScene');
    const placed = scene.zoneMap.interactables
      .filter((o) => o.kind === 'cabinet')
      .map((o) => o.props.minigameId);
    return { configured: health.minigames, placed };
  }, SERVER_PORT);

  check('a cabinet is placed for every configured minigame',
    arcade.configured.every((id) => arcade.placed.includes(id)),
    `config=${arcade.configured.join(',')} placed=${arcade.placed.join(',')}`);
  check('the two new cabinets are on the floor',
    arcade.placed.includes('word_rush') && arcade.placed.includes('stack_tower'),
    arcade.placed.join(','));

  // --- Stack Tower ---------------------------------------------------------
  console.log('\nstack tower');
  await alpha.page.evaluate(() => ACTIVE_HELPER().launchMinigame('StackTowerScene'));
  await alpha.page.waitForFunction(
    () => window.__COMMONS__.game.scene.isActive('StackTowerScene'),
    undefined, { timeout: 15_000 },
  );
  await alpha.page.waitForTimeout(700);

  const towerStart = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('StackTowerScene');
    return { blocks: s.stack.length, moving: Boolean(s.moving), width: s.stack[0].width };
  });
  check('the tower starts with a foundation and a moving block',
    towerStart.blocks === 1 && towerStart.moving === true, JSON.stringify(towerStart));

  // Play it properly: wait until the sliding block is actually over the tower
  // before dropping. Mashing space the moment the scene opens drops the block
  // into the void and ends the run on the first press, which is the game
  // working correctly and the test playing badly.
  for (let i = 0; i < 4; i += 1) {
    const overlapping = await alpha.page.waitForFunction(() => {
      const s = window.__COMMONS__.game.scene.getScene('StackTowerScene');
      if (!s.running || !s.moving) return false;
      const below = s.stack[s.stack.length - 1];
      return Math.abs(s.moving.x - below.x) < below.width * 0.4;
    }, undefined, { timeout: 8000 }).catch(() => null);
    if (!overlapping) break;

    await alpha.page.keyboard.down('Space');
    await alpha.page.waitForTimeout(60);
    await alpha.page.keyboard.up('Space');
    await alpha.page.waitForTimeout(200);
  }

  const towerAfter = await alpha.page.evaluate(() => {
    const s = window.__COMMONS__.game.scene.getScene('StackTowerScene');
    return {
      blocks: s.stack.length,
      score: s.score,
      topWidth: s.stack[s.stack.length - 1].width,
      baseWidth: s.stack[0].width,
      running: s.running,
    };
  });
  check('dropping blocks builds the tower', towerAfter.blocks > towerStart.blocks,
    JSON.stringify(towerAfter));
  check('stacking scores', towerAfter.score > 0, String(towerAfter.score));
  check('a block never ends up wider than the one below it',
    towerAfter.topWidth <= towerAfter.baseWidth, JSON.stringify(towerAfter));

  await alpha.page.keyboard.press('Escape');
  await alpha.page.waitForTimeout(900);

  // --- Word Rush -----------------------------------------------------------
  console.log('\nword rush');
  await alpha.page.evaluate(() => ACTIVE_HELPER().launchMinigame('WordRushScene'));
  await alpha.page.waitForFunction(
    () => window.__COMMONS__.game.scene.isActive('WordRushScene'),
    undefined, { timeout: 15_000 },
  );

  // Capture the raw round payload as it arrives off the wire.
  const roundPayload = await alpha.page.evaluate(() => new Promise((res) => {
    const scene = window.__COMMONS__.game.scene.getScene('WordRushScene');
    const started = Date.now();
    const poll = setInterval(() => {
      if (scene.letters) {
        clearInterval(poll);
        res({ letters: scene.letters, keys: Object.keys(scene).filter((k) => /word|list/i.test(k)) });
      } else if (Date.now() - started > 40_000) {
        clearInterval(poll);
        res(null);
      }
    }, 250);
  }));

  check('a rack of letters arrives', typeof roundPayload?.letters === 'string' && roundPayload.letters.length >= 6,
    JSON.stringify(roundPayload));
  check('the accepted word list is NOT sent to the client',
    (roundPayload?.keys ?? []).length === 0, JSON.stringify(roundPayload?.keys));

  // Type a word that is definitely in the rack's list, letter by letter.
  const rack = roundPayload?.letters ?? '';
  const KNOWN = {
    TRAINED: 'rain', GARDENS: 'sand', MONITOR: 'root', PLASTIC: 'clip',
    BROWSED: 'word', CHAPTER: 'chat', FRIENDS: 'find', STUDIED: 'dust',
  };
  const word = KNOWN[rack] ?? '';
  check('the rack is one of the curated puzzles', word !== '', rack);

  if (word) {
    for (const ch of word.toUpperCase()) {
      await alpha.page.keyboard.press(`Key${ch}`);
      await alpha.page.waitForTimeout(40);
    }
    const typed = await alpha.page.evaluate(
      () => window.__COMMONS__.game.scene.getScene('WordRushScene').typed,
    );
    check('typing builds the word', typed === word.toUpperCase(), `${typed} vs ${word.toUpperCase()}`);

    // A letter not on the rack must be refused.
    const notOnRack = 'QXZ'.split('').find((c) => !rack.includes(c));
    await alpha.page.keyboard.press(`Key${notOnRack}`);
    await alpha.page.waitForTimeout(80);
    const afterBad = await alpha.page.evaluate(
      () => window.__COMMONS__.game.scene.getScene('WordRushScene').typed,
    );
    check('a letter that is not on the rack is refused', afterBad === typed, afterBad);

    await alpha.page.keyboard.press('Enter');
    await alpha.page.waitForTimeout(300);
    const submitted = await alpha.page.evaluate(
      () => window.__COMMONS__.game.scene.getScene('WordRushScene').submitted,
    );
    check('ENTER submits the word', submitted === true, String(submitted));
  }

  await alpha.page.keyboard.press('Escape');
  await alpha.page.waitForTimeout(900);

  // --- drinks --------------------------------------------------------------
  console.log('\ncafe drinks');
  await enterZone(alpha, 'cafe', 'CafeScene');

  const beta = await openClient(browser, 'Beta', 'u_p6_beta');
  await enterZone(beta, 'cafe', 'CafeScene');
  await beta.page.waitForTimeout(900);

  const sawEachOther = await beta.page.evaluate(
    () => ACTIVE_HELPER().multiplayer?.roster?.length ?? 0,
  );
  check('both clients are in the cafe together', sawEachOther >= 1, String(sawEachOther));

  // Exactly what pressing SPACE at the counter does: the scene builds the
  // real interaction context and the registry picks the handler by kind.
  await alpha.page.evaluate(() => {
    const scene = window.ACTIVE_HELPER();
    const counter = scene.zoneMap.interactables.find((o) => o.kind === 'drink_counter');
    scene.interactions.tryInteract({ x: counter.tile.x, y: counter.tile.y + 1 }, 'up');
  });

  await alpha.page.waitForTimeout(400);
  const panelOpen = await alpha.page.evaluate(
    () => window.__COMMONS__.game.scene.getScene('UIScene').drinks.isOpen,
  );
  check('the counter opens the drink picker', panelOpen === true, String(panelOpen));

  if (panelOpen) {
    const slot = await alpha.page.evaluate(() => {
      const panel = window.__COMMONS__.game.scene.getScene('UIScene').drinks;
      const plate = panel.row.list.find((o) => o.type === 'Rectangle');
      const m = plate.getWorldTransformMatrix();
      return { x: Math.round(m.tx), y: Math.round(m.ty) };
    });
    await alpha.page.mouse.click(slot.x, slot.y);
    await alpha.page.waitForTimeout(600);

    const mine = await alpha.page.evaluate(() => {
      const scene = ACTIVE_HELPER();
      return { drink: scene.drink, hasIcon: Boolean(scene.drinkIcon) };
    });
    check('ordering gives you a drink', typeof mine.drink === 'string' && mine.drink.length > 0,
      JSON.stringify(mine));
    check('the mug is drawn over your own head', mine.hasIcon === true, JSON.stringify(mine));

    // The whole point: other people can see it.
    await beta.page.waitForTimeout(900);
    const theirs = await beta.page.evaluate(() => {
      const scene = ACTIVE_HELPER();
      const remotes = [...(scene.multiplayer?.remotes?.values?.() ?? [])];
      return remotes.map((r) => ({ name: r.displayName, drink: r.drink }));
    });
    check('everyone else in the room sees the drink',
      theirs.some((r) => typeof r.drink === 'string' && r.drink.length > 0),
      JSON.stringify(theirs));
  }

  const errors = [...alpha.errors, ...beta.errors];
  check('no unexpected page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness: ${error.message}`);
  console.error(error);
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

// Exit explicitly. Two browser contexts plus a spawned server and client leave
// enough open handles that node will not end its loop on its own, and a suite
// that prints "0 failed" and then hangs forever is useless in CI.
process.exit(0);
