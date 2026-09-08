/**
 * Dump the generated tileset to a PNG, scaled up, for inspecting tiles by eye.
 *
 *   node tools/capture_tileset.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_PORT = 5185;

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
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'commons.session',
      JSON.stringify({ displayName: 'Scout', userId: 'u_tileset' }),
    );
    localStorage.setItem('commons.serverUrl', 'ws://127.0.0.1:1');
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);

  const dataUrl = await page.evaluate(() => {
    const src = window.__COMMONS__.game.textures.get('tiles_commons').getSourceImage();
    const SCALE = 4;
    const c = document.createElement('canvas');
    c.width = src.width * SCALE;
    c.height = src.height * SCALE;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);

    // index labels, so a wrong tile can be named rather than pointed at
    ctx.font = '10px monospace';
    for (let i = 0; i < 64; i += 1) {
      const x = (i % 8) * 32 * SCALE;
      const y = Math.floor(i / 8) * 32 * SCALE;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y, 20, 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i), x + 3, y + 9);
    }
    return c.toDataURL('image/png');
  });

  const outDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, 'tileset.png');
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', out);
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
