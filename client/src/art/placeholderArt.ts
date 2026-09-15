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
import type { HatStyle } from '@commons/shared';
import { DRINKS } from '@commons/shared';
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
  // Interactable props. Each is 32 wide and taller than a tile, drawn with its
  // feet on the tile it occupies.
  focusPod: 'obj_focus_pod',
  seat: 'obj_seat',
  readingNook: 'obj_reading_nook',
  jukebox: 'obj_jukebox',
  cabinet: 'obj_cabinet',
  cabinetLit: 'obj_cabinet_lit',
  desk: 'obj_desk',
  sharedTimer: 'obj_shared_timer',
  bandstand: 'obj_bandstand',
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
  // row 4 - interior floors
  woodFloor: 32,
  woodFloorDark: 33,
  carpet: 34,
  tileFloor: 35,
  tileFloorAlt: 36,
  arcadeFloor: 37,
  studyFloor: 38,
  stageFloor: 39,
  // row 5 - interior structure
  wallInterior: 40,
  wallSkirting: 41,
  windowInterior: 42,
  counterFront: 43,
  counterTop: 44,
  bookshelf: 45,
  shelfLow: 46,
  neonStrip: 47,
  // row 6 - park & misc
  pathDirt: 48,
  pond: 49,
  pondEdge: 50,
  picnicTable: 51,
  fence: 52,
  rug: 53,
  chalkboard: 54,
  kitchenTile: 55,
  // row 7 - rooftop terrace & greenhouse (Phase 6)
  roofDeck: 56,
  roofRail: 57,
  skyline: 58,
  stringLight: 59,
  glassWall: 60,
  soilBed: 61,
  fern: 62,
  gardenPath: 63,
} as const;

export const TILESET_COLUMNS = 8;
export const TILESET_ROWS = 8;
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

// ---- row 4: interior floors ----------------------------------------------

/** Plank flooring with a running bond, used across the Library and Study Rooms. */
/**
 * Floorboards.
 *
 * Rewritten in Phase 6. The first version drew a dark seam AND a bright
 * highlight across every 8px band plus a butt joint in the middle of each, so
 * at a glance every interior floor read as brickwork rather than boards. Boards
 * read as boards when the long axis is unbroken: the run-joints are now rare
 * and faint, the cross-seams are soft, and each board gets its own slight tone
 * so the eye follows the length of the plank instead of the grid.
 */
function drawPlanks(ctx: Ctx, ox: number, oy: number, base: string, offset: number) {
  const rng = makeRng(offset * 17 + 3);
  for (let i = 0; i < 4; i += 1) {
    const y = oy + i * 8;
    // per-board tone, which is most of what sells a real floor
    const tone = mix(base, i % 2 === 0 ? '#FFFFFF' : '#000000', 0.05 + rng() * 0.05);
    rect(ctx, ox, y, T, 8, tone);

    // grain along the board, never across it
    ctx.globalAlpha = 0.14;
    for (let g = 0; g < 3; g += 1) {
      const gy = y + 2 + Math.floor(rng() * 5);
      const gx = ox + Math.floor(rng() * 10);
      rect(ctx, gx, gy, 8 + Math.floor(rng() * 14), 1, mix(base, '#000000', 0.55));
    }
    ctx.globalAlpha = 1;

    // the seam between boards: one soft dark line, no bright counter-line
    ctx.globalAlpha = 0.5;
    rect(ctx, ox, y, T, 1, mix(base, '#000000', 0.3));
    ctx.globalAlpha = 1;
  }

  // A butt joint on ONE board per tile at most, so joints look scattered
  // through the room rather than ruled into every course.
  if (offset % 3 !== 0) {
    const jr = Math.floor(rng() * 4);
    ctx.globalAlpha = 0.45;
    rect(ctx, ox + (offset * 7) % (T - 2) + 1, oy + jr * 8 + 1, 1, 7, mix(base, '#000000', 0.4));
    ctx.globalAlpha = 1;
  }
}

set(TILE_INDEX.woodFloor, (ctx, ox, oy) =>
  drawPlanks(ctx, ox, oy, mix(COLORS.benchWood, '#D8B78A', 0.45), 6));
set(TILE_INDEX.woodFloorDark, (ctx, ox, oy) =>
  drawPlanks(ctx, ox, oy, mix(COLORS.benchWood, '#000000', 0.28), 18));

/**
 * Reading-room carpet.
 *
 * Was a desaturated version of the "listening" status blue, which across a
 * whole reading room read as standing water. Libraries carpet in warm reds and
 * greens for a reason — it is the one surface in the room meant to say "stop
 * walking, sit down".
 */
set(TILE_INDEX.carpet, (ctx, ox, oy) => {
  const base = COLORS.carpet;
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.1), base);

  // woven pile: short strokes in both directions, low contrast so it reads as
  // texture at a distance rather than noise
  const rng = makeRng(151);
  for (let i = 0; i < 90; i += 1) {
    ctx.globalAlpha = 0.05 + rng() * 0.09;
    ctx.fillStyle = rng() > 0.5 ? '#FFFFFF' : '#000000';
    const x = ox + Math.floor(rng() * T);
    const y = oy + Math.floor(rng() * T);
    if (rng() > 0.5) ctx.fillRect(x, y, 2, 1);
    else ctx.fillRect(x, y, 1, 2);
  }
  ctx.globalAlpha = 1;
});


// Low-contrast checker. A strong two-tone chequerboard at this tile size
// vibrates across a whole floor and fights everything standing on it.
/**
 * Cafe flooring.
 *
 * Both of these were high-contrast checkerboards. One checked tile is charming;
 * a whole room of them is a public toilet, and it fought with everything placed
 * on top. Terrazzo instead: a warm ground with fine aggregate and a quiet grout
 * line, which is what the modern-city art direction actually wants.
 */
function drawTerrazzo(ctx: Ctx, ox: number, oy: number, base: string, fleck: string, seed: number) {
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.08), base);

  const rng = makeRng(seed);
  for (let i = 0; i < 34; i += 1) {
    ctx.globalAlpha = 0.16 + rng() * 0.22;
    ctx.fillStyle = rng() > 0.45 ? fleck : mix(base, '#000000', 0.35);
    const w = 1 + Math.floor(rng() * 3);
    ctx.fillRect(ox + Math.floor(rng() * T), oy + Math.floor(rng() * T), w, 1 + Math.floor(rng() * 2));
  }
  ctx.globalAlpha = 1;

  // grout only on two edges, so a field of them reads as large-format slabs
  ctx.globalAlpha = 0.16;
  rect(ctx, ox, oy, T, 1, mix(base, '#000000', 0.45));
  rect(ctx, ox, oy, 1, T, mix(base, '#000000', 0.45));
  ctx.globalAlpha = 1;
}

