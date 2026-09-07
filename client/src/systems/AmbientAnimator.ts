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
const MAX_ANIMATED = 80;

type AmbientBuilder = (scene: Phaser.Scene, entry: AmbientTile, index: number) => Phaser.GameObjects.GameObject;

const BUILDERS: Record<string, AmbientBuilder> = {
  /**
   * A slow horizontal squash, anchored at the base of the tile so the tuft
   * bends rather than slides. 2-3 frame loop, ~1.5s cycle per 10's table —
   * expressed here as a tween because the placeholder tileset has one frame.
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
      scaleX: 0.9,
      duration: AMBIENT.grassSway.cycleMs / 2,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      // Stagger, or the whole field pulses in unison and reads as a glitch.
      delay: (index % 7) * (AMBIENT.grassSway.cycleMs / 7),
    });

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
