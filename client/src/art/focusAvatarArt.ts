/**
 * Focus Mode art: the same character, seated, in PARTS.
 *
 * The world avatar is a 4x4 sprite sheet of walk frames, and it stays exactly
 * that — this does not replace it. But a walk frame cannot lean on an elbow,
 * and a study behaviour system that flips between pre-drawn poses is the frame
 * -flipping look the whole feature is trying to avoid. So Focus Mode draws the
 * character as separate pieces (head, torso, two arms, hair, hat) which the
 * behaviour system then TWEENS: an arm that writes is an arm rotating a few
 * degrees, not a second sprite.
 *
 * Colours come from characterPalette() in placeholderArt, so a player who picks
 * a cosmetic sees the same person sit down. Only the geometry is new here.
 *
 * Every texture is generated once and cached by key. Long sessions re-use them;
 * nothing is drawn per frame.
 */

import type Phaser from 'phaser';
import { COLORS, WORLD_PALETTES, mix, type WorldPaletteId } from '@commons/shared';
import { characterPalette, paint } from './placeholderArt';

const { rect, createCanvas } = paint;

/** Expressions the head can wear. The behaviour system names these directly. */
export type FocusFace =
  | 'neutral'
  | 'reading'
  | 'closed'
  | 'thinking'
  | 'wide'
  | 'tired'
  | 'happy'
  | 'strained'
  | 'awayLeft'
  | 'awayRight';

/**
 * Which way the character is turned.
 *
 * A 2D scene cannot orbit its camera around a sprite, so a genuine side or
 * behind angle means REDRAWING the character turned — a profile head with the
 * eye near the front, or a back of a head with no face at all. Framing alone
 * would just be a cropped front view, which is the difference between a camera
 * angle and a zoom.
 */
export type FocusOrientation = 'front' | 'profile' | 'back';

export const FOCUS_ART = {
  head: (key: string, face: FocusFace) => `focus_head_${key}_${face}`,
  profileHead: (key: string, closed: boolean) => `focus_head_${key}_profile${closed ? '_shut' : ''}`,
  backHead: (key: string) => `focus_head_${key}_back`,
  torso: (key: string) => `focus_torso_${key}`,
  arm: (key: string) => `focus_arm_${key}`,
  desk: 'focus_desk',
  chair: 'focus_chair',
  book: 'focus_book',
  /** The back of the lid: what the camera sees from across the desk. */
  laptop: 'focus_laptop',
  /** The screen side, for shots from behind the avatar. */
  laptopScreen: 'focus_laptop_screen',
  mug: 'focus_mug',
  paper: 'focus_paper',
  pen: 'focus_pen',
  lamp: 'focus_lamp',
  glow: 'focus_glow',
  // The room takes the palette of the world you are studying in; the furniture
  // does not, because you brought the desk with you.
  wall: (palette: WorldPaletteId) => `focus_wall_${palette}`,
  window: (palette: WorldPaletteId) => `focus_window_${palette}`,
  floor: (palette: WorldPaletteId) => `focus_floor_${palette}`,
  mote: 'focus_mote',
  /** A single page, for turning. */
  page: 'focus_page',
  /** One highlighter stroke across a line of the book. */
  highlight: 'focus_highlight',
  /** Darkened edges, stretched over the whole frame. */
  vignette: 'focus_vignette',
  /** A soft round blob: steam, and dust too close to the lens to be in focus. */
  puff: 'focus_puff',
} as const;

const HEAD_W = 30;
const HEAD_H = 30;
const TORSO_W = 34;
const TORSO_H = 30;
const ARM_W = 8;
const ARM_H = 22;