set(TILE_INDEX.tileFloor, (ctx, ox, oy) =>
  drawTerrazzo(ctx, ox, oy, COLORS.terrazzo, COLORS.terrazzoFleck, 211));
set(TILE_INDEX.tileFloorAlt, (ctx, ox, oy) =>
  drawTerrazzo(ctx, ox, oy, COLORS.terrazzoWarm, COLORS.terrazzoFleck, 233));

set(TILE_INDEX.arcadeFloor, (ctx, ox, oy) => {
  const base = mix(COLORS.arcadeBg, '#000000', 0.55);
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.1), base);
  // neon grid, the arcade's whole visual identity
  ctx.globalAlpha = 0.5;
  rect(ctx, ox, oy, T, 1, COLORS.dialogueBoxAccent);
  rect(ctx, ox, oy, 1, T, COLORS.dialogueBoxAccent);
  ctx.globalAlpha = 0.16;
  rect(ctx, ox, oy + 1, T, 1, COLORS.dialogueBoxAccent);
  rect(ctx, ox + 1, oy, 1, T, COLORS.dialogueBoxAccent);
  ctx.globalAlpha = 1;
  grain(ctx, ox, oy, COLORS.interactBubbleMark, 163, 8, 0.18);
});

set(TILE_INDEX.studyFloor, (ctx, ox, oy) => {
  const base = mix(COLORS.concrete, COLORS.libraryBg, 0.35);
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.14), base);
  grain(ctx, ox, oy, mix(base, '#000000', 0.25), 173, 30, 0.16);
  ctx.globalAlpha = 0.3;
  rect(ctx, ox, oy, T, 1, mix(base, '#000000', 0.2));
  rect(ctx, ox, oy, 1, T, mix(base, '#000000', 0.2));
  ctx.globalAlpha = 1;
});

set(TILE_INDEX.stageFloor, (ctx, ox, oy) => {
  drawPlanks(ctx, ox, oy, mix(COLORS.benchWood, '#E0C39A', 0.55), 10);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = COLORS.lampGlow;
  ctx.fillRect(ox, oy, T, T);
  ctx.globalAlpha = 1;
});

// ---- row 5: interior structure -------------------------------------------

function drawInteriorWall(ctx: Ctx, ox: number, oy: number, skirting: boolean) {
  const base = mix(COLORS.concreteLight, COLORS.libraryBg, 0.2);
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.2), base);
  grain(ctx, ox, oy, mix(base, '#000000', 0.15), 181, 20, 0.14);
  rect(ctx, ox, oy, T, 2, mix(base, '#FFFFFF', 0.4));
  if (skirting) {
    rect(ctx, ox, oy + T - 7, T, 7, mix(COLORS.benchWood, '#000000', 0.2));
    rect(ctx, ox, oy + T - 7, T, 1, mix(COLORS.benchWood, '#FFFFFF', 0.35));
  }
}

set(TILE_INDEX.wallInterior, (ctx, ox, oy) => drawInteriorWall(ctx, ox, oy, false));
set(TILE_INDEX.wallSkirting, (ctx, ox, oy) => drawInteriorWall(ctx, ox, oy, true));

set(TILE_INDEX.windowInterior, (ctx, ox, oy) => {
  drawInteriorWall(ctx, ox, oy, false);
  rect(ctx, ox + 2, oy + 4, T - 4, T - 12, mix(COLORS.benchWood, '#000000', 0.15));
  // daylight beyond
  const gradient = ctx.createLinearGradient(ox, oy + 6, ox, oy + T - 10);
  gradient.addColorStop(0, mix(COLORS.glassLight, '#FFFFFF', 0.55));
  gradient.addColorStop(1, mix(COLORS.grassLight, '#FFFFFF', 0.3));
  ctx.fillStyle = gradient;
  ctx.fillRect(ox + 4, oy + 6, T - 8, T - 16);
  rect(ctx, ox + 15, oy + 6, 2, T - 16, mix(COLORS.benchWood, '#000000', 0.2));
  rect(ctx, ox + 4, oy + 14, T - 8, 1, mix(COLORS.benchWood, '#000000', 0.2));
  rect(ctx, ox + 2, oy + T - 9, T - 4, 3, mix(COLORS.benchWood, '#FFFFFF', 0.25));
});

set(TILE_INDEX.counterFront, (ctx, ox, oy) => {
  const wood = mix(COLORS.benchWood, '#000000', 0.15);
  vGradient(ctx, ox, oy, mix(wood, '#FFFFFF', 0.2), wood);
  for (let i = 0; i < 2; i += 1) {
    const px = ox + 3 + i * 14;
    ctx.globalAlpha = 0.35;
    rect(ctx, px, oy + 6, 12, T - 12, mix(wood, '#000000', 0.35));
    ctx.globalAlpha = 0.5;
    rect(ctx, px, oy + 6, 12, 1, mix(wood, '#FFFFFF', 0.4));
    ctx.globalAlpha = 1;
  }
  rect(ctx, ox, oy, T, 3, mix(wood, '#FFFFFF', 0.45));
});

set(TILE_INDEX.counterTop, (ctx, ox, oy) => {
  const stone = mix(COLORS.concreteDark, '#000000', 0.15);
  vGradient(ctx, ox, oy, mix(stone, '#FFFFFF', 0.35), stone);
  grain(ctx, ox, oy, mix(stone, '#FFFFFF', 0.5), 191, 22, 0.3);
  rect(ctx, ox, oy, T, 2, mix(stone, '#FFFFFF', 0.55));
  rect(ctx, ox, oy + T - 3, T, 3, mix(stone, '#000000', 0.4));
});

set(TILE_INDEX.bookshelf, (ctx, ox, oy) => {
  const wood = mix(COLORS.benchWood, '#000000', 0.35);
  vGradient(ctx, ox, oy, mix(wood, '#FFFFFF', 0.15), wood);
  const spines = [
    COLORS.interactBubbleMark, COLORS.statusListening, COLORS.statusStudying,
    COLORS.flowerYellow, COLORS.npcBody, COLORS.remoteBody,
  ];
  const rng = makeRng(199);
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const sy = oy + 2 + shelf * 10;
    let x = ox + 2;
    while (x < ox + T - 3) {
      const w = 2 + Math.floor(rng() * 3);
      const h = 6 + Math.floor(rng() * 2);
      ctx.fillStyle = spines[Math.floor(rng() * spines.length)]!;
      ctx.fillRect(x, sy + (8 - h), w, h);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, sy + (8 - h), 1, h);
      ctx.globalAlpha = 1;
      x += w + 1;
    }
    rect(ctx, ox, sy + 8, T, 2, mix(wood, '#FFFFFF', 0.3));
  }
  rect(ctx, ox, oy, 2, T, mix(wood, '#FFFFFF', 0.2));
  rect(ctx, ox + T - 2, oy, 2, T, mix(wood, '#000000', 0.3));
});

