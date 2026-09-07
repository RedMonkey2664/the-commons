/**
 * Tiled map parsing — shared by client and server.
 *
 * 05 requires the server to validate movement against tile collision, and 02
 * requires that clients never set their own absolute position. Both only hold
 * if client and server agree on what "walkable" means. The reliable way to
 * guarantee that is one implementation, over the same JSON, imported by both —
 * not two implementations that are carefully kept in step.
 *
 * So this module is deliberately engine-free: no Phaser, no fs. The client
 * feeds it the JSON out of Phaser's cache, the server feeds it the JSON off
 * disk, and they cannot disagree.
 */

import type { InteractableKind, InteractableObject, TileCoord } from './types.js';

// ---------------------------------------------------------------------------
// Minimal Tiled shapes (only the parts we consume)
// ---------------------------------------------------------------------------

interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

interface TiledTileDefinition {
  id: number;
  properties?: TiledProperty[];
}

interface TiledTileset {
  firstgid: number;
  name: string;
  tiles?: TiledTileDefinition[];
}

interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  x: number;
  y: number;
  point?: boolean;
  properties?: TiledProperty[];
}

interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  data?: number[];
  objects?: TiledObject[];
}

export interface TiledMapJson {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

// ---------------------------------------------------------------------------
// Parsed result
// ---------------------------------------------------------------------------

export interface AmbientTileInfo {
  tile: TileCoord;
  /** Key into ANIMATION.AMBIENT, e.g. 'grassSway'. */
  ambient: string;
  /** Tileset frame index (gid - firstgid), for redrawing the tile as a sprite. */
  frame: number;
  /** Name of the tile layer it came from, so a renderer can clear the original. */
  layerName: string;
}

export interface ParsedMap {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  /** Collision from tile properties, indexed y * width + x. */
  tileBlocked: boolean[];
  /** Collision contributed by interactables flagged `blocks`, as "x,y" keys. */
  objectBlocked: Set<string>;
  interactables: InteractableObject[];
  ambientTiles: AmbientTileInfo[];
  spawn: TileCoord | null;
}

const INTERACTABLE_KINDS: readonly InteractableKind[] = [
  'signpost', 'npc', 'door', 'focus_pod', 'seat', 'jukebox', 'cabinet', 'reading_nook',
];

function isInteractableKind(value: unknown): value is InteractableKind {
  return typeof value === 'string' && (INTERACTABLE_KINDS as readonly string[]).includes(value);
}

function propsToRecord(properties?: TiledProperty[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const entry of properties ?? []) {
    const value = entry.value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[entry.name] = value;
    }
  }
  return out;
}

/** Parse a Tiled JSON export into everything gameplay needs. */
export function parseTiledMap(json: TiledMapJson): ParsedMap {
  const { width, height, tilewidth: tileWidth, tileheight: tileHeight } = json;

  // gid -> properties, resolved across every tileset in the map.
  const collidingGids = new Set<number>();
  const ambientGids = new Map<number, string>();
  const firstGidOf = new Map<number, number>();

  for (const tileset of json.tilesets) {
    for (const tile of tileset.tiles ?? []) {
      const gid = tileset.firstgid + tile.id;
      const props = propsToRecord(tile.properties);
      if (props['collides'] === true) collidingGids.add(gid);
      if (typeof props['ambient'] === 'string') ambientGids.set(gid, props['ambient']);
      firstGidOf.set(gid, tileset.firstgid);
    }
  }

  const tileBlocked = new Array<boolean>(width * height).fill(false);
  const ambientTiles: AmbientTileInfo[] = [];

  for (const layer of json.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    for (let i = 0; i < layer.data.length; i += 1) {
      const gid = layer.data[i]!;
      if (gid === 0) continue;

      if (collidingGids.has(gid)) tileBlocked[i] = true;

      const ambient = ambientGids.get(gid);
      if (ambient !== undefined) {
        ambientTiles.push({
          tile: { x: i % width, y: Math.floor(i / width) },
          ambient,
          frame: gid - (firstGidOf.get(gid) ?? 1),
          layerName: layer.name,
        });
      }
    }
  }

  const interactables: InteractableObject[] = [];
  const objectBlocked = new Set<string>();
  let spawn: TileCoord | null = null;

  for (const layer of json.layers) {
    if (layer.type !== 'objectgroup' || !layer.objects) continue;
    for (const object of layer.objects) {
      const tile: TileCoord = {
        x: Math.floor(object.x / tileWidth),
        y: Math.floor(object.y / tileHeight),
      };

      if (object.type === 'spawn' || object.name === 'spawn') {
        spawn = tile;
        continue;
      }

      const props = propsToRecord(object.properties);
      const kind = props['kind'];
      if (!isInteractableKind(kind)) continue;

      const blocks = props['blocks'] === true;
      interactables.push({
        id: object.name || `${kind}_${tile.x}_${tile.y}`,
        kind,
        tile,
        blocks,
        props,
      });
      if (blocks) objectBlocked.add(`${tile.x},${tile.y}`);
    }
  }

  return { width, height, tileWidth, tileHeight, tileBlocked, objectBlocked, interactables, ambientTiles, spawn };
}

/**
 * The single walkability predicate. Both the client's movement system and the
 * server's move validation call this, over the same parsed map.
 */
export function createWalkabilityQuery(map: ParsedMap): (tile: TileCoord) => boolean {
  return (tile: TileCoord): boolean => {
    if (tile.x < 0 || tile.y < 0 || tile.x >= map.width || tile.y >= map.height) return false;
    if (map.tileBlocked[tile.y * map.width + tile.x]) return false;
    return !map.objectBlocked.has(`${tile.x},${tile.y}`);
  };
}
