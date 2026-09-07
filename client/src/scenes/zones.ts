/**
 * Every zone scene.
 *
 * This is the config-over-code claim made good: five zones, and none of them
 * contains map loading, collision, spawning, camera, interaction, ambient
 * animation, networking or HUD code. All of that is derived by ZoneScene from
 * the zone's entry in zones.config.ts and its Tiled map.
 *
 * Adding the sixth zone means: a config entry, a Tiled map, four lines here,
 * and one line in zoneSceneRegistry.ts.
 */

import { MINIGAMES, getZone, type TileCoord } from '@commons/shared';
import { ZoneScene } from './ZoneScene';
import { ASSET_KEYS } from '../art/placeholderArt';
import { tileToWorld } from '../systems/GridMovement';

export class LibraryScene extends ZoneScene {
  constructor() {
    super(getZone('library'));
  }
}

export class CafeScene extends ZoneScene {
  constructor() {
    super(getZone('cafe'));
  }
}

export class ParkScene extends ZoneScene {
  constructor() {
    super(getZone('park'));
  }
}

export class StudyRoomScene extends ZoneScene {
  constructor() {
    super(getZone('study_room'));
  }
}

/**
 * The Arcade is the one zone with a build step, and it is still not
 * minigame-specific: it places one cabinet per entry in minigames.config.ts and
 * never learns what any of them do (06).
 *
 * MINIGAMES is empty until Phase 3, so the floor is currently bare — which is
 * the honest state of things, and exactly what the attendant tells you.
 */
export class ArcadeScene extends ZoneScene {
  constructor() {
    super(getZone('arcade'));
  }

  /** Wall bays the cabinets fill, in order. */
  private cabinetSlots(): TileCoord[] {
    const slots: TileCoord[] = [];
    for (const y of [5, 10]) {
      for (let x = 3; x <= this.zoneMap.widthInTiles - 4; x += 3) {
        slots.push({ x, y });
      }
    }
    return slots;
  }

  protected override onZoneReady(): void {
    const slots = this.cabinetSlots();

    MINIGAMES.forEach((minigame, index) => {
      const slot = slots[index];
      if (!slot) {
        console.warn(`[arcade] no floor space for cabinet "${minigame.id}"`);
        return;
      }

      const world = tileToWorld(slot);
      const textureKey = this.textures.exists(minigame.cabinetSpriteKey)
        ? minigame.cabinetSpriteKey
        : ASSET_KEYS.cabinetLit;

      this.add.image(world.x, world.y, textureKey).setOrigin(0.5, 1).setDepth(world.y);

      this.add
        .text(world.x, world.y - 60, minigame.displayName.toUpperCase(), {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#F2F4F7',
          backgroundColor: '#171A1FE0',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setDepth(world.y + 400);

      // Registered with the interaction system the same way a map object is,
      // so Space works on it with no special-casing anywhere.
      this.registerInteractable({
        id: `cabinet_${minigame.id}`,
        kind: 'cabinet',
        tile: slot,
        blocks: true,
        props: {
          minigameId: minigame.id,
          text: `${minigame.displayName}. ${minigame.blurb ?? 'Give it a go.'}`,
        },
      });
    });
  }
}