set(TILE_INDEX.shelfLow, (ctx, ox, oy) => {
  const wood = mix(COLORS.benchWood, '#000000', 0.2);
  vGradient(ctx, ox, oy, mix(COLORS.libraryBg, '#FFFFFF', 0.3), mix(COLORS.libraryBg, '#FFFFFF', 0.1));
  shadowEllipse(ctx, ox + 16, oy + 29, 13, 3);
  rect(ctx, ox, oy + 12, T, 17, wood);
  rect(ctx, ox, oy + 12, T, 2, mix(wood, '#FFFFFF', 0.4));
  const spines = [COLORS.interactBubbleMark, COLORS.statusStudying, COLORS.flowerYellow];
  const rng = makeRng(211);
  let x = ox + 2;
  while (x < ox + T - 3) {
    const w = 2 + Math.floor(rng() * 3);
    ctx.fillStyle = spines[Math.floor(rng() * spines.length)]!;
    ctx.fillRect(x, oy + 16, w, 7);
    x += w + 1;
  }
  rect(ctx, ox, oy + 23, T, 2, mix(wood, '#FFFFFF', 0.25));
});

set(TILE_INDEX.neonStrip, (ctx, ox, oy) => {
  const base = mix(COLORS.arcadeBg, '#000000', 0.4);
  vGradient(ctx, ox, oy, base, mix(base, '#000000', 0.35));
  // glowing tube with falloff
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = COLORS.interactBubbleMark;
  ctx.fillRect(ox, oy + 8, T, 16);
  ctx.globalAlpha = 0.6;
  ctx.fillRect(ox, oy + 13, T, 6);
  ctx.globalAlpha = 1;
  rect(ctx, ox, oy + 15, T, 2, mix(COLORS.interactBubbleMark, '#FFFFFF', 0.7));
});

// ---- row 6: park & misc ---------------------------------------------------

set(TILE_INDEX.pathDirt, (ctx, ox, oy) => {
  const base = mix(COLORS.soil, COLORS.paving, 0.45);
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.15), base);
  grain(ctx, ox, oy, mix(base, '#000000', 0.3), 223, 44, 0.35);
  grain(ctx, ox, oy, mix(base, '#FFFFFF', 0.35), 227, 26, 0.3);
});

set(TILE_INDEX.pond, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.water, COLORS.foliage, 0.25), COLORS.waterDeep);
  const rng = makeRng(229);
  ctx.globalAlpha = 0.2;
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = COLORS.waterLight;
    ctx.beginPath();
    ctx.ellipse(ox + rng() * T, oy + rng() * T, 6 + rng() * 7, 3 + rng() * 3, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // No lily pad here on purpose: every pond tile draws the same texture, so a
  // distinctive feature repeats on a perfect grid and the water reads as
  // wallpaper. Distinct features belong in the map as objects, not in the tile.
});

set(TILE_INDEX.pondEdge, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 233);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = mix(COLORS.soil, COLORS.grassDark, 0.4);
  ctx.fillRect(ox, oy + 20, T, 12);
  ctx.globalAlpha = 1;
  const rng = makeRng(239);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = COLORS.pavingDark;
    ctx.beginPath();
    ctx.ellipse(ox + rng() * T, oy + 24 + rng() * 6, 2 + rng() * 2, 1.5 + rng(), 0, 0, Math.PI * 2);
    ctx.fill();
  }
});

set(TILE_INDEX.picnicTable, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 241);
  shadowEllipse(ctx, ox + 16, oy + 28, 14, 3.5);
  const wood = COLORS.benchWood;
  rect(ctx, ox + 1, oy + 20, T - 2, 4, mix(wood, '#000000', 0.25));
  rect(ctx, ox + 1, oy + 8, T - 2, 4, mix(wood, '#000000', 0.25));
  rect(ctx, ox + 3, oy + 12, T - 6, 8, mix(wood, '#FFFFFF', 0.2));
  rect(ctx, ox + 3, oy + 12, T - 6, 1, mix(wood, '#FFFFFF', 0.5));
  for (let i = 0; i < 3; i += 1) rect(ctx, ox + 5 + i * 8, oy + 13, 1, 6, mix(wood, '#000000', 0.3));
  rect(ctx, ox + 7, oy + 20, 2, 6, mix(wood, '#000000', 0.4));
  rect(ctx, ox + 23, oy + 20, 2, 6, mix(wood, '#000000', 0.4));
});

set(TILE_INDEX.fence, (ctx, ox, oy) => {
  drawGrassBase(ctx, ox, oy, 251);
  const wood = mix(COLORS.benchWood, '#FFFFFF', 0.1);
  rect(ctx, ox, oy + 10, T, 3, wood);
  rect(ctx, ox, oy + 18, T, 3, wood);
  rect(ctx, ox, oy + 10, T, 1, mix(wood, '#FFFFFF', 0.4));
  rect(ctx, ox + 4, oy + 6, 4, 22, mix(wood, '#000000', 0.2));
  rect(ctx, ox + 24, oy + 6, 4, 22, mix(wood, '#000000', 0.2));
  rect(ctx, ox + 4, oy + 6, 1, 22, mix(wood, '#FFFFFF', 0.3));
});

/**
 * Patterned rug.
 *
 * The old one drew a border on EVERY tile, so a rug more than one tile across
 * became a grid of small brown boxes — which is what a multi-tile rug looked
 * like in the library: a stack of crates. This version is a continuous field
 * pattern with no per-tile frame, so tiling it reads as one large rug.
 */
set(TILE_INDEX.rug, (ctx, ox, oy) => {
  const base = COLORS.rugBase;
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.1), base);

  // diamond lattice, aligned to the tile grid so neighbours line up
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = COLORS.rugPattern;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy + 16);
  ctx.lineTo(ox + 16, oy);
  ctx.lineTo(ox + T, oy + 16);
  ctx.lineTo(ox + 16, oy + T);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  rect(ctx, ox + 15, oy + 15, 2, 2, COLORS.rugPattern);
  grain(ctx, ox, oy, mix(base, '#000000', 0.4), 61, 22, 0.13);
});

