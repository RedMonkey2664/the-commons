/**
 * Tilemap wrapper.
 *
 * Rendering comes from Phaser; GAMEPLAY TRUTH comes from shared/tilemap.ts.
 *
 * That split is the point. The server derives collision from the same parser
 * over the same JSON (see server/src/world/zoneMaps.ts), so there is exactly
 * one definition of "walkable" in the codebase. 05 requires the server to
 * validate movement against tile collision, and a second implementation here
 * would be a standing invitation to desync.
 */

import Phaser from 'phaser';
import type { InteractableObject, ParsedMap, TileCoord, TiledMapJson, ZoneConfig } from '@commons/shared';
import { createWalkabilityQuery, parseTiledMap } from '@commons/shared';
import { ASSET_KEYS } from '../art/placeholderArt';

export interface AmbientTile {
  tile: TileCoord;
  ambient: string;
  frame: number;
  /** Resolved Phaser layer, so the animator can clear the static tile. */
  layer: Phaser.Tilemaps.TilemapLayer;
}

export class ZoneMap {
  readonly map: Phaser.Tilemaps.Tilemap;
  readonly parsed: ParsedMap;

  readonly widthInTiles: number;
  readonly heightInTiles: number;

  readonly interactables: InteractableObject[];
  readonly ambientTiles: AmbientTile[] = [];
  readonly mapSpawnPoint: TileCoord | null;

  private readonly layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
  private readonly walkable: (tile: TileCoord) => boolean;

  constructor(scene: Phaser.Scene, zone: ZoneConfig) {
    // Same JSON the server reads, parsed by the same function.
    const raw = scene.cache.tilemap.get(zone.tilemapKey)?.data as TiledMapJson | undefined;
    if (!raw) throw new Error(`Tilemap "${zone.tilemapKey}" is not in the cache`);

    this.parsed = parseTiledMap(raw);
    this.walkable = createWalkabilityQuery(this.parsed);

    this.widthInTiles = this.parsed.width;
    this.heightInTiles = this.parsed.height;
    this.interactables = this.parsed.interactables;
    this.mapSpawnPoint = this.parsed.spawn;

    // --- rendering ---
    this.map = scene.make.tilemap({ key: zone.tilemapKey });

    // Every tileset resolves to the placeholder texture for now. Real art in
    // Phase 5 changes this lookup and nothing else.
    const tilesets = this.map.tilesets
      .map((tileset) => this.map.addTilesetImage(tileset.name, ASSET_KEYS.tileset))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);

    if (tilesets.length === 0) {
      throw new Error(`No tilesets resolved for map "${zone.tilemapKey}"`);
    }

    for (const layerData of this.map.layers) {
      const layer = this.map.createLayer(layerData.name, tilesets, 0, 0);
      if (!layer) continue;
      layer.setDepth(-100); // world floor; characters sort above by feet-Y
      this.layers.set(layerData.name, layer);
    }

    // Resolve ambient entries against the created layers.
    for (const entry of this.parsed.ambientTiles) {
      const layer = this.layers.get(entry.layerName);
      if (!layer) continue;
      this.ambientTiles.push({ tile: entry.tile, ambient: entry.ambient, frame: entry.frame, layer });
    }
  }

  // -- queries -------------------------------------------------------------

  inBounds(tile: TileCoord): boolean {
    return tile.x >= 0 && tile.y >= 0 && tile.x < this.widthInTiles && tile.y < this.heightInTiles;
  }

  /** The one collision query, from the shared parser. Injected into GridMovement. */
  isWalkable = (tile: TileCoord): boolean => this.walkable(tile);

  interactableAt(tile: TileCoord): InteractableObject | undefined {
    return this.interactables.find((o) => o.tile.x === tile.x && o.tile.y === tile.y);
  }

  /** Interactables the player is orthogonally adjacent to, or standing on. */
  interactablesNear(tile: TileCoord): InteractableObject[] {
    return this.interactables.filter((o) => {
      const dx = Math.abs(o.tile.x - tile.x);
      const dy = Math.abs(o.tile.y - tile.y);
      return dx + dy <= 1;
    });
  }

  get widthInPixels(): number {
    return this.map.widthInPixels;
  }

  get heightInPixels(): number {
    return this.map.heightInPixels;
  }

  destroy(): void {
    for (const layer of this.layers.values()) layer.destroy();
    this.layers.clear();
    this.map.destroy();
  }
}
