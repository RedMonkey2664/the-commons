/**
 * Contact sheet of every cosmetic combination.
 *
 * The polish suite proves a hat changes pixels; it cannot tell you whether the
 * hat looks like a hat. This renders every outfit and every hat at 4x into one
 * PNG so the art can be judged by eye, which is the only way to judge art.
 *
 *   node tools/capture_cosmetics.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_PORT = 5183;

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  // Skip name entry: this is an art check, not a flow check.
  await context.addInitScript(() => {
    localStorage.setItem(
      'commons.session',
      JSON.stringify({ displayName: 'Art', userId: 'u_art_check' }),
    );
  });
  const page = await context.newPage();
  await page.goto(`http://localhost:${CLIENT_PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__COMMONS__?.game?.scene?.scenes?.some((s) => s.scene.isActive() && s.player),
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1200);

  // Vite serves aliased sources from /@fs, so the page can import the very
  // modules the game uses rather than a copy of their contents.
  const sharedUrl = `/@fs/${resolve(repoRoot, 'shared', 'index.ts').split('\\').join('/')}`;

  const dataUrl = await page.evaluate(async (sharedUrl) => {
    const game = window.__COMMONS__.game;
    const scene = game.scene.scenes.find((s) => s.scene.isActive() && s.player);
    if (!scene) return null;

    // Reach the real generator through the module graph rather than
    // reimplementing it here, so this sheet shows what the game draws.
    const art = await import('/src/art/placeholderArt.ts');
    const shared = await import(/* @vite-ignore */ sharedUrl);
    const cosmetics = shared.COSMETICS;

    const outfits = cosmetics.filter((c) => c.slot === 'outfit');
    const hats = cosmetics.filter((c) => c.slot === 'hat');

    const SCALE = 4;
    const FW = 32;
    const FH = 64;
    const cols = 1 + hats.length; // bare, then one per hat
    const rows = outfits.length;
    const pad = 8;

    const canvas = document.createElement('canvas');
    canvas.width = (FW * 4 * cols + pad * (cols + 1)) * SCALE;
    canvas.height = (FH * rows + pad * (rows + 1)) * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#20242C';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    outfits.forEach((outfit, r) => {
      const combos = [undefined, ...hats.map((h) => ({ color: h.color, style: h.style }))];
      combos.forEach((hat, c) => {
        const key = art.ensureOutfitSheet(scene, outfit.color, hat);
        const src = game.textures.get(key).getSourceImage();
        // Row 0 of the sheet is the facing-down walk cycle: all four frames.
        ctx.drawImage(
          src,
          0, 0, FW * 4, FH,
          (pad + c * (FW * 4 + pad)) * SCALE,
          (pad + r * (FH + pad)) * SCALE,
          FW * 4 * SCALE,
          FH * SCALE,
        );
      });
    });

    return canvas.toDataURL('image/png');
  }, sharedUrl);

  if (!dataUrl) throw new Error('no active zone scene to draw from');

  const outDir = resolve(repoRoot, 'tools', 'screenshots');
  mkdirSync(outDir, { recursive: true });
  const out = resolve(outDir, 'cosmetics.png');
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