set(TILE_INDEX.chalkboard, (ctx, ox, oy) => {
  drawInteriorWall(ctx, ox, oy, false);
  const board = mix(COLORS.statusStudying, '#000000', 0.55);
  rect(ctx, ox + 2, oy + 3, T - 4, T - 12, mix(COLORS.benchWood, '#000000', 0.2));
  rect(ctx, ox + 4, oy + 5, T - 8, T - 16, board);
  ctx.globalAlpha = 0.55;
  rect(ctx, ox + 7, oy + 9, 14, 1, '#FFFFFF');
  rect(ctx, ox + 7, oy + 13, 18, 1, '#FFFFFF');
  rect(ctx, ox + 7, oy + 17, 10, 1, '#FFFFFF');
  ctx.globalAlpha = 1;
  rect(ctx, ox + 2, oy + T - 9, T - 4, 3, mix(COLORS.benchWood, '#FFFFFF', 0.2));
});

set(TILE_INDEX.kitchenTile, (ctx, ox, oy) => {
  const base = mix(COLORS.concreteLight, '#FFFFFF', 0.3);
  vGradient(ctx, ox, oy, mix(base, '#FFFFFF', 0.2), base);
  for (let ty = 0; ty < 4; ty += 1) {
    for (let tx = 0; tx < 4; tx += 1) {
      ctx.globalAlpha = 0.22;
      rect(ctx, ox + tx * 8, oy + ty * 8, 8, 1, COLORS.concreteDark);
      rect(ctx, ox + tx * 8, oy + ty * 8, 1, 8, COLORS.concreteDark);
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = COLORS.cafeBg;
  ctx.fillRect(ox, oy, T, T);
  ctx.globalAlpha = 1;
});


// ---- row 7: rooftop terrace & greenhouse (Phase 6) ------------------------

/** Composite decking. Warmer and narrower than the park's boardwalk. */
set(TILE_INDEX.roofDeck, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.decking, '#FFFFFF', 0.16), COLORS.decking);
  for (let i = 0; i < 4; i += 1) {
    const y = oy + i * 8;
    rect(ctx, ox, y, T, 1, mix(COLORS.decking, '#000000', 0.3));
    rect(ctx, ox, y + 1, T, 1, mix(COLORS.decking, '#FFFFFF', 0.22));
  }
  grain(ctx, ox, oy, mix(COLORS.decking, '#000000', 0.35), 71, 14, 0.16);
});

/**
 * Glass balustrade. Blocking, but drawn low and mostly transparent so it reads
 * as an edge you cannot cross rather than a wall that hides the view.
 */
set(TILE_INDEX.roofRail, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.decking, '#FFFFFF', 0.16), COLORS.decking);
  ctx.globalAlpha = 0.5;
  rect(ctx, ox, oy + 8, T, 18, COLORS.railGlass);
  ctx.globalAlpha = 1;
  rect(ctx, ox, oy + 7, T, 2, COLORS.steel);
  rect(ctx, ox, oy + 7, T, 1, mix(COLORS.steel, '#FFFFFF', 0.45));
  rect(ctx, ox, oy + 25, T, 2, mix(COLORS.steel, '#000000', 0.25));
  for (const px of [ox + 2, ox + T - 4]) {
    rect(ctx, px, oy + 8, 2, 18, COLORS.steel);
  }
  ctx.globalAlpha = 0.35;
  rect(ctx, ox + 4, oy + 10, T - 10, 2, '#FFFFFF');
  ctx.globalAlpha = 1;
});

/** The city at dusk, seen past the rail. Decorative and blocking. */
set(TILE_INDEX.skyline, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, COLORS.duskSkyTop, COLORS.duskSkyLow);

  const rng = makeRng(ox * 31 + 5);
  // Far towers first, then near ones, so the city has depth rather than
  // being one flat silhouette.
  for (const [color, minTop, maxTop, width] of [
    [COLORS.skylineFar, 6, 16, 7],
    [COLORS.skylineNear, 12, 22, 9],
  ] as const) {
    let x = ox - Math.floor(rng() * width);
    while (x < ox + T) {
      const top = oy + minTop + Math.floor(rng() * (maxTop - minTop));
      const w = 4 + Math.floor(rng() * width);
      ctx.fillStyle = color;
      ctx.fillRect(Math.max(x, ox), top, Math.min(w, ox + T - x), oy + T - top);

      // lit windows
      for (let wy = top + 3; wy < oy + T - 2; wy += 5) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (wx < ox || wx > ox + T - 2) continue;
          if (rng() > 0.62) rect(ctx, wx, wy, 2, 2, COLORS.windowWarm);
        }
      }
      x += w + 1 + Math.floor(rng() * 3);
    }
  }
});

/** Festoon bulbs strung overhead. Walkable — you pass underneath them. */
set(TILE_INDEX.stringLight, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.decking, '#FFFFFF', 0.16), COLORS.decking);
  for (let i = 0; i < 4; i += 1) {
    rect(ctx, ox, oy + i * 8, T, 1, mix(COLORS.decking, '#000000', 0.3));
  }
  // the wire sags across the tile
  ctx.strokeStyle = mix(COLORS.steel, '#000000', 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy + 5.5);
  ctx.quadraticCurveTo(ox + T / 2, oy + 11.5, ox + T, oy + 5.5);
  ctx.stroke();

  for (const [bx, by] of [[6, 8], [16, 10], [26, 8]] as const) {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = COLORS.lampGlow;
    ctx.beginPath();
    ctx.arc(ox + bx, oy + by, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    rect(ctx, ox + bx - 1, oy + by - 1, 3, 3, COLORS.lampGlow);
    rect(ctx, ox + bx - 1, oy + by - 1, 1, 1, '#FFFFFF');
  }
});

/** Greenhouse glazing: a steel frame holding panes. Blocking. */
set(TILE_INDEX.glassWall, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.glassPane, '#FFFFFF', 0.35), COLORS.glassPane);
  // condensation
  grain(ctx, ox, oy, '#FFFFFF', 23, 18, 0.3);
  // frame
  rect(ctx, ox, oy, T, 2, COLORS.glassFrame);
  rect(ctx, ox, oy + T - 2, T, 2, COLORS.glassFrame);
  rect(ctx, ox + 15, oy, 2, T, COLORS.glassFrame);
  rect(ctx, ox, oy + 15, T, 1, mix(COLORS.glassFrame, '#FFFFFF', 0.2));
  // a diagonal highlight, which is what makes glass read as glass
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ox + 3, oy + T - 4);
  ctx.lineTo(ox + T - 6, oy + 3);
  ctx.stroke();
  ctx.globalAlpha = 1;
});