/** Faces are the cheapest expressive surface there is — six pixels of eye. */
function drawFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  eyeY: number,
  face: FocusFace,
  eye: string,
  skin: string,
): void {
  ctx.fillStyle = eye;

  const open = (dx: number, w = 3, h = 4) => ctx.fillRect(cx + dx, eyeY, w, h);
  const shut = (dx: number) => ctx.fillRect(cx + dx, eyeY + 2, 4, 1);

  switch (face) {
    case 'neutral':
      open(-7);
      open(4);
      break;
    case 'reading':
      // Looking down at the page: pupils sit low in the eye.
      ctx.fillRect(cx - 7, eyeY + 2, 3, 3);
      ctx.fillRect(cx + 4, eyeY + 2, 3, 3);
      break;
    case 'closed':
    case 'tired':
      shut(-8);
      shut(4);
      if (face === 'tired') {
        // A shadow under each eye. Tiredness reads as weight, not shape.
        ctx.fillStyle = mix(skin, '#000000', 0.22);
        ctx.fillRect(cx - 8, eyeY + 4, 4, 1);
        ctx.fillRect(cx + 4, eyeY + 4, 4, 1);
      }
      break;
    case 'thinking':
      // Both pupils up and to one side: the universal "working it out".
      ctx.fillRect(cx - 6, eyeY, 3, 3);
      ctx.fillRect(cx + 5, eyeY, 3, 3);
      break;
    case 'wide':
      open(-8, 4, 5);
      open(4, 4, 5);
      break;
    case 'happy':
      // Upturned arcs, drawn as two steps each.
      ctx.fillRect(cx - 8, eyeY + 2, 2, 1);
      ctx.fillRect(cx - 6, eyeY + 1, 2, 1);
      ctx.fillRect(cx + 4, eyeY + 1, 2, 1);
      ctx.fillRect(cx + 6, eyeY + 2, 2, 1);
      break;
    case 'strained':
      // Squinting: a brow line pushed down over each eye.
      ctx.fillRect(cx - 8, eyeY + 1, 4, 2);
      ctx.fillRect(cx + 4, eyeY + 1, 4, 2);
      ctx.fillStyle = mix(skin, '#000000', 0.35);
      ctx.fillRect(cx - 8, eyeY - 2, 4, 1);
      ctx.fillRect(cx + 4, eyeY - 2, 4, 1);
      break;
    case 'awayLeft':
      ctx.fillRect(cx - 8, eyeY + 1, 3, 3);
      ctx.fillRect(cx + 3, eyeY + 1, 3, 3);
      break;
    case 'awayRight':
      ctx.fillRect(cx - 5, eyeY + 1, 3, 3);
      ctx.fillRect(cx + 6, eyeY + 1, 3, 3);
      break;
  }
}

function drawHead(
  scene: Phaser.Scene,
  key: string,
  bodyColor: string,
  face: FocusFace,
  hat?: { color: string; style: string },
): void {
  if (scene.textures.exists(key)) return;

  const texture = createCanvas(scene, key, HEAD_W, HEAD_H);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const p = characterPalette(bodyColor);
  const cx = HEAD_W / 2;

  // Face block, with the right side shaded so the head has a light direction.
  rect(ctx, cx - 9, 6, 18, 19, p.skin);
  rect(ctx, cx + 4, 6, 5, 19, p.skinShade);

  // Hair: a cap over the top and down the sides, same silhouette as the sheet.
  rect(ctx, cx - 10, 3, 20, 8, p.hair);
  rect(ctx, cx - 10, 3, 20, 2, p.hairLight);
  rect(ctx, cx - 10, 3, 3, 14, p.hair);
  rect(ctx, cx + 7, 3, 3, 14, p.hair);

  drawFace(ctx, cx, 15, face, p.eye, p.skin);

  // A mouth, but only where it earns its place.
  if (face === 'happy') {
    rect(ctx, cx - 3, 21, 6, 1, mix(p.skin, '#000000', 0.4));
    rect(ctx, cx - 4, 20, 1, 1, mix(p.skin, '#000000', 0.4));
    rect(ctx, cx + 3, 20, 1, 1, mix(p.skin, '#000000', 0.4));
  } else if (face === 'strained' || face === 'tired') {
    rect(ctx, cx - 2, 21, 4, 1, mix(p.skin, '#000000', 0.35));
  }

  if (hat) {
    const light = mix(hat.color, '#FFFFFF', 0.25);
    if (hat.style === 'beanie') {
      rect(ctx, cx - 10, 1, 20, 8, hat.color);
      rect(ctx, cx - 10, 7, 20, 3, light);
    } else if (hat.style === 'headphones') {
      rect(ctx, cx - 9, 1, 18, 3, hat.color);
      rect(ctx, cx - 12, 6, 4, 8, hat.color);
      rect(ctx, cx + 8, 6, 4, 8, hat.color);
    } else {
      // cap
      rect(ctx, cx - 10, 2, 20, 6, hat.color);
      rect(ctx, cx - 13, 8, 23, 2, light);
    }
  }

  ctx.save();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 10.5, 2.5, 21, 23);
  ctx.restore();

  texture.refresh();
}

