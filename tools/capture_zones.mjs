/**
 * Screenshot named zones, for looking at rather than asserting on.
 *
 *   node tools/capture_zones.mjs                # every zone
 *   node tools/capture_zones.mjs cafe library   # just these
 *
 * Level design is one of the few things a test genuinely cannot check: a map
 * can verify as reachable and still read as an empty hall.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_PORT = 5184;

const ZONE_SCENES = {
  town_square: 'TownSquareScene',
  library: 'LibraryScene',
  cafe: 'CafeScene',
  arcade: 'ArcadeScene',
  park: 'ParkScene',
  study_room: 'StudyRoomScene',
  skyline_terrace: 'SkylineTerraceScene',
  greenhouse: 'GreenhouseScene',
};

const wanted = process.argv.slice(2).filter((a) => a in ZONE_SCENES);
const zones = wanted.length > 0 ? wanted : Object.keys(ZONE_SCENES);

function spawnAndWait(command, args, cwd, readyPattern) {
  return new Promise((res, rej) => {
    const child = spawn(command, args, { cwd, shell: true });
    const timer = setTimeout(() => rej(new Error('client did not start')), 60_000);
    const onData = (buf) => {
      if (readyPattern.test(String(buf))) {
        clearTimeout(timer);
        res(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

let vite;
let browser;

try {
  vite = await spawnAndWait(
    'npx',
    ['vite', '--port', String(CLIENT_PORT), '--strictPort'],
    resolve(repoRoot, 'client'),
    /ready in|Local:/,
  );

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'commons.session',
      JSON.stringify({ displayName: 'Scout', userId: 'u_zone_capture' }),
    );
    // Single-player: this is an art check, and a live server would put other
    // people's avatars in the shot.
    localStorage.setItem('commons.serverUrl', 'ws://127.0.0.1:1');
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1500);

  const outDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(outDir, { recursive: true });

  for (const zoneId of zones) {
    await page.evaluate((id) => {
      const game = window.__COMMONS__.game;
      const scene = game.scene.scenes.find((s) => s.scene.isActive() && s.player);
      scene.transitionTo(id);
    }, zoneId);

    await page.waitForFunction(
      (key) => Boolean(window.__COMMONS__?.game?.scene?.isActive(key)),
      ZONE_SCENES[zoneId],
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1200);

    const out = resolve(outDir, `zone_${zoneId}.png`);
    await page.screenshot({ path: out });
    console.log('wrote', out);
  }
} finally {
  await browser?.close();
  if (vite) {
    try {
      process.kill(vite.pid);
    } catch {
      /* already gone */
    }
    spawn('taskkill', ['/pid', String(vite.pid), '/f', '/t'], { shell: true });
  }
}