/** A raised planting bed with seedlings. Blocking. */
set(TILE_INDEX.soilBed, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, mix(COLORS.soilBed, '#FFFFFF', 0.18), COLORS.soilBed);
  grain(ctx, ox, oy, mix(COLORS.soilBed, '#000000', 0.4), 41, 26, 0.5);
  // timber edging
  rect(ctx, ox, oy, T, 3, COLORS.benchWood);
  rect(ctx, ox, oy, T, 1, mix(COLORS.benchWood, '#FFFFFF', 0.3));
  rect(ctx, ox, oy + T - 3, T, 3, mix(COLORS.benchWood, '#000000', 0.25));
  // seedlings
  const rng = makeRng(53);
  for (let i = 0; i < 7; i += 1) {
    const sx = ox + 4 + Math.floor(rng() * (T - 8));
    const sy = oy + 8 + Math.floor(rng() * 14);
    rect(ctx, sx, sy, 1, 4, COLORS.foliageDark);
    rect(ctx, sx - 2, sy, 2, 1, COLORS.foliage);
    rect(ctx, sx + 1, sy + 1, 2, 1, COLORS.fernLight);
  }
});

/** A big leafy fern. Blocking. */
set(TILE_INDEX.fern, (ctx, ox, oy) => {
  rect(ctx, ox, oy, T, T, '#B9B2A4');
  grain(ctx, ox, oy, '#A39B8C', 29, 20, 0.4);
  shadowEllipse(ctx, ox + 16, oy + 27, 10, 3);

  // terracotta pot
  rect(ctx, ox + 10, oy + 20, 12, 8, '#A85F3E');
  rect(ctx, ox + 10, oy + 20, 12, 2, mix('#A85F3E', '#FFFFFF', 0.3));
  rect(ctx, ox + 10, oy + 26, 12, 2, mix('#A85F3E', '#000000', 0.3));

  // fronds, drawn as tapering strokes from the crown outward
  const crownX = ox + 16;
  const crownY = oy + 20;
  const fronds: Array<[number, number, string]> = [
    [-11, -8, COLORS.foliageDark],
    [-6, -14, COLORS.foliage],
    [0, -17, COLORS.fernLight],
    [6, -14, COLORS.foliage],
    [11, -8, COLORS.foliageDark],
  ];
  for (const [dx, dy, color] of fronds) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(crownX, crownY);
    ctx.quadraticCurveTo(crownX + dx * 0.5, crownY + dy * 0.5, crownX + dx, crownY + dy);
    ctx.stroke();
    rect(ctx, crownX + dx - 1, crownY + dy - 1, 3, 3, color);
  }
});

/** Stone path between the beds. Walkable. */
set(TILE_INDEX.gardenPath, (ctx, ox, oy) => {
  vGradient(ctx, ox, oy, '#C2BBAC', '#ADA595');
  const rng = makeRng(37);
  // irregular flags, so it does not read as a grid inside a grid
  for (let i = 0; i < 5; i += 1) {
    const px = ox + 2 + Math.floor(rng() * 20);
    const py = oy + 2 + Math.floor(rng() * 20);
    const w = 6 + Math.floor(rng() * 7);
    const h = 5 + Math.floor(rng() * 6);
    rect(ctx, px, py, Math.min(w, ox + T - px - 1), Math.min(h, oy + T - py - 1), '#CFC8B9');
    rect(ctx, px, py, Math.min(w, ox + T - px - 1), 1, '#DED7C8');
  }
  grain(ctx, ox, oy, '#8F887A', 19, 16, 0.28);
});


// ---------------------------------------------------------------------------
// Cafe drinks (03) — one small sprite per entry in shared/drinks.ts
// ---------------------------------------------------------------------------

export function drinkTextureKey(id: string): string {
  return `drink_${id}`;
}

/**
 * A mug per drink, drawn small because it sits above a nameplate.
 *
 * Read at roughly 20px tall, so the silhouette does the work: everything is a
 * white ceramic mug and only the liquid, the foam and the steam change. That
 * makes an unfamiliar drink still legible as "someone is holding a drink",
 * which is the part that matters socially.
 */
export function generateDrinkSprites(scene: Phaser.Scene): void {
  for (const drink of DRINKS) {
    const key = drinkTextureKey(drink.id);
    const texture = createCanvas(scene, key, 20, 24);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;

    const ceramic = '#F2EFE9';
    const ceramicShade = mix(ceramic, '#000000', 0.18);

    // steam, above the cup
    ctx.globalAlpha = 0.45;
    for (const [sx, sy] of [[7, 1], [11, 0]] as const) {
      rect(ctx, sx, sy + 1, 1, 2, '#FFFFFF');
      rect(ctx, sx + 1, sy + 3, 1, 2, '#FFFFFF');
    }
    ctx.globalAlpha = 1;

    // saucer
    rect(ctx, 2, 21, 16, 2, ceramicShade);
    rect(ctx, 3, 20, 14, 1, ceramic);

    // handle, behind the body so the body's edge overlaps it cleanly
    rect(ctx, 15, 11, 3, 2, ceramicShade);
    rect(ctx, 17, 12, 2, 4, ceramicShade);
    rect(ctx, 15, 15, 3, 2, ceramicShade);

    // body
    rect(ctx, 4, 8, 12, 13, ceramic);
    rect(ctx, 12, 8, 4, 13, ceramicShade);
    rect(ctx, 4, 8, 2, 13, mix(ceramic, '#FFFFFF', 0.6));

    // liquid, and foam on top of it where the drink has a head
    rect(ctx, 5, 9, 10, 3, drink.color);
    rect(ctx, 5, 9, 10, 1, mix(drink.color, '#FFFFFF', 0.35));
    if (drink.foam) {
      rect(ctx, 5, 9, 10, 2, mix(drink.color, '#FFFFFF', 0.72));
      rect(ctx, 7, 9, 5, 1, '#FFFFFF');
    }

    // rim, drawn last so it reads as the near edge of the cup
    rect(ctx, 4, 8, 12, 1, mix(ceramic, '#FFFFFF', 0.8));
    texture.refresh();
  }
}

/** Draws the whole tileset into one texture, 8 columns x 8 rows. */
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


/**
 * A hat, drawn over the hair.
 *
 * Sits entirely above the eye row (oy+17) in every direction so it can never
 * obscure the facing cue — the direction a character is looking is load-bearing
 * information in a grid game, and no cosmetic is allowed to cost the player
 * that. Facing "up" is the back of the head, so peaks and near-side ear cups
 * disappear there rather than being drawn on the wrong side of the skull.
 */
