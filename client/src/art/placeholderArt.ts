/**
 * Generated art, drawn at runtime into canvas textures.
 *
 * Authored at 32x32 per tile and 32x64 per character — four times the pixel
 * budget of the original 16px grid, which is what lets each tile carry real
 * shading, edge highlights and material detail instead of a flat fill.
 *
 * Everything is still procedural: no binary assets to manage, and the whole
 * look is tunable from shared/designTokens.ts. Asset keys in ASSET_KEYS remain
 * the contract, so swapping in hand-drawn PNGs later means loading a file under
 * the same key in BootScene and deleting the matching generator call.
 *
 * TILE_INDEX is the shared vocabulary between this file and
 * tools/generate_placeholder_maps.py — the two MUST agree, so both list the
 * tiles in the same order and the Python side references the same names.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, mix } from '@commons/shared';

const T = SPACING.tile; // 32

/** Stable asset keys. Real art replaces the source, never these strings. */
export const ASSET_KEYS = {
  tileset: 'tiles_commons',
  playerSheet: 'char_player',
  remoteSheet: 'char_remote',
  npcSheet: 'char_npc',
  signpost: 'obj_signpost',
  door: 'obj_door',
  interactBubble: 'ui_interact_bubble',
  shadow: 'fx_shadow',
} as const;

/**
 * Tileset layout: 8 columns x 4 rows of 32x32 tiles.
 * Index order is load-bearing — keep in sync with the map generator.
 */
export const TILE_INDEX = {
  // row 0 — ground
  grass: 0,
  grassFlowers: 1,
  grassPatch: 2,
  paving: 3,
  pavingSeam: 4,
  plaza: 5,
  plazaAccent: 6,
  plazaInlay: 7,
  // row 1 — water & surfaces
  water: 8,
  waterRipple: 9,
  fountainRim: 10,
  deck: 11,
  gravel: 12,
  curb: 13,
  grassEdge: 14,
  manhole: 15,
  // row 2 — architecture
  wall: 16,
  window: 17,
  windowLit: 18,
  storefront: 19,
  roofEdge: 20,
  doorGlass: 21,
  pillar: 22,
  awning: 23,
  // row 3 — props & nature
  tree: 24,
  treeSmall: 25,
  hedge: 26,
  planter: 27,
  bench: 28,
  lamp: 29,
  flowerbed: 30,
  bollard: 31,
} as const;

export const TILESET_COLUMNS = 8;
export const TILESET_ROWS = 4;
export const TILE_COUNT = TILESET_COLUMNS * TILESET_ROWS;

/** Character sheet layout: 4 directions x 4 frames, 32x64 each. */
export const CHAR_FRAME_WIDTH = 32;
export const CHAR_FRAME_HEIGHT = 64;
export const CHAR_ROWS = { down: 0, left: 1, right: 2, up: 3 } as const;
export const CHAR_FRAMES_PER_ROW = 4;

type Ctx = CanvasRenderingContext2D;

function createCanvas(scene: Phaser.Scene, key: string, width: number, height: number) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) throw new Error(`Failed to create canvas texture "${key}"`);
  return texture;
}

// ---------------------------------------------------------------------------
// tiny drawing helpers
// ---------------------------------------------------------------------------

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic pseudo-random, so the art is byte-identical every run. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Speckled noise, for material grain. */
function grain(ctx: Ctx, ox: number, oy: number, color: string, seed: number, count: number, alpha = 1) {
  const rng = makeRng(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    ctx.fillRect(ox + Math.floor(rng() * T), oy + Math.floor(rng() * T), 1, 1);
  }
  ctx.restore();
}

/** Vertical gradient fill across one tile. */
function vGradient(ctx: Ctx, ox: number, oy: number, top: string, bottom: string) {
  const gradient = ctx.createLinearGradient(ox, oy, ox, oy + T);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox, oy, T, T);
}

/** Soft elliptical shadow, used to seat props on the ground. */
function shadowEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, alpha = 0.22) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Tileset
// ---------------------------------------------------------------------------

type TileDrawer = (ctx: Ctx, ox: number, oy: number) => void;