/**
 * The head seen from the side. Faces right; the scene flips it for the other.
 *
 * Deliberately only two variants (eye open, eye shut). At profile the face is
 * three pixels of information, and ten expressions that read identically is
 * ten textures for nothing.
 */
function drawProfileHead(
  scene: Phaser.Scene,
  key: string,
  bodyColor: string,
  closed: boolean,
  hat?: { color: string; style: string },
): void {
  if (scene.textures.exists(key)) return;

  const texture = createCanvas(scene, key, HEAD_W, HEAD_H);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const p = characterPalette(bodyColor);
  const cx = HEAD_W / 2;

  rect(ctx, cx - 8, 6, 16, 19, p.skin);
  // The far side of the face falls away from the light.
  rect(ctx, cx - 8, 6, 4, 19, p.skinShade);
  // Nose, which is what actually sells a profile at this size.
  rect(ctx, cx + 8, 14, 2, 4, p.skin);
  rect(ctx, cx + 8, 18, 1, 1, p.skinShade);

  // Hair wraps the back and top, leaving the face clear.
  rect(ctx, cx - 10, 3, 18, 8, p.hair);
  rect(ctx, cx - 10, 3, 18, 2, p.hairLight);
  rect(ctx, cx - 10, 3, 6, 16, p.hair);

  ctx.fillStyle = p.eye;
  if (closed) ctx.fillRect(cx + 2, 17, 4, 1);
  else ctx.fillRect(cx + 3, 15, 3, 4);

  if (hat) {
    const light = mix(hat.color, '#FFFFFF', 0.25);
    if (hat.style === 'beanie') {
      rect(ctx, cx - 10, 1, 18, 8, hat.color);
      rect(ctx, cx - 10, 7, 18, 3, light);
    } else if (hat.style === 'headphones') {
      rect(ctx, cx - 9, 1, 16, 3, hat.color);
      rect(ctx, cx - 3, 6, 4, 8, hat.color);
    } else {
      rect(ctx, cx - 10, 2, 18, 6, hat.color);
      rect(ctx, cx + 6, 8, 6, 2, light);
    }
  }

  ctx.save();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 9.5, 2.5, 19, 23);
  ctx.restore();

  texture.refresh();
}

/** The back of the head: hair, a collar, and no face. */
function drawBackHead(
  scene: Phaser.Scene,
  key: string,
  bodyColor: string,
  hat?: { color: string; style: string },
): void {
  if (scene.textures.exists(key)) return;

  const texture = createCanvas(scene, key, HEAD_W, HEAD_H);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const p = characterPalette(bodyColor);
  const cx = HEAD_W / 2;

  rect(ctx, cx - 9, 6, 18, 19, p.skin);
  rect(ctx, cx - 10, 3, 20, 18, p.hair);
  rect(ctx, cx - 10, 3, 20, 2, p.hairLight);
  // A neck, so the head is attached to something from behind too.
  rect(ctx, cx - 4, 21, 8, 4, p.skinShade);

  if (hat) {
    const light = mix(hat.color, '#FFFFFF', 0.25);
    if (hat.style === 'headphones') {
      rect(ctx, cx - 9, 1, 18, 3, hat.color);
      rect(ctx, cx - 12, 6, 4, 8, hat.color);
      rect(ctx, cx + 8, 6, 4, 8, hat.color);
    } else {
      rect(ctx, cx - 10, 1, 20, 8, hat.color);
      rect(ctx, cx - 10, 7, 20, 2, light);
    }
  }

  ctx.save();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 10.5, 2.5, 21, 23);
  ctx.restore();

  texture.refresh();
}

function drawTorso(scene: Phaser.Scene, key: string, bodyColor: string): void {
  if (scene.textures.exists(key)) return;

  const texture = createCanvas(scene, key, TORSO_W, TORSO_H);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const p = characterPalette(bodyColor);
  const cx = TORSO_W / 2;

  rect(ctx, cx - 11, 2, 22, 26, p.shirt);
  rect(ctx, cx + 4, 2, 7, 26, p.shirtShade);
  rect(ctx, cx - 11, 2, 4, 26, p.shirtLight);
  // Collar, so the neck joins onto something.
  rect(ctx, cx - 5, 2, 10, 3, p.shirtShade);

  ctx.save();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 11.5, 1.5, 23, 27);
  ctx.restore();

  texture.refresh();
}

