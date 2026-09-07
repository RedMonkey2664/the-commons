/**
 * Placeholder art, drawn at runtime into canvas textures.
 *
 * 09_PROJECT_STRUCTURE_SETUP.md: "solid-color rectangles with a text label are
 * fine for Phase 0-2; swap in real tilesets/sprites in Phase 5 without needing
 * to touch scene logic (keep asset keys stable so swapping the source PNG is
 * enough)."
 *
 * So: every key defined in ASSET_KEYS is the contract. To move to real art,
 * load a PNG under the same key in BootScene and delete the matching generator
 * call. Nothing else in the codebase refers to how these pixels were made.
 */

import Phaser from 'phaser';
import { COLORS, SPACING } from '@commons/shared';

const TILE = SPACING.tile;

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

/** Character sheet layout: 4 directions x 4 frames. */
export const CHAR_FRAME_WIDTH = 16;
export const CHAR_FRAME_HEIGHT = 32;
export const CHAR_ROWS = { down: 0, left: 1, right: 2, up: 3 } as const;
export const CHAR_FRAMES_PER_ROW = 4;

type Ctx = CanvasRenderingContext2D;

function createCanvas(scene: Phaser.Scene, key: string, width: number, height: number) {
  // Regenerating over an existing key would leak texture memory across restarts.
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) throw new Error(`Failed to create canvas texture "${key}"`);
  return texture;
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Deterministic speckle, so the placeholder art is identical run to run. */
function speckle(ctx: Ctx, ox: number, oy: number, color: string, seed: number, count: number) {
  ctx.fillStyle = color;
  let s = seed;
  for (let i = 0; i < count; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const x = ox + (s >> 8) % TILE;
    const y = oy + (s >> 16) % TILE;
    ctx.fillRect(x, y, 1, 1);
  }
}