/** Grass base, reused by every tile that sits on lawn. */
function drawGrassBase(ctx: Ctx, ox: number, oy: number, seed: number) {
  vGradient(ctx, ox, oy, COLORS.grassLight, COLORS.grass);
  grain(ctx, ox, oy, COLORS.grassDark, seed, 42, 0.35);
  grain(ctx, ox, oy, COLORS.grassLight, seed + 7, 26, 0.4);
  // short blades for texture
  const rng = makeRng(seed + 13);
  ctx.strokeStyle = COLORS.grassDark;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 10; i += 1) {
    const x = ox + Math.floor(rng() * T);
    const y = oy + Math.floor(rng() * T);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Paving slab with bevelled edges — the base for all hard surfaces. */
function drawSlab(ctx: Ctx, ox: number, oy: number, base: string, light: string, dark: string, seam: string) {
  vGradient(ctx, ox, oy, light, base);
  grain(ctx, ox, oy, dark, 91, 30, 0.18);
  // Seam lines on two edges only, so tiles read as a continuous surface.
  // Kept low-contrast on purpose: at full strength a whole plaza of these
  // reads as graph paper rather than paving.
  ctx.globalAlpha = 0.55;
  rect(ctx, ox, oy, T, 1, seam);
  rect(ctx, ox, oy, 1, T, seam);
  // bevel highlight just inside the seam
  ctx.globalAlpha = 0.3;
  rect(ctx, ox + 1, oy + 1, T - 1, 1, light);
  rect(ctx, ox + 1, oy + 1, 1, T - 1, light);
  ctx.globalAlpha = 1;
}

const TILE_DRAWERS: TileDrawer[] = [];
const set = (index: number, drawer: TileDrawer) => {
  TILE_DRAWERS[index] = drawer;
};

// ---- row 0: ground --------------------------------------------------------

set(TILE_INDEX.grass, (ctx, ox, oy) => drawGrassBase(ctx, ox, oy, 11));

set(TILE_INDEX.grassFlowers, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 29);
  const blooms: Array<[number, number, string]> = [
    [7, 11, COLORS.flowerPink],
    [20, 8, COLORS.flowerWhite],
    [13, 22, COLORS.flowerYellow],
    [25, 19, COLORS.flowerPink],
  ];
  for (const [bx, by, color] of blooms) {
    rect(ctx, ox + bx, oy + by + 2, 1, 4, COLORS.foliageDark); // stem
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox + bx + 0.5, oy + by, 2.2, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, ox + bx, oy + by - 1, 1, 1, '#FFFFFF');
  }
});

set(TILE_INDEX.grassPatch, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 47);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = COLORS.grassDark;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 17, 11, 8, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  grain(ctx, ox, oy, COLORS.soil, 61, 14, 0.3);
});

set(TILE_INDEX.paving, (ctx, ox, oy) =>
  drawSlab(ctx, ox, oy, COLORS.paving, COLORS.pavingLight, COLORS.pavingDark, COLORS.pavingSeam));

set(TILE_INDEX.pavingSeam, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.paving, COLORS.pavingLight, COLORS.pavingDark, COLORS.pavingSeam);
  // half-slab joint through the middle, for a running-bond look
  rect(ctx, ox, oy + 16, T, 1, COLORS.pavingSeam);
  ctx.globalAlpha = 0.45;
  rect(ctx, ox, oy + 17, T, 1, COLORS.pavingLight);
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.plaza, (ctx, ox, oy) =>
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.35), COLORS.plazaAccent, COLORS.pavingSeam));

set(TILE_INDEX.plazaAccent, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plazaAccent, mix(COLORS.plazaAccent, '#FFFFFF', 0.3), COLORS.pavingDark, COLORS.pavingSeam);
  // inset block, like a contrasting granite paver
  ctx.globalAlpha = 0.3;
  rect(ctx, ox + 6, oy + 6, 20, 20, COLORS.plaza);
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.plazaInlay, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.3), COLORS.plazaAccent, COLORS.pavingSeam);
  // Decorative band. Low contrast against the plaza so it reads as an inlay
  // in the paving rather than an object standing on it.
  ctx.globalAlpha = 0.55;
  rect(ctx, ox, oy + 13, T, 6, COLORS.plazaInlay);
  ctx.globalAlpha = 0.3;
  rect(ctx, ox, oy + 13, T, 1, mix(COLORS.plazaInlay, '#FFFFFF', 0.6));
  rect(ctx, ox, oy + 18, T, 1, mix(COLORS.plazaInlay, '#000000', 0.35));
  ctx.globalAlpha = 1;
});

// ---- row 1: water & surfaces ---------------------------------------------