/**
 * One arm, drawn hanging straight down from its shoulder.
 *
 * The origin is set at the TOP of this texture by the caller, so rotating the
 * sprite pivots at the shoulder — which is the whole reason arms are separate
 * pieces. Writing, typing, stretching and chin-on-hand are all this one texture
 * at different angles.
 */
function drawArm(scene: Phaser.Scene, key: string, bodyColor: string): void {
  if (scene.textures.exists(key)) return;

  const texture = createCanvas(scene, key, ARM_W, ARM_H);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;

  const p = characterPalette(bodyColor);

  rect(ctx, 1, 0, 6, 15, p.shirt);
  rect(ctx, 1, 0, 2, 15, p.shirtLight);
  rect(ctx, 1, 13, 6, 2, p.shirtShade);
  // Hand
  rect(ctx, 1, 15, 6, 6, p.skin);
  rect(ctx, 5, 15, 2, 6, p.skinShade);

  texture.refresh();
}

/** Everything on the desk, plus the desk. Drawn once, shared by every session. */
function drawProps(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const texture = createCanvas(scene, key, w, h);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    texture.refresh();
  };

  make(FOCUS_ART.desk, 240, 46, (ctx) => {
    const top = COLORS.decking;
    rect(ctx, 0, 0, 240, 7, mix(top, '#FFFFFF', 0.22));
    rect(ctx, 0, 7, 240, 8, top);
    rect(ctx, 0, 15, 240, 31, mix(top, '#000000', 0.35));
    // Plank seams, so a wide slab does not read as a painted rectangle.
    for (let x = 18; x < 240; x += 34) rect(ctx, x, 0, 1, 15, mix(top, '#000000', 0.18));
    // A drawer, for somewhere for the eye to land.
    rect(ctx, 150, 22, 62, 14, mix(top, '#000000', 0.22));
    rect(ctx, 172, 28, 18, 3, mix(top, '#FFFFFF', 0.18));
  });

  make(FOCUS_ART.chair, 44, 40, (ctx) => {
    const c = mix(COLORS.benchWood, '#000000', 0.15);
    rect(ctx, 4, 0, 36, 26, c);
    rect(ctx, 4, 0, 36, 3, mix(c, '#FFFFFF', 0.2));
    rect(ctx, 8, 26, 28, 6, mix(c, '#000000', 0.3));
  });

  make(FOCUS_ART.book, 40, 16, (ctx) => {
    rect(ctx, 0, 4, 40, 11, mix(COLORS.storefront, '#FFFFFF', 0.1));
    rect(ctx, 1, 2, 18, 10, COLORS.flowerWhite);
    rect(ctx, 21, 2, 18, 10, mix(COLORS.flowerWhite, '#000000', 0.06));
    rect(ctx, 19, 1, 2, 12, mix(COLORS.storefront, '#FFFFFF', 0.25));
    for (let i = 0; i < 4; i += 1) {
      rect(ctx, 3, 4 + i * 2, 13, 1, mix(COLORS.flowerWhite, '#000000', 0.35));
      rect(ctx, 23, 4 + i * 2, 13, 1, mix(COLORS.flowerWhite, '#000000', 0.35));
    }
  });

  // The avatar faces the screen, so from across the desk the camera faces the
  // BACK of the lid: a plain shell, a logo, the hinge, and a little of the
  // screen's light spilling past its edges. Drawn screen-out, it read as the
  // laptop pointing at the viewer instead of at the person using it.
  make(FOCUS_ART.laptop, 40, 30, (ctx) => {
    const shell = COLORS.concreteDark;
    rect(ctx, 4, 0, 32, 22, mix(shell, '#FFFFFF', 0.08));
    // Top edge catching the lamp, which is on the left; the far side in shade.
    rect(ctx, 4, 0, 32, 2, mix(shell, '#FFFFFF', 0.22));
    rect(ctx, 30, 2, 6, 20, mix(shell, '#000000', 0.15));
    rect(ctx, 18, 9, 4, 4, mix(shell, '#FFFFFF', 0.35));
    rect(ctx, 3, 1, 1, 20, mix(COLORS.glassLight, shell, 0.35));
    rect(ctx, 36, 1, 1, 20, mix(COLORS.glassLight, shell, 0.35));
    // The hinge, and the back edge of the base showing beneath it.
    rect(ctx, 6, 22, 28, 2, mix(shell, '#000000', 0.3));
    rect(ctx, 1, 24, 38, 2, mix(shell, '#FFFFFF', 0.15));
    rect(ctx, 1, 26, 38, 2, mix(shell, '#000000', 0.3));
  });

  make(FOCUS_ART.laptopScreen, 40, 30, (ctx) => {
    const shell = COLORS.concreteDark;
    rect(ctx, 4, 0, 32, 21, shell);
    rect(ctx, 6, 2, 28, 17, mix(COLORS.glassLight, '#000000', 0.15));
    rect(ctx, 6, 2, 28, 4, mix(COLORS.glassLight, '#FFFFFF', 0.25));
    rect(ctx, 0, 21, 40, 5, mix(shell, '#FFFFFF', 0.18));
    rect(ctx, 0, 26, 40, 2, mix(shell, '#000000', 0.3));
  });

  make(FOCUS_ART.mug, 16, 16, (ctx) => {
    rect(ctx, 2, 3, 10, 12, COLORS.flowerWhite);
    rect(ctx, 2, 3, 3, 12, mix(COLORS.flowerWhite, '#FFFFFF', 0.4));
    rect(ctx, 12, 6, 3, 5, COLORS.flowerWhite);
    rect(ctx, 3, 4, 8, 2, mix(COLORS.benchWood, '#000000', 0.4));
  });

  make(FOCUS_ART.paper, 26, 18, (ctx) => {
    rect(ctx, 0, 0, 26, 18, COLORS.flowerWhite);
    rect(ctx, 0, 0, 26, 2, mix(COLORS.flowerWhite, '#FFFFFF', 0.5));
    for (let i = 0; i < 5; i += 1) {
      rect(ctx, 3, 4 + i * 3, 18 - (i % 2) * 5, 1, mix(COLORS.flowerWhite, '#000000', 0.42));
    }
  });

  make(FOCUS_ART.pen, 4, 16, (ctx) => {
    rect(ctx, 0, 0, 4, 12, COLORS.interactBubbleMark);
    rect(ctx, 0, 12, 4, 4, mix(COLORS.storefront, '#FFFFFF', 0.1));
  });

  make(FOCUS_ART.lamp, 34, 54, (ctx) => {
    const metal = COLORS.steel;
    rect(ctx, 12, 46, 14, 5, mix(metal, '#000000', 0.25));
    rect(ctx, 17, 16, 3, 32, metal);
    rect(ctx, 4, 6, 22, 5, metal);
    rect(ctx, 7, 10, 16, 5, mix(metal, '#000000', 0.2));
    rect(ctx, 9, 14, 12, 3, COLORS.lampGlow);
  });

  // A real radial falloff, baked once. Stacked translucent circles drawn with
  // Graphics band visibly against a dark backdrop — you can count the rings.
  make(FOCUS_ART.glow, 256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 233, 168, 0.30)');
    gradient.addColorStop(0.45, 'rgba(255, 233, 168, 0.10)');
    gradient.addColorStop(1, 'rgba(255, 233, 168, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });

  make(FOCUS_ART.mote, 4, 4, (ctx) => {
    rect(ctx, 1, 0, 2, 4, COLORS.lampGlow);
    rect(ctx, 0, 1, 4, 2, COLORS.lampGlow);
  });

  // The same size and ruling as one side of the open book, so a page landing
  // on the other side is indistinguishable from the page already there.
  make(FOCUS_ART.page, 18, 10, (ctx) => {
    rect(ctx, 0, 0, 18, 10, COLORS.flowerWhite);
    for (let i = 0; i < 4; i += 1) rect(ctx, 2, 2 + i * 2, 13, 1, mix(COLORS.flowerWhite, '#000000', 0.35));
    rect(ctx, 0, 0, 1, 10, mix(COLORS.flowerWhite, '#000000', 0.12));
  });

  // White, so it takes any tint; soft-edged, so up close it reads as out of
  // focus rather than as a big square pixel.
  make(FOCUS_ART.puff, 16, 16, (ctx) => {
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
  });

  make(FOCUS_ART.highlight, 14, 2, (ctx) => {
    rect(ctx, 0, 0, 14, 2, COLORS.lampGlow);
  });

  // A real radial falloff, like the glow: stepped rings would be visible.
  make(FOCUS_ART.vignette, 256, 256, (ctx) => {
    const gradient = ctx.createRadialGradient(128, 128, 60, 128, 128, 182);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
  });
}

