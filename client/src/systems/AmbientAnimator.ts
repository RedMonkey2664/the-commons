/**
 * Ambient world animation (10): "cheap, high impact ... texture, not gameplay,
 * and shouldn't cost meaningful render budget with many players on screen."
 *
 * Tiles tagged with an `ambient` property in Tiled are lifted out of the static
 * tile layer and redrawn as sprites so they can be tweened. Phase 0 implements
 * grassSway (Town Square / Park); cafeSteam, pageTurn, cabinetFlicker and
 * bandstandPulse are registered the same way when those zones land.
 */

import Phaser from 'phaser';
import { AMBIENT, SPACING } from '@commons/shared';
import { ASSET_KEYS } from '../art/placeholderArt';
import type { AmbientTile, ZoneMap } from './ZoneMap';

const TILE = SPACING.tile;

/** Hard ceiling on animated props per zone, so a dense map can't tank the frame. */
const MAX_ANIMATED = 140;

type AmbientBuilder = (scene: Phaser.Scene, entry: AmbientTile, index: number) => Phaser.GameObjects.GameObject;

const BUILDERS: Record<string, AmbientBuilder> = {
  /**
   * A slow horizontal squash anchored at the base of the tile, so planting
   * bends rather than slides. ~1.5s cycle per 10's table.
   */
  grassSway: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99); // just above the floor layers, below every character

    scene.tweens.add({
      targets: sprite,
      scaleX: 0.92,
      duration: AMBIENT.grassSway.cycleMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      // Stagger, or the whole field pulses in unison and reads as a glitch.
      delay: (index % 7) * (AMBIENT.grassSway.cycleMs / 7),
    });

    return sprite;
  },

  /** Fountain water: a gentle brightness pulse, like light moving on a surface. */
  waterShimmer: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99);

    scene.tweens.add({
      targets: sprite,
      alpha: 0.55,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: (index % 5) * 280,
    });

    return sprite;
  },

  /**
   * Steam from a cup (10: Cafe, 3-4 frame loop, ~1s cycle, alpha fade at the
   * top). Drawn as a rising, fading wisp rather than a sprite loop, because
   * there is no steam frame in the tileset to cycle.
   */
  cafeSteam: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99);

    const wisp = scene.add
      .ellipse(x, y - TILE * 0.7, 7, 11, 0xffffff, 0.22)
      .setDepth(-98);

    scene.tweens.add({
      targets: wisp,
      y: y - TILE * 1.5,
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.9,
      duration: AMBIENT.cafeSteam.cycleMs,
      repeat: -1,
      ease: 'Sine.easeOut',
      delay: (index % 4) * (AMBIENT.cafeSteam.cycleMs / 4),
      onRepeat: () => {
        wisp.setPosition(x, y - TILE * 0.7).setAlpha(0.22).setScale(1);
      },
    });

    return sprite;
  },

  /**
   * A page turning in the reading nook (10: one-shot every 8-12s, randomised).
   * Randomised rather than periodic on purpose — a page turning on a metronome
   * would read as machinery, not as somebody reading.
   */
  pageTurn: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99);

    const schedule = () => {
      const span = AMBIENT.pageTurn.maxDelayMs - AMBIENT.pageTurn.minDelayMs;
      scene.time.delayedCall(AMBIENT.pageTurn.minDelayMs + Math.random() * span, () => {
        if (!sprite.active) return;
        scene.tweens.add({
          targets: sprite,
          scaleX: 0.82,
          duration: 110,
          yoyo: true,
          ease: 'Quad.easeInOut',
          onComplete: schedule,
        });
      });
    };
    scene.time.delayedCall(index * 400, schedule);

    return sprite;
  },

  /**
   * Arcade cabinet screen flicker (10: 2-frame subtle loop, ~2s cycle).
   */
  cabinetFlicker: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99);

    scene.tweens.add({
      targets: sprite,
      alpha: 0.72,
      duration: AMBIENT.cabinetFlicker.cycleMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: (index % 3) * 260,
    });

    return sprite;
  },

  /**
   * Bandstand light pulse (10: slow sine on emissive tiles, ~3s).
   */
  bandstandPulse: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99);

    const glow = scene.add
      .ellipse(x, y - TILE * 0.4, TILE * 1.5, TILE * 0.9, 0xffe9a8, 0.10)
      .setDepth(-98);

    scene.tweens.add({
      targets: glow,
      alpha: 0.24,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: AMBIENT.bandstandPulse.cycleMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      delay: (index % 3) * (AMBIENT.bandstandPulse.cycleMs / 3),
    });

    return sprite;
  },

  /**
   * Lit office windows. Long random holds rather than a steady blink — a
   * regular pulse reads as a fault, an occasional change reads as someone
   * moving about inside.
   */
  windowFlicker: (scene, entry, index) => {
    const x = entry.tile.x * TILE + TILE / 2;
    const y = entry.tile.y * TILE + TILE;

    const sprite = scene.add
      .image(x, y, ASSET_KEYS.tileset, entry.frame)
      .setOrigin(0.5, 1)
      .setDepth(-99)
      .setAlpha(0.9);

    const schedule = () => {
      scene.time.delayedCall(2500 + Math.random() * 6000, () => {
        if (!sprite.active) return;
        scene.tweens.add({
          targets: sprite,
          alpha: sprite.alpha > 0.6 ? 0.35 : 0.95,
          duration: 420,
          ease: 'Quad.easeInOut',
          onComplete: schedule,
        });
      });
    };
    scene.time.delayedCall(index * 140, schedule);

    return sprite;
  },
};

export class AmbientAnimator {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, zoneMap: ZoneMap) {
    let count = 0;

    for (const entry of zoneMap.ambientTiles) {
      if (count >= MAX_ANIMATED) break;
      const build = BUILDERS[entry.ambient];
      if (!build) continue;

      // Remove the static tile; the sprite replaces it. Ambient tiles are
      // decorative and never collide, so walkability is unaffected.
      entry.layer.removeTileAt(entry.tile.x, entry.tile.y);

      this.objects.push(build(scene, entry, count));
      count += 1;
    }
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}