function drawWaterBase(ctx: Ctx, ox: number, oy: number, seed: number) {
  vGradient(ctx, ox, oy, COLORS.waterLight, COLORS.waterDeep);

  // Mottled depth, so the surface is not a flat colour field.
  const rng = makeRng(seed);
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = rng() > 0.5 ? COLORS.waterLight : COLORS.waterDeep;
    ctx.beginPath();
    ctx.ellipse(
      ox + rng() * T, oy + rng() * T,
      5 + rng() * 8, 3 + rng() * 4,
      rng() * Math.PI, 0, Math.PI * 2,
    );
    ctx.fill();
  }

  // Short curved highlights rather than full-width rules — straight lines
  // spanning every tile line up across the pool and read as a barcode.
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = COLORS.waterFoam;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i += 1) {
    const cx = ox + 4 + rng() * (T - 8);
    const cy = oy + 4 + rng() * (T - 8);
    const r = 3 + rng() * 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

set(TILE_INDEX.water, (ctx, ox, oy) => drawWaterBase(ctx, ox, oy, 5));
set(TILE_INDEX.waterRipple, (ctx, ox, oy) => {
  drawWaterBase(ctx, ox, oy, 23);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = COLORS.waterFoam;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 16, 9, 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 16, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.fountainRim, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.concreteLight, '#FFFFFF', 0.2), COLORS.concrete);
  grain(ctx, ox, oy, COLORS.concreteDark, 71, 24, 0.2);
  rect(ctx, ox, oy, T, 3, mix(COLORS.concreteLight, '#FFFFFF', 0.45));
  rect(ctx, ox, oy + T - 3, T, 3, COLORS.concreteDark);
  rect(ctx, ox, oy, 1, T, COLORS.concreteDark);
});

set(TILE_INDEX.deck, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.benchWood, '#FFFFFF', 0.2), COLORS.benchWood);
  for (let i = 0; i < 4; i += 1) {
    rect(ctx, ox, oy + i * 8, T, 1, mix(COLORS.benchWood, '#000000', 0.35));
    ctx.globalAlpha = 0.4;
    rect(ctx, ox, oy + i * 8 + 1, T, 1, mix(COLORS.benchWood, '#FFFFFF', 0.4));
    ctx.globalAlpha = 1;
  }
  grain(ctx, ox, oy, mix(COLORS.benchWood, '#000000', 0.25), 83, 20, 0.25);
});

set(TILE_INDEX.gravel, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.paving, '#FFFFFF', 0.1), COLORS.pavingDark);
  grain(ctx, ox, oy, COLORS.pavingSeam, 101, 60, 0.5);
  grain(ctx, ox, oy, mix(COLORS.pavingLight, '#FFFFFF', 0.4), 109, 40, 0.4);
});

set(TILE_INDEX.curb, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 37);
  rect(ctx, ox, oy, T, 10, COLORS.paving);
  rect(ctx, ox, oy + 10, T, 2, COLORS.pavingDark);
  ctx.globalAlpha = 0.5;
  rect(ctx, ox, oy, T, 1, COLORS.pavingLight);
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.grassEdge, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 53);
  ctx.globalAlpha = 0.35;
  rect(ctx, ox, oy, T, 2, COLORS.grassDark);
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.manhole, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.paving, COLORS.pavingLight, COLORS.pavingDark, COLORS.pavingSeam);
  ctx.fillStyle = COLORS.steel;
  ctx.beginPath();
  ctx.arc(ox + 16, oy + 16, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mix(COLORS.steel, '#000000', 0.4);
  ctx.beginPath();
  ctx.arc(ox + 16, oy + 16, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = mix(COLORS.steel, '#FFFFFF', 0.4);
  ctx.beginPath();
  ctx.arc(ox + 16, oy + 15, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
});

// ---- row 2: architecture --------------------------------------------------

set(TILE_INDEX.wall, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, COLORS.concreteLight, COLORS.concrete);
  grain(ctx, ox, oy, COLORS.concreteDark, 131, 26, 0.15);
  // panel joints
  rect(ctx, ox, oy, T, 1, COLORS.concreteDark);
  rect(ctx, ox, oy + 1, T, 1, mix(COLORS.concreteLight, '#FFFFFF', 0.4));
  rect(ctx, ox, oy, 1, T, mix(COLORS.concreteDark, '#000000', 0.1));
});

function drawWindow(ctx: Ctx, ox: number, oy: number, lit: boolean) {
  // frame
  vGradient(ctx, ox, oy, COLORS.concreteLight, COLORS.concrete);
  rect(ctx, ox, oy, T, 1, COLORS.concreteDark);

  const glassTop = lit ? COLORS.glassLit : COLORS.glassLight;
  const glassBottom = lit ? mix(COLORS.glassLit, '#B08A3C', 0.5) : COLORS.glass;
  const gradient = ctx.createLinearGradient(ox + 3, oy + 4, ox + T - 3, oy + T - 5);
  gradient.addColorStop(0, glassTop);
  gradient.addColorStop(1, glassBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 3, oy + 4, T - 6, T - 9);

  // diagonal reflection streak — the thing that makes glass read as glass
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 3, oy + 4, T - 6, T - 9);
  ctx.clip();
  ctx.globalAlpha = lit ? 0.25 : 0.4;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(ox + 4, oy + T - 6);
  ctx.lineTo(ox + 14, oy + 3);
  ctx.lineTo(ox + 20, oy + 3);
  ctx.lineTo(ox + 10, oy + T - 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // mullions + sill
  rect(ctx, ox + 3, oy + 4, T - 6, 1, COLORS.steel);
  rect(ctx, ox + 3, oy + T - 6, T - 6, 2, COLORS.steel);
  rect(ctx, ox + 3, oy + 4, 1, T - 9, COLORS.steel);
  rect(ctx, ox + T - 4, oy + 4, 1, T - 9, COLORS.steel);
  ctx.globalAlpha = 0.5;
  rect(ctx, ox + 3, oy + T - 4, T - 6, 1, mix(COLORS.concreteLight, '#FFFFFF', 0.5));
  ctx.globalAlpha = 1;
}