/**
 * The room, in one world's colours.
 *
 * Furniture is shared across worlds and drawn once; the wall, floor and window
 * are per-palette and keyed by it, so travelling between worlds is a texture
 * swap rather than a redraw, and coming back is free.
 */
function drawRoom(scene: Phaser.Scene, id: WorldPaletteId): void {
  const p = WORLD_PALETTES[id];

  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const texture = createCanvas(scene, key, w, h);
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    texture.refresh();
  };

  make(FOCUS_ART.wall(id), 900, 320, (ctx) => {
    rect(ctx, 0, 0, 900, 320, p.wall);
    for (let x = 0; x < 900; x += 60) rect(ctx, x, 0, 1, 320, mix(p.wall, '#000000', 0.18));
    rect(ctx, 0, 306, 900, 14, mix(p.wall, '#FFFFFF', 0.06));
  });

  // The window is where a world says what it is: the sky beyond the desk.
  make(FOCUS_ART.window(id), 96, 76, (ctx) => {
    const frame = mix(p.floor, '#000000', 0.25);
    rect(ctx, 0, 0, 96, 76, frame);
    rect(ctx, 5, 5, 86, 66, p.windowSky);
    rect(ctx, 5, 48, 86, 23, p.windowHorizon);
    for (const [x, y] of [[14, 52], [22, 58], [60, 54], [70, 60], [78, 52]] as const) {
      rect(ctx, x, y, 3, 3, p.windowAccent);
    }
    rect(ctx, 64, 16, 7, 7, mix(p.windowAccent, '#FFFFFF', 0.4));
    rect(ctx, 46, 5, 4, 66, frame);
    rect(ctx, 5, 36, 86, 3, frame);
  });

  make(FOCUS_ART.floor(id), 900, 140, (ctx) => {
    rect(ctx, 0, 0, 900, 140, p.floor);
    for (let y = 0; y < 140; y += 14) rect(ctx, 0, y, 900, 1, mix(p.floor, '#000000', 0.25));
    for (let y = 0; y < 140; y += 14) {
      const offset = (y / 14) % 2 === 0 ? 0 : 45;
      for (let x = offset; x < 900; x += 90) rect(ctx, x, y, 1, 14, mix(p.floor, '#000000', 0.2));
    }
  });
}

