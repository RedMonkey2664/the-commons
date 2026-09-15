/**
 * The rocket, the worlds, and the bits of light around them.
 *
 * Drawn the same way as the rest of the game — procedurally, into canvas
 * textures, from palette tokens — so the progression screen looks like it
 * belongs to The Commons rather than to a UI kit. Generated once and cached by
 * key; nothing here runs per frame.
 */

import type Phaser from 'phaser';
import { COLORS, WORLD_PALETTES, mix, type WorldPaletteId } from '@commons/shared';
import { paint } from './placeholderArt';

const { rect, createCanvas } = paint;

export const ROCKET_ART = {
  rocket: 'rocket_body',
  flame: 'rocket_flame',
  spark: 'rocket_spark',
  star: 'map_star',
  lock: 'map_lock',
  planet: (palette: WorldPaletteId) => `map_planet_${palette}`,
} as const;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = createCanvas(scene, key, w, h);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  texture.refresh();
}

/**
 * A small, chunky rocket: the one object on the map that represents the
 * player's effort, so it gets the most care. White hull with a lit left edge,
 * a porthole in the world accent, red fins, and a nose cone.
 */
function drawRocket(scene: Phaser.Scene): void {
  make(scene, ROCKET_ART.rocket, 26, 46, (ctx) => {
    const hull = '#EEF1F5';
    const hullShade = '#B9C2CE';
    const fin = COLORS.interactBubbleMark;
    const finShade = mix(fin, '#000000', 0.3);

    // Nose cone, stepped so it reads as round at this size.
    rect(ctx, 11, 0, 4, 2, fin);
    rect(ctx, 9, 2, 8, 3, fin);
    rect(ctx, 8, 5, 10, 3, finShade);

    // Hull
    rect(ctx, 7, 8, 12, 26, hull);
    rect(ctx, 15, 8, 4, 26, hullShade);
    rect(ctx, 7, 8, 2, 26, '#FFFFFF');

    // Porthole
    rect(ctx, 10, 13, 6, 6, '#23262B');
    rect(ctx, 11, 14, 4, 4, COLORS.glassLight);
    rect(ctx, 11, 14, 2, 2, '#FFFFFF');

    // Band
    rect(ctx, 7, 24, 12, 2, fin);

    // Fins
    rect(ctx, 2, 26, 5, 10, fin);
    rect(ctx, 2, 34, 5, 2, finShade);
    rect(ctx, 19, 26, 5, 10, finShade);
    rect(ctx, 11, 28, 4, 8, finShade);

    // Nozzle
    rect(ctx, 9, 34, 8, 4, '#4A5059');
    rect(ctx, 10, 38, 6, 2, '#2B2E33');

    ctx.save();
    ctx.strokeStyle = 'rgba(20,22,26,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 7.5, 13, 27);
    ctx.restore();
  });

  // A single flame; the scene scales and flickers it rather than flipping frames.
  make(scene, ROCKET_ART.flame, 12, 20, (ctx) => {
    rect(ctx, 3, 0, 6, 6, '#FFF3CE');
    rect(ctx, 2, 4, 8, 7, COLORS.flowerYellow);
    rect(ctx, 3, 10, 6, 6, COLORS.interactBubbleMark);
    rect(ctx, 5, 15, 2, 5, mix(COLORS.interactBubbleMark, '#000000', 0.3));
  });

  make(scene, ROCKET_ART.spark, 4, 4, (ctx) => {
    rect(ctx, 1, 0, 2, 4, '#FFFFFF');
    rect(ctx, 0, 1, 4, 2, '#FFFFFF');
  });

  make(scene, ROCKET_ART.star, 3, 3, (ctx) => {
    rect(ctx, 1, 0, 1, 3, '#FFFFFF');
    rect(ctx, 0, 1, 3, 1, '#FFFFFF');
  });

  // A padlock, for worlds you can see but cannot reach yet.
  make(scene, ROCKET_ART.lock, 12, 14, (ctx) => {
    const metal = '#E6E9EE';
    rect(ctx, 3, 0, 6, 2, metal);
    rect(ctx, 2, 1, 2, 5, metal);
    rect(ctx, 8, 1, 2, 5, metal);
    rect(ctx, 0, 6, 12, 8, COLORS.flowerYellow);
    rect(ctx, 0, 6, 12, 2, mix(COLORS.flowerYellow, '#FFFFFF', 0.4));
    rect(ctx, 5, 9, 2, 3, '#4A3A2A');
  });
}

/**
 * One planet per world, built from that world's palette: a banded disc with a
 * lit limb and a shadowed terminator, so a row of them reads as places rather
 * than coloured circles. Some worlds get a signature detail.
 */
function drawPlanet(scene: Phaser.Scene, id: WorldPaletteId): void {
  const p = WORLD_PALETTES[id];
  const size = 72;

  make(scene, ROCKET_ART.planet(id), size, size, (ctx) => {
    const c = size / 2;
    const r = size / 2 - 6;

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.clip();

    // Bands, from the world's own colours.
    const bands = [p.windowHorizon, p.accent, p.wall, p.accent, p.windowHorizon, p.floor];
    const bandH = (r * 2) / bands.length;
    bands.forEach((colour, i) => {
      ctx.fillStyle = colour;
      ctx.fillRect(c - r, c - r + i * bandH, r * 2, bandH + 1);
    });

    // Signature details, so each world is recognisable at a glance.
    if (id === 'forest') {
      ctx.fillStyle = mix(p.accent, '#000000', 0.35);
      for (const [x, y] of [[20, 30], [34, 24], [44, 40], [26, 46]] as const) ctx.fillRect(x, y, 6, 5);
    } else if (id === 'summit') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(c - r, c - r, r * 2, 10); // an ice cap
    } else if (id === 'deepField') {
      ctx.fillStyle = p.windowAccent;
      for (const [x, y] of [[22, 22], [46, 30], [30, 48], [52, 50]] as const) ctx.fillRect(x, y, 2, 2);
    } else if (id === 'dusk') {
      ctx.fillStyle = COLORS.windowWarm;
      for (const [x, y] of [[24, 40], [30, 42], [42, 38], [48, 44]] as const) ctx.fillRect(x, y, 2, 2);
    }

    // Lit limb, dark terminator.
    const shade = ctx.createLinearGradient(c - r, c - r, c + r, c + r);
    shade.addColorStop(0, 'rgba(255,255,255,0.22)');
    shade.addColorStop(0.45, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(c - r, c - r, r * 2, r * 2);
    ctx.restore();

    // Orbit gets a ring, because of course it does.
    if (id === 'orbit') {
      ctx.save();
      ctx.strokeStyle = mix(p.windowAccent, '#FFFFFF', 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(c, c, r + 5, r * 0.32, -0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Outline, matching the character outline weight.
    ctx.save();
    ctx.strokeStyle = 'rgba(20,22,26,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

export function ensureRocketArt(scene: Phaser.Scene): void {
  drawRocket(scene);
  for (const id of Object.keys(WORLD_PALETTES) as WorldPaletteId[]) drawPlanet(scene, id);
}