set(TILE_INDEX.window, (ctx, ox, oy) => drawWindow(ctx, ox, oy, false));
set(TILE_INDEX.windowLit, (ctx, ox, oy) => drawWindow(ctx, ox, oy, true));

set(TILE_INDEX.storefront, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, COLORS.storefront, mix(COLORS.storefront, '#000000', 0.3));
  // plinth highlight
  rect(ctx, ox, oy, T, 2, mix(COLORS.storefront, '#FFFFFF', 0.25));
  // warm interior glow through the glass
  const gradient = ctx.createLinearGradient(ox, oy + 4, ox, oy + T - 6);
  gradient.addColorStop(0, mix(COLORS.glassLit, COLORS.storefront, 0.35));
  gradient.addColorStop(1, mix(COLORS.storefront, '#000000', 0.2));
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 3, oy + 4, T - 6, T - 12);
  rect(ctx, ox + 3, oy + 4, T - 6, 1, COLORS.steel);
  rect(ctx, ox + 15, oy + 4, 1, T - 16, COLORS.steel);
  rect(ctx, ox, oy + T - 6, T, 6, mix(COLORS.concrete, '#000000', 0.25));
});

set(TILE_INDEX.roofEdge, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.roofEdge, '#FFFFFF', 0.3), COLORS.roofEdge);
  rect(ctx, ox, oy, T, 3, mix(COLORS.roofEdge, '#FFFFFF', 0.5));
  rect(ctx, ox, oy + T - 4, T, 4, mix(COLORS.roofEdge, '#000000', 0.4));
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < T; i += 8) rect(ctx, ox + i, oy + 4, 1, T - 8, COLORS.concreteDark);
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.doorGlass, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, COLORS.concreteLight, COLORS.concrete);
  // recessed entrance
  rect(ctx, ox + 2, oy + 2, T - 4, T - 2, mix(COLORS.storefront, '#000000', 0.15));
  const gradient = ctx.createLinearGradient(ox + 4, oy + 4, ox + T - 4, oy + T);
  gradient.addColorStop(0, mix(COLORS.glassLight, '#FFFFFF', 0.3));
  gradient.addColorStop(1, COLORS.glass);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 4, oy + 4, T - 8, T - 4);
  // double-door split + handles
  rect(ctx, ox + 15, oy + 4, 2, T - 4, COLORS.steel);
  rect(ctx, ox + 11, oy + 17, 2, 6, mix(COLORS.steel, '#FFFFFF', 0.5));
  rect(ctx, ox + 19, oy + 17, 2, 6, mix(COLORS.steel, '#FFFFFF', 0.5));
  rect(ctx, ox + 2, oy + 2, T - 4, 2, COLORS.steel);
  ctx.globalAlpha = 0.35;
  rect(ctx, ox + 5, oy + 5, 4, T - 6, '#FFFFFF');
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.pillar, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.3), COLORS.plazaAccent, COLORS.pavingSeam);
  shadowEllipse(ctx, ox + 16, oy + 28, 9, 3.5);
  const gradient = ctx.createLinearGradient(ox + 9, oy, ox + 23, oy);
  gradient.addColorStop(0, COLORS.concreteDark);
  gradient.addColorStop(0.4, mix(COLORS.concreteLight, '#FFFFFF', 0.35));
  gradient.addColorStop(1, COLORS.concrete);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 9, oy + 2, 14, 27);
  rect(ctx, ox + 7, oy + 1, 18, 3, COLORS.concreteLight);
  rect(ctx, ox + 7, oy + 26, 18, 3, COLORS.concrete);
});

