#!/usr/bin/env node
/**
 * Phase 2 world test.
 *
 *   node tools/phase2_world.mjs [--headed]
 *
 * The roadmap's done-when for Phase 2 is "you can walk the whole town and
 * transition between every zone smoothly", so that is literally what this does:
 * it walks the player onto each door in turn, waits for the zone to change, and
 * checks they arrived at the right entry point with a working world around them.
 *
 * Also covers the things transitions quietly break: control returning after the
 * fade, the HUD following the zone, and sitting down changing your status.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const PORT = 5182;
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

function startVite() {
  const child = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: resolve(repoRoot, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite timeout')), 60_000);
    const on = (b) => {
      if (/ready in|Local:/.test(b.toString())) {
        clearTimeout(t);
        res(child);
      }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
  });
}

/** Which zone scene is live, and where the player is standing in it. */
async function worldState(page) {
  return page.evaluate(() => {
    const game = window.__COMMONS__.game;
    const keys = [
      'TownSquareScene', 'LibraryScene', 'CafeScene',
      'ArcadeScene', 'ParkScene', 'StudyRoomScene',
    ];
    const activeKey = keys.find((k) => game.scene.isActive(k));
    const scene = activeKey ? game.scene.getScene(activeKey) : null;
    const uiScene = game.scene.getScene('UIScene');
    if (!scene?.player) return { scene: activeKey ?? null, ready: false };
    return {
      scene: activeKey,
      ready: true,
      tile: { ...scene.player.tile },
      state: scene.player.state,
      status: scene.player.status,
      sitting: scene.player.isSitting,
      interactables: scene.zoneMap.interactables.length,
      mapSize: { w: scene.zoneMap.widthInTiles, h: scene.zoneMap.heightInTiles },
      dialogueVisible: Boolean(uiScene?.dialogue?.isVisible),
      friendsOpen: Boolean(uiScene?.friends?.isOpen),
    };
  });
}

async function waitForScene(page, key, timeout = 15_000) {
  await page.waitForFunction(
    (k) => {
      const game = window.__COMMONS__?.game;
      return Boolean(game?.scene?.isActive(k) && game.scene.getScene(k)?.player);
    },
    key,
    { timeout },
  );
  // Let the fade-in and first frame settle.
  await page.waitForTimeout(500);
}

/** Put the player on a tile and walk them one step in `dir` onto a door. */
async function stepOnto(page, from, dir) {
  await page.evaluate(
    ({ from, facing }) => {
      const game = window.__COMMONS__.game;
      const keys = [
        'TownSquareScene', 'LibraryScene', 'CafeScene',
        'ArcadeScene', 'ParkScene', 'StudyRoomScene',
      ];
      const key = keys.find((k) => game.scene.isActive(k));
      const scene = game.scene.getScene(key);
      scene.player.movement.teleport({ x: from.x, y: from.y }, facing);
    },
    { from, facing: dir },
  );
  await page.waitForTimeout(160);

  const key = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }[dir];
  await page.keyboard.down(key);
  await page.waitForTimeout(320);
  await page.keyboard.up(key);
}

async function dismissDialogue(page) {
  for (let i = 0; i < 15; i += 1) {
    const s = await worldState(page);
    if (!s.ready || !s.dialogueVisible) return;
    await page.keyboard.down('Space');
    await page.waitForTimeout(80);
    await page.keyboard.up('Space');
    await page.waitForTimeout(180);
  }
}

let vite;
let browser;