/** Desk, lamp and props. Split out so a scene can build them BEFORE it lays out. */
export function ensureFocusProps(scene: Phaser.Scene, palette: WorldPaletteId = 'dusk'): void {
  drawProps(scene);
  drawRoom(scene, palette);
}

/**
 * Build every texture this session's avatar needs.
 *
 * Faces are generated eagerly — there are ten, each is a 30x30 canvas, and
 * generating one mid-session on the frame a behaviour first uses it is a
 * visible hitch for no saving worth having.
 */
export function ensureFocusArt(
  scene: Phaser.Scene,
  bodyColor: string,
  hat?: { color: string; style: string },
): { key: string; faces: readonly FocusFace[] } {
  const key = `${bodyColor.replace('#', '')}${hat ? `_${hat.style}${hat.color.replace('#', '')}` : ''}`;

  const faces: readonly FocusFace[] = [
    'neutral', 'reading', 'closed', 'thinking', 'wide',
    'tired', 'happy', 'strained', 'awayLeft', 'awayRight',
  ];

  for (const face of faces) drawHead(scene, FOCUS_ART.head(key, face), bodyColor, face, hat);
  drawProfileHead(scene, FOCUS_ART.profileHead(key, false), bodyColor, false, hat);
  drawProfileHead(scene, FOCUS_ART.profileHead(key, true), bodyColor, true, hat);
  drawBackHead(scene, FOCUS_ART.backHead(key), bodyColor, hat);
  drawTorso(scene, FOCUS_ART.torso(key), bodyColor);
  drawArm(scene, FOCUS_ART.arm(key), bodyColor);
  drawProps(scene);

  return { key, faces };
}