set(TILE_INDEX.awning, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.storefront, '#000000', 0.2), COLORS.storefront);
  // striped canopy
  for (let i = 0; i < T; i += 8) {
    rect(ctx, ox + i, oy + 6, 4, 14, COLORS.interactBubbleMark);
    rect(ctx, ox + i + 4, oy + 6, 4, 14, COLORS.dialogueBoxBg);
  }
  rect(ctx, ox, oy + 4, T, 2, mix(COLORS.steel, '#FFFFFF', 0.3));
  // scalloped lower edge
  ctx.fillStyle = mix(COLORS.storefront, '#000000', 0.35);
  for (let i = 0; i < T; i += 8) {
    ctx.beginPath();
    ctx.arc(ox + i + 4, oy + 20, 4, 0, Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 0.35;
  rect(ctx, ox, oy + 24, T, 8, '#000000');
  ctx.globalAlpha = 1;
});

// ---- row 3: props & nature ------------------------------------------------

function drawTree(ctx: Ctx, ox: number, oy: number, scale: number, seed: number) {
  drawGrassBase(ctx, ox, oy, seed);
  const cx = ox + 16;
  const baseY = oy + 29;

  shadowEllipse(ctx, cx + 2, baseY, 10 * scale, 3.5 * scale, 0.25);

  // trunk with a lit side
  const trunkW = Math.max(3, Math.round(4 * scale));
  rect(ctx, cx - trunkW / 2, baseY - 12 * scale, trunkW, 12 * scale, COLORS.trunk);
  rect(ctx, cx - trunkW / 2, baseY - 12 * scale, 1, 12 * scale, mix(COLORS.trunk, '#FFFFFF', 0.3));

  // canopy: three overlapping blobs, dark to light for volume
  const blobs: Array<[number, number, number, string]> = [
    [0, -20, 12, COLORS.foliageDark],
    [-5, -23, 9, COLORS.foliage],
    [4, -25, 8, COLORS.foliageLight],
  ];
  for (const [dx, dy, r, color] of blobs) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + dx * scale, baseY + dy * scale, r * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  // rim light
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = mix(COLORS.foliageLight, '#FFFFFF', 0.4);
  ctx.beginPath();
  ctx.arc(cx + 6 * scale, baseY - 27 * scale, 3 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

set(TILE_INDEX.tree, (ctx, ox, oy) => drawTree(ctx, ox, oy, 1, 17));
set(TILE_INDEX.treeSmall, (ctx, ox, oy) => drawTree(ctx, ox, oy, 0.72, 43));

set(TILE_INDEX.hedge, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 59);
  shadowEllipse(ctx, ox + 16, oy + 28, 13, 3);
  const gradient = ctx.createLinearGradient(ox, oy + 6, ox, oy + 29);
  gradient.addColorStop(0, mix(COLORS.hedge, '#FFFFFF', 0.35));
  gradient.addColorStop(1, COLORS.foliageDark);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox, oy + 8, T, 20);
  const rng = makeRng(67);
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 26; i += 1) {
    ctx.fillStyle = rng() > 0.5 ? COLORS.foliageLight : COLORS.foliageDark;
    ctx.fillRect(ox + Math.floor(rng() * T), oy + 8 + Math.floor(rng() * 20), 2, 2);
  }
  ctx.globalAlpha = 1;
  rect(ctx, ox, oy + 8, T, 1, mix(COLORS.hedge, '#FFFFFF', 0.5));
});

set(TILE_INDEX.planter, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.3), COLORS.plazaAccent, COLORS.pavingSeam);
  shadowEllipse(ctx, ox + 16, oy + 29, 11, 3);
  // concrete box
  const gradient = ctx.createLinearGradient(ox + 4, oy, ox + 28, oy);
  gradient.addColorStop(0, COLORS.concreteDark);
  gradient.addColorStop(0.35, mix(COLORS.planter, '#FFFFFF', 0.3));
  gradient.addColorStop(1, COLORS.concreteDark);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 4, oy + 14, 24, 15);
  rect(ctx, ox + 3, oy + 12, 26, 3, mix(COLORS.planter, '#FFFFFF', 0.45));
  // shrub
  for (const [dx, dy, r, color] of [
    [16, 10, 8, COLORS.foliageDark],
    [12, 8, 5.5, COLORS.foliage],
    [20, 9, 5, COLORS.foliageLight],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ox + dx, oy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
});

set(TILE_INDEX.bench, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.3), COLORS.plazaAccent, COLORS.pavingSeam);
  shadowEllipse(ctx, ox + 16, oy + 27, 13, 3);
  // legs
  rect(ctx, ox + 5, oy + 18, 3, 9, COLORS.lampPost);
  rect(ctx, ox + 24, oy + 18, 3, 9, COLORS.lampPost);
  // slatted seat + back
  for (let i = 0; i < 3; i += 1) {
    rect(ctx, ox + 3, oy + 16 + i * 3, 26, 2, mix(COLORS.benchWood, '#FFFFFF', 0.15 - i * 0.05));
  }
  for (let i = 0; i < 3; i += 1) {
    rect(ctx, ox + 3, oy + 5 + i * 3, 26, 2, mix(COLORS.benchWood, '#FFFFFF', 0.25 - i * 0.06));
  }
  rect(ctx, ox + 3, oy + 5, 2, 12, COLORS.lampPost);
  rect(ctx, ox + 27, oy + 5, 2, 12, COLORS.lampPost);
});