try {
  console.log('starting dev client...');
  vite = await startVite();

  browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('commons.session', JSON.stringify({ displayName: 'Walker' }));
    // Single-player: this suite is about the world, not the network.
    localStorage.setItem('commons.serverUrl', 'ws://localhost:59999');
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|WebSocket|net::ERR/i.test(text)) {
      errors.push(text);
    }
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await waitForScene(page, 'TownSquareScene', 30_000);

  console.log('\ntown square');
  let s = await worldState(page);
  check('spawns in Town Square', s.scene === 'TownSquareScene');
  // A floor, not an equality. The map is authored in
  // tools/generate_placeholder_maps.py and is meant to grow; pinning the exact
  // dimensions here just means this suite fails every time the square is
  // edited, which is how it read "40x30" long after it stopped being true.
  check(
    'town square loaded a full-size map',
    s.mapSize.w >= 40 && s.mapSize.h >= 30,
    JSON.stringify(s.mapSize),
  );
  check('the square parses its interactables', s.interactables >= 12, `got ${s.interactables}`);

  // --- every zone, out and back -------------------------------------------
  // door tile, the tile you approach it from, and the direction you walk.
  // Read out of the map rather than restated here. Door positions belong to
  // tools/generate_placeholder_maps.py, and a second copy in a test is a copy
  // that goes stale silently — the approach tile and the direction to walk are
  // both derivable from the door and the collision map anyway.
  const SCENE_FOR_ZONE = {
    library: { zone: 'LibraryScene', name: 'Library' },
    cafe: { zone: 'CafeScene', name: 'Cafe' },
    arcade: { zone: 'ArcadeScene', name: 'Arcade' },
    park: { zone: 'ParkScene', name: 'Park' },
    study_room: { zone: 'StudyRoomScene', name: 'Study Room' },
  };

  const doors = await page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('TownSquareScene');
    return scene.zoneMap.interactables
      .filter((o) => o.kind === 'door')
      .map((o) => {
        const door = { x: o.tile.x, y: o.tile.y };
        // The one neighbouring tile you can actually stand on to use it.
        const neighbours = [
          { dir: 'up', from: { x: door.x, y: door.y + 1 } },
          { dir: 'down', from: { x: door.x, y: door.y - 1 } },
          { dir: 'left', from: { x: door.x + 1, y: door.y } },
          { dir: 'right', from: { x: door.x - 1, y: door.y } },
        ].filter((n) => scene.zoneMap.isWalkable(n.from));
        return {
          target: o.props?.targetZone,
          door,
          from: neighbours[0]?.from ?? null,
          dir: neighbours[0]?.dir ?? null,
        };
      });
  });

  const routes = doors
    .filter((d) => SCENE_FOR_ZONE[d.target] && d.from)
    .map((d) => ({ ...SCENE_FOR_ZONE[d.target], door: d.door, from: d.from, dir: d.dir, back: d.from }));

  check('every walkable zone door was found in the map', routes.length === 5, `${routes.length}`);

  for (const route of routes) {
    console.log(`\n-> ${route.name}`);
    await dismissDialogue(page);

    await stepOnto(page, route.from, route.dir);
    await waitForScene(page, route.zone);

    s = await worldState(page);
    check(`entered the ${route.name}`, s.scene === route.zone, `in ${s.scene}`);
    check(`${route.name} has a walkable spawn`, s.ready && s.state === 'IDLE', s.state);
    check(`${route.name} loaded its interactables`, s.interactables > 0, `${s.interactables}`);

    // Walk back out through the interior's exit door.
    const exitTile = await page.evaluate((key) => {
      const scene = window.__COMMONS__.game.scene.getScene(key);
      const door = scene.zoneMap.interactables.find((o) => o.kind === 'door');
      return door ? { x: door.tile.x, y: door.tile.y } : null;
    }, route.zone);
    check(`${route.name} has an exit door`, exitTile !== null);
    if (!exitTile) continue;

    await stepOnto(page, { x: exitTile.x, y: exitTile.y - 1 }, 'down');
    await waitForScene(page, 'TownSquareScene');

    s = await worldState(page);
    check(`back in Town Square from the ${route.name}`, s.scene === 'TownSquareScene', `in ${s.scene}`);
    check(
      `arrived at the ${route.name} door, not the default spawn`,
      s.tile.x === route.back.x && s.tile.y === route.back.y,
      `at ${JSON.stringify(s.tile)}, expected ${JSON.stringify(route.back)}`,
    );
  }

  // --- sitting -------------------------------------------------------------
  console.log('\nsitting');
  await dismissDialogue(page);
  const libraryRoute = routes.find((r) => r.zone === 'LibraryScene');
  await stepOnto(page, libraryRoute.from, libraryRoute.dir);
  await waitForScene(page, 'LibraryScene');
  await dismissDialogue(page);

  // Face a focus pod and sit.
  const podApproach = await page.evaluate(() => {
    const scene = window.__COMMONS__.game.scene.getScene('LibraryScene');
    const pod = scene.zoneMap.interactables.find((o) => o.kind === 'focus_pod');
    return pod ? { x: pod.tile.x, y: pod.tile.y + 1 } : null;
  });
  check('library has a focus pod', podApproach !== null);

  if (podApproach) {
    await page.evaluate((tile) => {
      const scene = window.__COMMONS__.game.scene.getScene('LibraryScene');
      scene.player.movement.teleport(tile, 'up');
    }, podApproach);
    await page.waitForTimeout(180);

    await page.keyboard.down('Space');
    await page.waitForTimeout(90);
    await page.keyboard.up('Space');
    await page.waitForTimeout(500);

    s = await worldState(page);
    check('sitting at a focus pod', s.sitting === true, s.state);
    check('status becomes studying, with no toggle', s.status === 'studying', s.status);

    // WASD must do nothing while seated.
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyS');
    await page.waitForTimeout(200);
    const seated = await worldState(page);
    check('cannot walk away while seated', seated.tile.y === podApproach.y, `y=${seated.tile.y}`);

    // Space again stands up.
    await page.keyboard.down('Space');
    await page.waitForTimeout(90);
    await page.keyboard.up('Space');
    await page.waitForTimeout(500);
    const stood = await worldState(page);
    check('standing up ends the session', stood.sitting === false && stood.status === 'idle', stood.status);
  }

  // --- friends panel -------------------------------------------------------
  console.log('\nfriends panel');
  await dismissDialogue(page);
  await page.keyboard.down('Escape');
  await page.waitForTimeout(90);
  await page.keyboard.up('Escape');
  await page.waitForTimeout(400);
  s = await worldState(page);
  check('Esc opens the friends panel', s.friendsOpen === true);

  const beforeTile = s.tile;
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(320);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(200);
  s = await worldState(page);
  check('world input is ignored while the panel is open', s.tile.y === beforeTile.y, `y=${s.tile.y}`);

  await page.keyboard.down('Escape');
  await page.waitForTimeout(90);
  await page.keyboard.up('Escape');
  await page.waitForTimeout(400);
  s = await worldState(page);
  check('Esc closes the friends panel', s.friendsOpen === false);

  // --- screenshots ---------------------------------------------------------
  const shotDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: resolve(shotDir, 'phase2_library.png') });

  // Same routes as above, so these follow the map too.
  const shots = [
    ['CafeScene', 'phase2_cafe.png'],
    ['ParkScene', 'phase2_park.png'],
    ['ArcadeScene', 'phase2_arcade.png'],
  ]
    .map(([zone, file]) => {
      const route = routes.find((r) => r.zone === zone);
      return route ? [zone, route.from, route.dir, file] : null;
    })
    .filter(Boolean);

  for (const [zone, from, dir, file] of shots) {
    await dismissDialogue(page);
    // Get back to the square first.
    const cur = await worldState(page);
    if (cur.scene !== 'TownSquareScene') {
      const exitTile = await page.evaluate((key) => {
        const scene = window.__COMMONS__.game.scene.getScene(key);
        const door = scene.zoneMap.interactables.find((o) => o.kind === 'door');
        return door ? { x: door.tile.x, y: door.tile.y } : null;
      }, cur.scene);
      if (exitTile) {
        await stepOnto(page, { x: exitTile.x, y: exitTile.y - 1 }, 'down');
        await waitForScene(page, 'TownSquareScene');
      }
    }
    await dismissDialogue(page);
    await stepOnto(page, from, dir);
    await waitForScene(page, zone);
    await dismissDialogue(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(shotDir, file) });
  }
  console.log(`  wrote zone screenshots to ${shotDir}`);

  check('no unexpected page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (error) {
  failures.push(`harness error: ${error.message}`);
  console.error('\nharness error:', error);
} finally {
  await browser?.close();
  if (vite) {
    vite.kill();
    if (isWin) spawn('taskkill', ['/pid', String(vite.pid), '/f', '/t'], { stdio: 'ignore' });
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