function drawHat(
  ctx: Ctx,
  cx: number,
  oy: number,
  color: string,
  style: HatStyle,
  direction: keyof typeof CHAR_ROWS,
) {
  const light = mix(color, '#FFFFFF', 0.3);
  const dark = mix(color, '#000000', 0.35);

  switch (style) {
    case 'cap': {
      rect(ctx, cx - 8, oy + 4, 16, 7, color);
      rect(ctx, cx - 8, oy + 4, 16, 2, light);
      rect(ctx, cx - 8, oy + 9, 16, 2, dark);
      // The peak follows the facing, which is what makes it read as worn. It
      // overhangs the head by a pixel on each side: a brim flush with the skull
      // just reads as a coloured band.
      if (direction === 'down') rect(ctx, cx - 9, oy + 11, 18, 2, dark);
      if (direction === 'left') rect(ctx, cx - 14, oy + 9, 7, 2, dark);
      if (direction === 'right') rect(ctx, cx + 7, oy + 9, 7, 2, dark);
      break;
    }
    case 'beanie': {
      // Nothing here may be drawn above oy: frames are stacked in one sheet, so
      // a bobble at oy-1 bleeds into the bottom of the frame ABOVE it — which
      // showed up as a blue speck at the feet of the facing-down walk cycle.
      rect(ctx, cx - 2, oy, 4, 3, light);
      rect(ctx, cx - 6, oy + 2, 12, 3, color);
      rect(ctx, cx - 6, oy + 2, 12, 1, light);
      rect(ctx, cx - 8, oy + 4, 16, 8, color);
      // Folded brim, a shade lighter so the fold reads at this size.
      rect(ctx, cx - 8, oy + 10, 16, 3, light);
      rect(ctx, cx - 8, oy + 12, 16, 1, dark);
      break;
    }
    case 'headphones': {
      // Hair stays visible: these are worn, not a hat.
      rect(ctx, cx - 7, oy + 3, 14, 3, color);
      rect(ctx, cx - 7, oy + 3, 14, 1, light);
      rect(ctx, cx - 8, oy + 5, 2, 4, dark);
      rect(ctx, cx + 6, oy + 5, 2, 4, dark);

      const cup = (x: number) => {
        rect(ctx, x, oy + 8, 4, 7, color);
        rect(ctx, x, oy + 8, 1, 7, light);
        rect(ctx, x, oy + 14, 4, 1, dark);
      };
      if (direction !== 'right') cup(cx - 11);
      if (direction !== 'left') cup(cx + 7);
      break;
    }
  }
}

/**
 * The colours one character is built from, derived from its body colour.
 *
 * Exported because Focus Mode draws the SAME character seated at a desk, from
 * tweenable parts rather than a walk frame. Two independent derivations of
 * "what colour is this person's hair" would drift the moment either is touched,
 * and the player would notice their avatar changing shade when they sat down.
 */
export function characterPalette(bodyColor: string) {
  return {
    skin: COLORS.skin,
    skinShade: mix(COLORS.skin, '#000000', 0.18),
    hair: mix(bodyColor, '#000000', 0.55),
    hairLight: mix(mix(bodyColor, '#000000', 0.55), '#FFFFFF', 0.22),
    shirt: bodyColor,
    shirtShade: mix(bodyColor, '#000000', 0.28),
    shirtLight: mix(bodyColor, '#FFFFFF', 0.22),
    trousers: mix(bodyColor, '#2A2E36', 0.62),
    trousersShade: mix(mix(bodyColor, '#2A2E36', 0.62), '#000000', 0.3),
    shoe: '#2B2E33',
    eye: '#23262B',
    outline: 'rgba(20,22,26,0.55)',
  };
}

/** Pixel helpers, shared with the Focus Mode art so both draw the same way. */
export const paint = { rect, shadowEllipse, createCanvas };

function drawCharacterFrame(
  ctx: Ctx,
  ox: number,
  oy: number,
  bodyColor: string,
  direction: keyof typeof CHAR_ROWS,
  step: -1 | 0 | 1,
  hat?: HatPaint,
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

  if (hat) drawHat(ctx, cx, oy, hat.color, hat.style, direction);

  // soft outline pass, which is what stops the sprite dissolving into the map
  ctx.save();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 8.5, oy + 6.5, 17, 20); // head
  ctx.strokeRect(cx - 8.5, oy + 25.5, 17, 20); // torso
  ctx.restore();
}

/** What a character is wearing on its head, if anything. */
export interface HatPaint {
  color: string;
  style: HatStyle;
}