set(TILE_INDEX.lamp, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.plaza, mix(COLORS.plaza, '#FFFFFF', 0.3), COLORS.plazaAccent, COLORS.pavingSeam);
  shadowEllipse(ctx, ox + 16, oy + 29, 7, 2.5);
  // base + post
  rect(ctx, ox + 13, oy + 26, 6, 3, COLORS.lampPost);
  rect(ctx, ox + 15, oy + 6, 2, 21, COLORS.lampPost);
  rect(ctx, ox + 15, oy + 6, 1, 21, mix(COLORS.lampPost, '#FFFFFF', 0.35));
  // luminaire
  rect(ctx, ox + 11, oy + 3, 10, 4, COLORS.lampPost);
  const gradient = ctx.createLinearGradient(ox + 12, oy + 5, ox + 12, oy + 10);
  gradient.addColorStop(0, COLORS.lampGlow);
  gradient.addColorStop(1, mix(COLORS.lampGlow, '#000000', 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 12, oy + 6, 8, 4);
  // glow pool
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = COLORS.lampGlow;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 12, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.flowerbed, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 73);
  ctx.fillStyle = COLORS.soil;
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 18, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  grain(ctx, ox, oy, mix(COLORS.soil, '#000000', 0.3), 79, 26, 0.5);
  const rng = makeRng(89);
  const palette = [COLORS.flowerPink, COLORS.flowerYellow, COLORS.flowerWhite];
  for (let i = 0; i < 11; i += 1) {
    const x = ox + 4 + Math.floor(rng() * 24);
    const y = oy + 10 + Math.floor(rng() * 16);
    ctx.fillStyle = palette[Math.floor(rng() * palette.length)]!;
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    rect(ctx, x - 1, y - 1, 1, 1, '#FFFFFF');
    ctx.globalAlpha = 1;
  }
});

set(TILE_INDEX.bollard, (ctx, ox, oy) => {
  drawSlab(ctx, ox, oy, COLORS.paving, COLORS.pavingLight, COLORS.pavingDark, COLORS.pavingSeam);
  shadowEllipse(ctx, ox + 16, oy + 26, 6, 2.5);
  const gradient = ctx.createLinearGradient(ox + 12, oy, ox + 20, oy);
  gradient.addColorStop(0, mix(COLORS.steel, '#000000', 0.3));
  gradient.addColorStop(0.4, mix(COLORS.steel, '#FFFFFF', 0.4));
  gradient.addColorStop(1, COLORS.steel);
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 12, oy + 10, 8, 16);
  ctx.fillStyle = mix(COLORS.steel, '#FFFFFF', 0.3);
  ctx.beginPath();
  ctx.ellipse(ox + 16, oy + 10, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  rect(ctx, ox + 12, oy + 15, 8, 2, COLORS.hudAccent);
});

/** Draws the whole tileset into one texture, 8 columns x 4 rows. */
export function generateTileset(scene: Phaser.Scene): void {
  const width = T * TILESET_COLUMNS;
  const height = T * TILESET_ROWS;
  const texture = createCanvas(scene, ASSET_KEYS.tileset, width, height);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  for (let index = 0; index < TILE_COUNT; index += 1) {
    const ox = (index % TILESET_COLUMNS) * T;
    const oy = Math.floor(index / TILESET_COLUMNS) * T;
    const drawer = TILE_DRAWERS[index];
    if (drawer) drawer(ctx, ox, oy);
    else rect(ctx, ox, oy, T, T, COLORS.plazaAccent); // never expected
    texture.add(index, 0, ox, oy, T, T);
  }

  texture.refresh();
}

// ---------------------------------------------------------------------------
// Characters — 32x64
// ---------------------------------------------------------------------------

