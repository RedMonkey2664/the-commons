/**
 * Server-side map loading.
 *
 * Reads the SAME Tiled JSON the client fetches, and parses it with the SAME
 * shared function. This is what makes server-authoritative collision (05)
 * trustworthy rather than approximately correct.
 *
 * Maps are loaded once per zone and cached — they are static data, and a room
 * restart should not re-read them from disk.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedMap, TileCoord, TiledMapJson, ZoneConfig } from '@commons/shared';
import { createWalkabilityQuery, parseTiledMap } from '@commons/shared';

const here = dirname(fileURLToPath(import.meta.url));
/** server/src/world -> repo root -> assets */
const ASSETS_ROOT = resolve(here, '..', '..', '..', 'assets');

export interface ServerZoneMap {
  parsed: ParsedMap;
  isWalkable: (tile: TileCoord) => boolean;
  /** Spawn from the map's `spawn` object, falling back to the zone config. */
  spawnPoint: TileCoord;
}

const cache = new Map<string, ServerZoneMap>();

export function loadZoneMap(zone: ZoneConfig): ServerZoneMap {
  const cached = cache.get(zone.id);
  if (cached) return cached;

  // zone.mapFile is web-relative ("maps/town_square.json"); resolve under assets/.
  const path = resolve(ASSETS_ROOT, zone.mapFile);
  const json = JSON.parse(readFileSync(path, 'utf8')) as TiledMapJson;

  const parsed = parseTiledMap(json);
  const map: ServerZoneMap = {
    parsed,
    isWalkable: createWalkabilityQuery(parsed),
    spawnPoint: parsed.spawn ?? zone.spawnPoint,
  };

  cache.set(zone.id, map);
  return map;
}