/** 4 directions x 4 frames. Frame index = row * 4 + column. */
export function generateCharacterSheet(
  scene: Phaser.Scene,
  key: string,
  bodyColor: string,
  hat?: HatPaint,
): void {
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
      drawCharacterFrame(ctx, ox, oy, bodyColor, direction, steps[col] ?? 0, hat);
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

/**
 * Interactable props.
 *
 * Drawn 32x48 (or 32x56) rather than a flat tile so they have visible height —
 * a focus pod you can see the chair and monitor of reads as somewhere to sit,
 * where a coloured square does not.
 */
export function generateInteractableSprites(scene: Phaser.Scene): void {
  const prop = (key: string, height: number, draw: (ctx: Ctx) => void) => {
    const texture = createCanvas(scene, key, T, height);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    texture.refresh();
  };

  // --- focus pod: desk, monitor, task lamp, chair ---
  prop(ASSET_KEYS.focusPod, 48, (ctx) => {
    shadowEllipse(ctx, 16, 46, 13, 3.5);
    const wood = mix(COLORS.benchWood, '#000000', 0.1);
    // privacy screen
    rect(ctx, 2, 4, 28, 16, mix(COLORS.statusListening, '#000000', 0.35));
    rect(ctx, 2, 4, 28, 2, mix(COLORS.statusListening, '#FFFFFF', 0.25));
    // desk top + legs
    rect(ctx, 1, 22, 30, 6, mix(wood, '#FFFFFF', 0.25));
    rect(ctx, 1, 22, 30, 1, mix(wood, '#FFFFFF', 0.55));
    rect(ctx, 3, 28, 3, 14, mix(wood, '#000000', 0.3));
    rect(ctx, 26, 28, 3, 14, mix(wood, '#000000', 0.3));
    // monitor
    rect(ctx, 9, 8, 14, 11, COLORS.storefront);
    rect(ctx, 10, 9, 12, 9, mix(COLORS.glassLight, '#000000', 0.15));
    ctx.globalAlpha = 0.5;
    rect(ctx, 11, 10, 4, 7, '#FFFFFF');
    ctx.globalAlpha = 1;
    rect(ctx, 14, 19, 4, 3, COLORS.steel);
    // task lamp
    rect(ctx, 25, 12, 2, 10, COLORS.lampPost);
    rect(ctx, 23, 9, 6, 3, COLORS.lampPost);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = COLORS.lampGlow;
    ctx.beginPath();
    ctx.ellipse(26, 20, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // chair back
    rect(ctx, 11, 30, 10, 10, mix(COLORS.statusListening, '#000000', 0.2));
    rect(ctx, 11, 30, 10, 2, mix(COLORS.statusListening, '#FFFFFF', 0.3));
  });

  // --- cafe seat: small round table with a chair ---
  /**
   * A chair.
   *
   * Redrawn in Phase 6. The old one put a small white cup on top, which was the
   * brightest thing on the sprite — at the zoom the game actually runs at, a
   * row of seats read as a row of mugs. The cup is also now a real feature that
   * appears over a player's head, so a painted-on one was actively misleading.
   * This is just a chair, with a taller back so the silhouette carries.
   */
  prop(ASSET_KEYS.seat, 48, (ctx) => {
    shadowEllipse(ctx, 16, 45, 12, 3.5);
    const wood = COLORS.benchWood;
    const dark = mix(wood, '#000000', 0.35);

    // back, with two spindles so it does not read as a solid block
    rect(ctx, 8, 8, 16, 3, mix(wood, '#FFFFFF', 0.28));
    rect(ctx, 8, 11, 3, 14, mix(wood, '#000000', 0.2));
    rect(ctx, 21, 11, 3, 14, mix(wood, '#000000', 0.2));
    rect(ctx, 13, 12, 2, 12, mix(wood, '#000000', 0.1));
    rect(ctx, 17, 12, 2, 12, mix(wood, '#000000', 0.1));

    // seat pad, slightly wider than the back so it reads in perspective
    rect(ctx, 6, 25, 20, 7, mix(wood, '#FFFFFF', 0.12));
    rect(ctx, 6, 25, 20, 2, mix(wood, '#FFFFFF', 0.42));
    rect(ctx, 6, 30, 20, 2, dark);

    // legs
    rect(ctx, 8, 32, 3, 10, dark);
    rect(ctx, 21, 32, 3, 10, dark);
    rect(ctx, 8, 38, 16, 2, mix(dark, '#FFFFFF', 0.15));
  });

  // --- reading nook: armchair and a floor lamp ---
  prop(ASSET_KEYS.readingNook, 52, (ctx) => {
    shadowEllipse(ctx, 15, 50, 14, 4);
    const fabric = mix(COLORS.interactBubbleMark, '#000000', 0.3);
    // floor lamp
    rect(ctx, 27, 12, 2, 32, COLORS.lampPost);
    rect(ctx, 24, 44, 8, 3, COLORS.lampPost);
    rect(ctx, 23, 5, 10, 8, mix(COLORS.lampGlow, '#8A6A2A', 0.35));
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = COLORS.lampGlow;
    ctx.beginPath();
    ctx.ellipse(28, 18, 12, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // armchair
    rect(ctx, 2, 16, 20, 18, fabric);
    rect(ctx, 2, 16, 20, 2, mix(fabric, '#FFFFFF', 0.3));
    rect(ctx, 0, 22, 5, 16, mix(fabric, '#000000', 0.25));
    rect(ctx, 19, 22, 5, 16, mix(fabric, '#000000', 0.25));
    rect(ctx, 3, 34, 18, 6, mix(fabric, '#FFFFFF', 0.12));
    rect(ctx, 5, 40, 3, 8, mix(COLORS.benchWood, '#000000', 0.3));
    rect(ctx, 16, 40, 3, 8, mix(COLORS.benchWood, '#000000', 0.3));
    // open book on the seat
    rect(ctx, 8, 32, 9, 4, COLORS.dialogueBoxBg);
    rect(ctx, 12, 32, 1, 4, COLORS.pavingDark);
  });

  // --- jukebox ---
  prop(ASSET_KEYS.jukebox, 52, (ctx) => {
    shadowEllipse(ctx, 16, 50, 12, 3.5);
    const body = mix(COLORS.benchWood, '#6B2F2F', 0.45);
    // domed cabinet
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(4, 48);
    ctx.lineTo(4, 16);
    ctx.quadraticCurveTo(16, 2, 28, 16);
    ctx.lineTo(28, 48);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mix(body, '#000000', 0.4);
    ctx.stroke();
    // lit arch
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = COLORS.dialogueBoxAccent;
    ctx.beginPath();
    ctx.moveTo(7, 30);
    ctx.lineTo(7, 18);
    ctx.quadraticCurveTo(16, 7, 25, 18);
    ctx.lineTo(25, 30);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // record window + buttons
    rect(ctx, 9, 20, 14, 9, mix(COLORS.storefront, '#000000', 0.2));
    ctx.fillStyle = COLORS.dialogueBoxBg;
    ctx.beginPath();
    ctx.arc(16, 24, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.interactBubbleMark;
    ctx.beginPath();
    ctx.arc(16, 24, 1.5, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, 7, 33, 18, 8, mix(body, '#000000', 0.3));
    for (let i = 0; i < 4; i += 1) rect(ctx, 9 + i * 4, 35, 2, 4, COLORS.lampGlow);
    rect(ctx, 4, 44, 24, 4, mix(body, '#000000', 0.45));
  });

  // --- arcade cabinet ---
  const cabinet = (lit: boolean) => (ctx: Ctx) => {
    shadowEllipse(ctx, 16, 54, 13, 3.5);
    const body = lit
      ? mix(COLORS.arcadeBg, '#FFFFFF', 0.12)
      : mix(COLORS.arcadeBg, '#000000', 0.15);
    rect(ctx, 3, 6, 26, 46, body);
    rect(ctx, 3, 6, 26, 2, mix(body, '#FFFFFF', 0.35));
    rect(ctx, 3, 6, 2, 46, mix(body, '#FFFFFF', 0.2));
    rect(ctx, 27, 6, 2, 46, mix(body, '#000000', 0.35));
    // marquee
    rect(ctx, 5, 8, 22, 7, mix(COLORS.interactBubbleMark, lit ? '#FFFFFF' : '#000000', 0.2));
    ctx.globalAlpha = 0.6;
    rect(ctx, 5, 8, 22, 2, '#FFFFFF');
    ctx.globalAlpha = 1;
    // screen
    rect(ctx, 6, 17, 20, 15, COLORS.storefront);
    const screen = ctx.createLinearGradient(7, 18, 25, 31);
    screen.addColorStop(0, lit ? COLORS.dialogueBoxAccent : mix(COLORS.glass, '#000000', 0.35));
    screen.addColorStop(1, lit ? mix(COLORS.npcBody, '#000000', 0.2) : mix(COLORS.storefront, '#000000', 0.2));
    ctx.fillStyle = screen;
    ctx.fillRect(7, 18, 18, 13);
    if (lit) {
      ctx.globalAlpha = 0.75;
      rect(ctx, 10, 27, 3, 2, COLORS.lampGlow);
      rect(ctx, 19, 22, 2, 2, COLORS.dialogueBoxBg);
      rect(ctx, 14, 24, 4, 1, COLORS.interactBubbleMark);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(8, 31);
    ctx.lineTo(16, 18);
    ctx.lineTo(19, 18);
    ctx.lineTo(11, 31);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // control deck
    rect(ctx, 4, 34, 24, 7, mix(body, '#000000', 0.28));
    rect(ctx, 4, 34, 24, 1, mix(body, '#FFFFFF', 0.3));
    rect(ctx, 9, 36, 2, 4, COLORS.steel);
    ctx.fillStyle = COLORS.interactBubbleMark;
    ctx.beginPath();
    ctx.arc(10, 36, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.dialogueBoxAccent;
    ctx.beginPath();
    ctx.arc(18, 38, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.flowerYellow;
    ctx.beginPath();
    ctx.arc(23, 38, 1.8, 0, Math.PI * 2);
    ctx.fill();
    rect(ctx, 3, 48, 26, 4, mix(body, '#000000', 0.45));
  };
  prop(ASSET_KEYS.cabinet, 56, cabinet(false));
  prop(ASSET_KEYS.cabinetLit, 56, cabinet(true));

  // --- study desk ---
  prop(ASSET_KEYS.desk, 44, (ctx) => {
    shadowEllipse(ctx, 16, 42, 13, 3.5);
    const wood = mix(COLORS.benchWood, '#FFFFFF', 0.08);
    rect(ctx, 1, 14, 30, 6, wood);
    rect(ctx, 1, 14, 30, 1, mix(wood, '#FFFFFF', 0.5));
    rect(ctx, 3, 20, 3, 18, mix(wood, '#000000', 0.3));
    rect(ctx, 26, 20, 3, 18, mix(wood, '#000000', 0.3));
    // laptop
    rect(ctx, 10, 6, 13, 9, COLORS.steel);
    rect(ctx, 11, 7, 11, 7, mix(COLORS.glassLight, '#000000', 0.1));
    rect(ctx, 8, 15, 17, 2, mix(COLORS.steel, '#FFFFFF', 0.25));
    // notebook + mug
    rect(ctx, 3, 10, 6, 5, COLORS.dialogueBoxBg);
    rect(ctx, 25, 9, 4, 5, COLORS.statusStudying);
  });

  // --- shared timer board ---
  prop(ASSET_KEYS.sharedTimer, 44, (ctx) => {
    shadowEllipse(ctx, 16, 42, 9, 3);
    rect(ctx, 14, 22, 4, 18, COLORS.steel);
    rect(ctx, 10, 38, 12, 3, COLORS.lampPost);
    rect(ctx, 2, 2, 28, 22, COLORS.storefront);
    rect(ctx, 4, 4, 24, 18, mix(COLORS.statusStudying, '#000000', 0.5));
    // digits
    ctx.fillStyle = COLORS.lampGlow;
    for (const dx of [6, 11, 18, 23]) {
      ctx.fillRect(dx, 8, 3, 10);
      ctx.fillStyle = mix(COLORS.lampGlow, '#000000', 0.25);
    }
    ctx.fillStyle = COLORS.lampGlow;
    ctx.fillRect(16, 11, 1, 1);
    ctx.fillRect(16, 15, 1, 1);
    ctx.globalAlpha = 0.5;
    rect(ctx, 4, 4, 24, 2, '#FFFFFF');
    ctx.globalAlpha = 1;
  });

  // --- park bandstand ---
  prop(ASSET_KEYS.bandstand, 64, (ctx) => {
    shadowEllipse(ctx, 16, 62, 15, 4);
    // roof
    ctx.fillStyle = mix(COLORS.interactBubbleMark, '#000000', 0.3);
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.lineTo(31, 18);
    ctx.lineTo(1, 18);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(16, 2);
    ctx.lineTo(24, 18);
    ctx.lineTo(16, 18);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    rect(ctx, 0, 18, 32, 3, mix(COLORS.benchWood, '#FFFFFF', 0.2));
    // posts
    rect(ctx, 3, 21, 3, 30, mix(COLORS.benchWood, '#FFFFFF', 0.15));
    rect(ctx, 26, 21, 3, 30, mix(COLORS.benchWood, '#FFFFFF', 0.15));
    // stage
    rect(ctx, 1, 48, 30, 8, mix(COLORS.benchWood, '#000000', 0.1));
    rect(ctx, 1, 48, 30, 2, mix(COLORS.benchWood, '#FFFFFF', 0.35));
    rect(ctx, 1, 56, 30, 4, mix(COLORS.benchWood, '#000000', 0.4));
    // warm stage light
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = COLORS.lampGlow;
    ctx.beginPath();
    ctx.ellipse(16, 46, 15, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

/**
 * Texture key for a character sheet in a given outfit colour.
 *
 * Generated on demand and cached by key, so choosing a cosmetic does not
 * require pre-rendering every combination at boot.
 */
export function outfitTextureKey(color: string, hat?: HatPaint): string {
  const base = `char_outfit_${color.replace('#', '')}`;
  return hat ? `${base}_${hat.style}${hat.color.replace('#', '')}` : base;
}

/**
 * The sheet for one outfit + hat combination, generated once and cached.
 *
 * Keyed by the full combination rather than by outfit alone: two players in
 * the same shirt and different hats are two textures, and re-picking a
 * cosmetic you have worn before costs nothing.
 */
export function ensureOutfitSheet(scene: Phaser.Scene, color: string, hat?: HatPaint): string {
  const key = outfitTextureKey(color, hat);
  if (!scene.textures.exists(key)) generateCharacterSheet(scene, key, color, hat);
  return key;
}

/** Everything the game needs. One call from BootScene. */
export function generateAllPlaceholderArt(scene: Phaser.Scene): void {
  generateTileset(scene);
  generateDrinkSprites(scene);
  generateCharacterSheet(scene, ASSET_KEYS.playerSheet, COLORS.playerBody);
  generateCharacterSheet(scene, ASSET_KEYS.remoteSheet, COLORS.remoteBody);
  generateCharacterSheet(scene, ASSET_KEYS.npcSheet, COLORS.npcBody);
  generateObjectSprites(scene);
  generateInteractableSprites(scene);
}