function drawCharacterFrame(
  ctx: Ctx,
  ox: number,
  oy: number,
  bodyColor: string,
  direction: keyof typeof CHAR_ROWS,
  step: -1 | 0 | 1,
) {
  const skin = COLORS.skin;
  const skinShade = mix(skin, '#000000', 0.18);
  const hair = mix(bodyColor, '#000000', 0.55);
  const shirt = bodyColor;
  const shirtShade = mix(bodyColor, '#000000', 0.28);
  const shirtLight = mix(bodyColor, '#FFFFFF', 0.22);
  const trousers = mix(bodyColor, '#2A2E36', 0.62);
  const trousersShade = mix(trousers, '#000000', 0.3);
  const shoe = '#2B2E33';
  const outline = 'rgba(20,22,26,0.55)';

  const cx = ox + 16;
  const groundY = oy + 61;

  shadowEllipse(ctx, cx, groundY + 1, 10, 3.2, 0.26);

  // --- legs (the step offset is the walk cycle) ---
  const legSwing = step * 2;
  const leftLegX = cx - 6 + legSwing;
  const rightLegX = cx + 1 - legSwing;
  rect(ctx, leftLegX, oy + 44, 5, 14, trousers);
  rect(ctx, rightLegX, oy + 44, 5, 14, trousersShade);
  rect(ctx, leftLegX, oy + 44, 1, 14, mix(trousers, '#FFFFFF', 0.18));
  // shoes
  rect(ctx, leftLegX - 1, oy + 57, 7, 4, shoe);
  rect(ctx, rightLegX - 1, oy + 57, 7, 4, mix(shoe, '#FFFFFF', 0.12));

  // --- torso ---
  rect(ctx, cx - 8, oy + 26, 16, 19, shirt);
  rect(ctx, cx + 3, oy + 26, 5, 19, shirtShade); // shaded right side
  rect(ctx, cx - 8, oy + 26, 3, 19, shirtLight); // lit left edge
  rect(ctx, cx - 8, oy + 43, 16, 2, shirtShade); // hem

  // --- arms, swinging opposite the legs ---
  const armSwing = -step;
  rect(ctx, cx - 11, oy + 28 + armSwing, 4, 15, shirtShade);
  rect(ctx, cx + 7, oy + 28 - armSwing, 4, 15, shirt);
  rect(ctx, cx - 11, oy + 42 + armSwing, 4, 4, skin); // hands
  rect(ctx, cx + 7, oy + 42 - armSwing, 4, 4, skin);

  // --- head ---
  rect(ctx, cx - 7, oy + 10, 14, 16, skin);
  rect(ctx, cx + 3, oy + 10, 4, 16, skinShade);
  rect(ctx, cx - 3, oy + 24, 6, 3, skinShade); // neck

  // hair varies by facing, which is most of the directional read
  if (direction === 'up') {
    rect(ctx, cx - 8, oy + 7, 16, 14, hair);
  } else {
    rect(ctx, cx - 8, oy + 7, 16, 7, hair);
    rect(ctx, cx - 8, oy + 7, 16, 2, mix(hair, '#FFFFFF', 0.22));
    if (direction === 'left') rect(ctx, cx - 8, oy + 7, 4, 13, hair);
    if (direction === 'right') rect(ctx, cx + 4, oy + 7, 4, 13, hair);
  }

  // eyes
  ctx.fillStyle = '#23262B';
  switch (direction) {
    case 'down':
      ctx.fillRect(cx - 5, oy + 17, 2, 3);
      ctx.fillRect(cx + 3, oy + 17, 2, 3);
      break;
    case 'left':
      ctx.fillRect(cx - 6, oy + 17, 2, 3);
      rect(ctx, cx - 9, oy + 18, 2, 3, skin); // nose
      break;
    case 'right':
      ctx.fillRect(cx + 4, oy + 17, 2, 3);
      rect(ctx, cx + 7, oy + 18, 2, 3, skin);
      break;
    case 'up':
      break;
  }

  // soft outline pass, which is what stops the sprite dissolving into the map
  ctx.save();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 8.5, oy + 6.5, 17, 20); // head
  ctx.strokeRect(cx - 8.5, oy + 25.5, 17, 20); // torso
  ctx.restore();
}

/** 4 directions x 4 frames. Frame index = row * 4 + column. */
export function generateCharacterSheet(scene: Phaser.Scene, key: string, bodyColor: string): void {
  const w = CHAR_FRAME_WIDTH * CHAR_FRAMES_PER_ROW;
  const h = CHAR_FRAME_HEIGHT * 4;
  const texture = createCanvas(scene, key, w, h);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const steps: Array<-1 | 0 | 1> = [0, -1, 0, 1];
  (Object.keys(CHAR_ROWS) as Array<keyof typeof CHAR_ROWS>).forEach((direction) => {
    const row = CHAR_ROWS[direction];
    for (let col = 0; col < CHAR_FRAMES_PER_ROW; col += 1) {
      const ox = col * CHAR_FRAME_WIDTH;
      const oy = row * CHAR_FRAME_HEIGHT;
      drawCharacterFrame(ctx, ox, oy, bodyColor, direction, steps[col] ?? 0);
      texture.add(row * CHAR_FRAMES_PER_ROW + col, 0, ox, oy, CHAR_FRAME_WIDTH, CHAR_FRAME_HEIGHT);
    }
  });

  texture.refresh();
}

// ---------------------------------------------------------------------------
// World objects & UI bits
// ---------------------------------------------------------------------------