function shade(hexColor: string, amount: number): string {
  const n = Number.parseInt(hexColor.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Tileset
// ---------------------------------------------------------------------------

/**
 * Ten 16x16 tiles in a row. Index order must match tools/generate_placeholder_maps.py:
 * grass, grass_alt, path, tree, water, wall, sign, door, flower, plaza.
 */
export function generateTileset(scene: Phaser.Scene): void {
  const count = 10;
  const texture = createCanvas(scene, ASSET_KEYS.tileset, TILE * count, TILE);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const at = (i: number) => i * TILE;

  // 0 grass
  rect(ctx, at(0), 0, TILE, TILE, COLORS.placeholderGrass);
  speckle(ctx, at(0), 0, shade(COLORS.placeholderGrass, -18), 11, 10);

  // 1 grass_alt (tufted; also the ambient-sway tile)
  rect(ctx, at(1), 0, TILE, TILE, COLORS.placeholderGrassAlt);
  speckle(ctx, at(1), 0, shade(COLORS.placeholderGrassAlt, -26), 29, 16);

  // 2 path
  rect(ctx, at(2), 0, TILE, TILE, COLORS.placeholderPath);
  speckle(ctx, at(2), 0, shade(COLORS.placeholderPath, -22), 47, 12);

  // 3 tree (canopy over grass)
  rect(ctx, at(3), 0, TILE, TILE, COLORS.placeholderGrass);
  rect(ctx, at(3) + 6, 10, 4, 6, shade(COLORS.placeholderTree, -40));
  ctx.fillStyle = COLORS.placeholderTree;
  ctx.beginPath();
  ctx.arc(at(3) + 8, 7, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(COLORS.placeholderTree, 26);
  ctx.beginPath();
  ctx.arc(at(3) + 6, 5, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4 water
  rect(ctx, at(4), 0, TILE, TILE, COLORS.placeholderWater);
  ctx.fillStyle = shade(COLORS.placeholderWater, 30);
  ctx.fillRect(at(4) + 2, 4, 6, 1);
  ctx.fillRect(at(4) + 9, 9, 5, 1);
  ctx.fillRect(at(4) + 4, 13, 4, 1);

  // 5 wall (building facade)
  rect(ctx, at(5), 0, TILE, TILE, COLORS.placeholderFence);
  ctx.fillStyle = shade(COLORS.placeholderFence, -30);
  for (let row = 0; row < 4; row += 1) {
    ctx.fillRect(at(5), row * 4 + 3, TILE, 1);
    ctx.fillRect(at(5) + (row % 2 === 0 ? 4 : 11), row * 4, 1, 4);
  }

  // 6 sign tile (unused by the map generator; interactables come from objects)
  rect(ctx, at(6), 0, TILE, TILE, COLORS.placeholderGrass);
  rect(ctx, at(6) + 7, 8, 2, 7, shade(COLORS.placeholderSign, -40));
  rect(ctx, at(6) + 3, 3, 10, 7, COLORS.placeholderSign);

  // 7 door
  rect(ctx, at(7), 0, TILE, TILE, shade(COLORS.placeholderDoor, -20));
  rect(ctx, at(7) + 2, 2, 12, 14, COLORS.placeholderDoor);
  rect(ctx, at(7) + 10, 9, 2, 2, '#E8D9A0');

  // 8 flower
  rect(ctx, at(8), 0, TILE, TILE, COLORS.placeholderGrass);
  for (const [fx, fy] of [[3, 5], [10, 4], [6, 11]] as const) {
    rect(ctx, at(8) + fx, fy, 2, 2, COLORS.placeholderFlower);
    rect(ctx, at(8) + fx, fy + 2, 1, 2, shade(COLORS.placeholderGrass, -30));
  }

  // 9 plaza (paved centre)
  rect(ctx, at(9), 0, TILE, TILE, shade(COLORS.placeholderPath, 12));
  ctx.fillStyle = shade(COLORS.placeholderPath, -16);
  ctx.fillRect(at(9), 0, TILE, 1);
  ctx.fillRect(at(9), 8, TILE, 1);
  ctx.fillRect(at(9), 0, 1, TILE);
  ctx.fillRect(at(9) + 8, 0, 1, TILE);

  // Register each tile as a numbered frame so ambient overlays (and any other
  // code that needs a single tile as a sprite) can address them by index.
  for (let i = 0; i < count; i += 1) texture.add(i, 0, i * TILE, 0, TILE, TILE);

  texture.refresh();
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

function drawCharacterFrame(
  ctx: Ctx,
  ox: number,
  oy: number,
  bodyColor: string,
  direction: keyof typeof CHAR_ROWS,
  step: -1 | 0 | 1,
) {
  const skin = '#E8C49A';
  const hair = shade(bodyColor, -55);
  const dark = shade(bodyColor, -35);

  // Shadow anchors the sprite to its tile.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 30, 5.5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs — the step offset is the whole walk cycle at this fidelity.
  rect(ctx, ox + 4 + (step === -1 ? -1 : 0), oy + 25, 3, 6, dark);
  rect(ctx, ox + 9 + (step === 1 ? 1 : 0), oy + 25, 3, 6, dark);

  // Body
  rect(ctx, ox + 3, oy + 16, 10, 10, bodyColor);
  rect(ctx, ox + 2, oy + 17, 2, 7, dark); // arms
  rect(ctx, ox + 12, oy + 17, 2, 7, dark);

  // Head
  rect(ctx, ox + 3, oy + 5, 10, 11, skin);
  rect(ctx, ox + 3, oy + 4, 10, 4, hair);

  // Facing cue. 04 allows "colored rectangle + directional arrow" at this stage;
  // eyes read better than an arrow and still make facing unambiguous.
  ctx.fillStyle = '#2B2B2B';
  switch (direction) {
    case 'down':
      ctx.fillRect(ox + 5, oy + 10, 2, 2);
      ctx.fillRect(ox + 9, oy + 10, 2, 2);
      break;
    case 'up':
      rect(ctx, ox + 3, oy + 4, 10, 6, hair); // back of the head
      break;
    case 'left':
      ctx.fillRect(ox + 4, oy + 10, 2, 2);
      rect(ctx, ox + 2, oy + 10, 1, 3, skin); // nose
      break;
    case 'right':
      ctx.fillRect(ox + 10, oy + 10, 2, 2);
      rect(ctx, ox + 13, oy + 10, 1, 3, skin);
      break;
  }
}

/**
 * A 4x4 sheet: rows are down/left/right/up, columns are the walk cycle
 * [idle, step-left, idle, step-right]. Frame index = row * 4 + column.
 */
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
  // Signpost (16x16, drawn transparent so it sits over whatever tile it's on).
  {
    const texture = createCanvas(scene, ASSET_KEYS.signpost, TILE, TILE);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 7, 8, 2, 8, shade(COLORS.placeholderSign, -45));
    rect(ctx, 2, 2, 12, 8, COLORS.placeholderSign);
    rect(ctx, 3, 3, 10, 6, shade(COLORS.placeholderSign, 32));
    ctx.fillStyle = shade(COLORS.placeholderSign, -50);
    ctx.fillRect(4, 5, 8, 1);
    ctx.fillRect(4, 7, 5, 1);
    texture.refresh();
  }

  // Doorway (16x16).
  {
    const texture = createCanvas(scene, ASSET_KEYS.door, TILE, TILE);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 1, 0, 14, TILE, shade(COLORS.placeholderDoor, -25));
    rect(ctx, 3, 2, 10, 14, COLORS.placeholderDoor);
    rect(ctx, 10, 8, 2, 2, '#E8D9A0');
    texture.refresh();
  }

  // "!" interact bubble (12x14, tail at the bottom).
  {
    const texture = createCanvas(scene, ASSET_KEYS.interactBubble, 12, 14);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    rect(ctx, 0, 0, 12, 11, '#2B2B2B');
    rect(ctx, 1, 1, 10, 9, COLORS.interactBubbleBg);
    rect(ctx, 5, 11, 3, 2, '#2B2B2B');
    rect(ctx, 5, 11, 2, 1, COLORS.interactBubbleBg);
    rect(ctx, 5, 2, 2, 5, COLORS.interactBubbleMark);
    rect(ctx, 5, 8, 2, 2, COLORS.interactBubbleMark);
    texture.refresh();
  }

  // Soft drop shadow used under standalone object sprites.
  {
    const texture = createCanvas(scene, ASSET_KEYS.shadow, TILE, 6);
    const ctx = texture.getContext();
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath();
    ctx.ellipse(8, 3, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    texture.refresh();
  }
}

/** Everything Phase 0 needs. One call from BootScene. */
export function generateAllPlaceholderArt(scene: Phaser.Scene): void {
  generateTileset(scene);
  generateCharacterSheet(scene, ASSET_KEYS.playerSheet, COLORS.placeholderPlayer);
  generateCharacterSheet(scene, ASSET_KEYS.remoteSheet, COLORS.placeholderRemote);
  generateCharacterSheet(scene, ASSET_KEYS.npcSheet, '#7A6BA8');
  generateObjectSprites(scene);
}
