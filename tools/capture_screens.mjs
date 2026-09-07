#!/usr/bin/env node
/**
 * Capture the loading screen, title screen and world at a realistic window size.
 *
 *   node tools/capture_screens.mjs
 *
 * Exists because these three screens are the entire first impression, and they
 * are the one part of the game the automated suites cannot judge.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const PORT = 5181;
const isWin = process.platform === 'win32';

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

const shotDir = resolve(repoRoot, 'tools', 'screenshots');
mkdirSync(shotDir, { recursive: true });

const vite = await startVite();
const browser = await chromium.launch();

// A realistic laptop window, not a square test viewport.
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await context.addInitScript(() => {
  localStorage.removeItem('commons.session');
  localStorage.setItem('commons.serverUrl', 'ws://localhost:59999');
});

const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

// Loading screen — grab it mid-build.
await page.waitForTimeout(180);
await page.screenshot({ path: resolve(shotDir, 'screen_loading.png') });

// Title screen.
await page.waitForFunction(
  () => window.__COMMONS__?.game?.scene?.isActive('TitleScene'),
  null,
  { timeout: 20_000 },
);
await page.waitForTimeout(900);
await page.screenshot({ path: resolve(shotDir, 'screen_title.png') });

// Type a name and walk in.
await page.keyboard.type('Somya', { delay: 60 });
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(shotDir, 'screen_title_typed.png') });

await page.keyboard.press('Enter');
await page.waitForFunction(
  () => Boolean(window.__COMMONS__?.game?.scene?.getScene('TownSquareScene')?.player),
  null,
  { timeout: 20_000 },
);
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(shotDir, 'screen_world.png') });

// Open a dialogue for the UI shot.
await page.evaluate(() => {
  const s = window.__COMMONS__.game.scene.getScene('TownSquareScene');
  s.player.movement.teleport({ x: 19, y: 20 }, 'right');
});
await page.waitForTimeout(200);
await page.keyboard.down('Space');
await page.waitForTimeout(90);
await page.keyboard.up('Space');
await page.waitForTimeout(1100);
await page.screenshot({ path: resolve(shotDir, 'screen_dialogue.png') });

console.log('wrote screenshots to', shotDir);

await browser.close();
vite.kill();
if (isWin) spawn('taskkill', ['/pid', String(vite.pid), '/f', '/t'], { stdio: 'ignore' });
process.exit(0);