export function generateObjectSprites(scene: Phaser.Scene): void {
  // Modern wayfinding sign, 32x48.
  {
    const texture = createCanvas(scene, ASSET_KEYS.signpost, 32, 48);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    shadowEllipse(ctx, 16, 46, 8, 2.5);
    // post
    rect(ctx, 14, 20, 4, 26, COLORS.steel);
    rect(ctx, 14, 20, 1, 26, mix(COLORS.steel, '#FFFFFF', 0.4));
    // panel
    const gradient = ctx.createLinearGradient(0, 4, 0, 22);
    gradient.addColorStop(0, mix(COLORS.storefront, '#FFFFFF', 0.15));
    gradient.addColorStop(1, COLORS.storefront);
    ctx.fillStyle = gradient;
    ctx.fillRect(2, 4, 28, 19);
    ctx.strokeStyle = mix(COLORS.steel, '#FFFFFF', 0.3);
    ctx.strokeRect(2.5, 4.5, 27, 18);
    rect(ctx, 4, 7, 4, 2, COLORS.hudAccent);
    for (let i = 0; i < 3; i += 1) rect(ctx, 10, 7 + i * 4, 16, 2, mix(COLORS.hudText, '#000000', 0.15));
    texture.refresh();
  }

  // Glass entrance, 32x48 — drawn taller than a tile so it reads as a doorway.
  {
    const texture = createCanvas(scene, ASSET_KEYS.door, 32, 48);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, 32, 48, mix(COLORS.concrete, '#000000', 0.1));
    rect(ctx, 2, 4, 28, 44, mix(COLORS.storefront, '#000000', 0.15));
    const gradient = ctx.createLinearGradient(4, 6, 28, 46);
    gradient.addColorStop(0, mix(COLORS.glassLight, '#FFFFFF', 0.35));
    gradient.addColorStop(1, COLORS.glass);
    ctx.fillStyle = gradient;
    ctx.fillRect(4, 6, 24, 42);
    rect(ctx, 15, 6, 2, 42, COLORS.steel);
    rect(ctx, 11, 26, 2, 8, mix(COLORS.steel, '#FFFFFF', 0.5));
    rect(ctx, 19, 26, 2, 8, mix(COLORS.steel, '#FFFFFF', 0.5));
    rect(ctx, 0, 0, 32, 5, COLORS.steel);
    rect(ctx, 0, 0, 32, 2, mix(COLORS.steel, '#FFFFFF', 0.35));
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(6, 47);
    ctx.lineTo(18, 6);
    ctx.lineTo(23, 6);
    ctx.lineTo(11, 47);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    texture.refresh();
  }

  // "!" interact bubble, 24x28.
  {
    const texture = createCanvas(scene, ASSET_KEYS.interactBubble, 24, 28);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    shadowEllipse(ctx, 12, 27, 6, 1.6, 0.3);
    ctx.fillStyle = COLORS.dialogueBoxBorder;
    ctx.beginPath();
    ctx.roundRect(0, 0, 24, 22, 6);
    ctx.fill();
    ctx.fillStyle = COLORS.interactBubbleBg;
    ctx.beginPath();
    ctx.roundRect(2, 2, 20, 18, 5);
    ctx.fill();
    // tail
    ctx.fillStyle = COLORS.dialogueBoxBorder;
    ctx.beginPath();
    ctx.moveTo(8, 20);
    ctx.lineTo(12, 27);
    ctx.lineTo(16, 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.interactBubbleBg;
    ctx.beginPath();
    ctx.moveTo(9.5, 19);
    ctx.lineTo(12, 24);
    ctx.lineTo(14.5, 19);
    ctx.closePath();
    ctx.fill();
    // mark
    rect(ctx, 10, 5, 4, 8, COLORS.interactBubbleMark);
    rect(ctx, 10, 15, 4, 3, COLORS.interactBubbleMark);
    texture.refresh();
  }

  // Soft drop shadow for standalone props.
  {
    const texture = createCanvas(scene, ASSET_KEYS.shadow, T, 12);
    const ctx = texture.getContext();
    shadowEllipse(ctx, T / 2, 6, 13, 5, 0.2);
    texture.refresh();
  }
}

/** Everything the game needs. One call from BootScene. */
export function generateAllPlaceholderArt(scene: Phaser.Scene): void {
  generateTileset(scene);
  generateCharacterSheet(scene, ASSET_KEYS.playerSheet, COLORS.playerBody);
  generateCharacterSheet(scene, ASSET_KEYS.remoteSheet, COLORS.remoteBody);
  generateCharacterSheet(scene, ASSET_KEYS.npcSheet, COLORS.npcBody);
  generateObjectSprites(scene);
}
