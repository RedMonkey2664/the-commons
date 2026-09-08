/**
 * Zone registry — 02_TECH_STACK_ARCHITECTURE.md, 03_WORLD_MAP_ZONES.md.
 *
 * ADDING A NEW ZONE:
 *   1. Append an entry here.
 *   2. Drop its Tiled JSON in assets/maps/.
 *   3. Add a scene file that extends ZoneScene and passes this config up.
 * Nothing in the engine, the network client, or the transition system changes.
 */

import type { ZoneConfig, ZoneId } from './types.js';

export const ZONES: ZoneConfig[] = [
  {
    id: 'town_square',
    displayName: 'Town Square',
    tilemapKey: 'town_square_map',
    mapFile: 'maps/town_square.json',
    sceneKey: 'TownSquareScene',
    spawnPoint: { x: 19, y: 20 },
    entryPoints: {
      library: { x: 6, y: 14 },
      cafe: { x: 33, y: 14 },
      park: { x: 19, y: 2 },
      arcade: { x: 19, y: 25 },
      study_room: { x: 23, y: 25 },
      greenhouse: { x: 7, y: 7 },
      skyline_terrace: { x: 36, y: 14 },
    },
    ambientSound: 'ambient_outdoor',
    interactables: [
      'sign_library', 'sign_cafe', 'sign_park', 'sign_arcade', 'sign_welcome',
      'sign_greenhouse', 'sign_terrace',
      'npc_wanderer', 'npc_gardener',
    ],
    voiceChatDefault: 'unmuted',
    bgColorToken: 'townSquareBg',
  },
  {
    id: 'library',
    displayName: 'Library',
    tilemapKey: 'library_map',
    mapFile: 'maps/library.json',
    sceneKey: 'LibraryScene',
    spawnPoint: { x: 12, y: 14 },
    ambientSound: 'library_quiet',
    interactables: [
      'focus_pod_1', 'focus_pod_2', 'focus_pod_3', 'focus_pod_4',
      'reading_seat_1', 'reading_seat_2', 'reading_seat_3', 'reading_seat_4',
      'reading_nook', 'npc_librarian', 'door_town_square',
    ],
    voiceChatDefault: 'muted',
    bgColorToken: 'libraryBg',
  },
  {
    id: 'cafe',
    displayName: 'Cafe',
    tilemapKey: 'cafe_map',
    mapFile: 'maps/cafe.json',
    sceneKey: 'CafeScene',
    spawnPoint: { x: 10, y: 14 },
    ambientSound: 'cafe_chatter',
    interactables: [
      'jukebox', 'counter_barista', 'drink_counter',
      'stool_1', 'stool_2', 'stool_3', 'stool_4',
      'booth_1', 'booth_2', 'booth_3', 'booth_4',
      'communal_1', 'communal_2', 'communal_3', 'communal_4',
      'corner_table_1', 'corner_table_2',
      'door_town_square',
    ],
    voiceChatDefault: 'unmuted',
    bgColorToken: 'cafeBg',
  },
  {
    id: 'arcade',
    displayName: 'Arcade',
    tilemapKey: 'arcade_map',
    mapFile: 'maps/arcade.json',
    sceneKey: 'ArcadeScene',
    spawnPoint: { x: 11, y: 15 },
    ambientSound: 'arcade_hum',
    // Cabinets are NOT listed here — the Arcade scene generates one per entry in
    // minigames.config.ts, so adding a minigame must not require editing a zone.
    interactables: ['npc_attendant', 'door_town_square'],
    voiceChatDefault: 'unmuted',
    bgColorToken: 'arcadeBg',
  },
  {
    id: 'park',
    displayName: 'Park',
    tilemapKey: 'park_map',
    mapFile: 'maps/park.json',
    sceneKey: 'ParkScene',
    spawnPoint: { x: 14, y: 17 },
    ambientSound: 'ambient_outdoor',
    interactables: ['bandstand', 'bench_1', 'bench_2', 'bench_3', 'npc_busker', 'door_town_square'],
    voiceChatDefault: 'unmuted',
    bgColorToken: 'parkBg',
  },
  {
    id: 'study_room',
    displayName: 'Study Room',
    tilemapKey: 'study_room_map',
    mapFile: 'maps/study_room.json',
    sceneKey: 'StudyRoomScene',
    spawnPoint: { x: 8, y: 10 },
    ambientSound: null,
    interactables: ['desk_1', 'desk_2', 'desk_3', 'desk_4', 'shared_timer', 'door_town_square'],
    voiceChatDefault: 'unmuted',
    // One Colyseus room per group, joined by code — not one global room.
    instanced: true,
    bgColorToken: 'libraryBg',
  },
  {
    id: 'skyline_terrace',
    displayName: 'Skyline Terrace',
    tilemapKey: 'skyline_terrace_map',
    mapFile: 'maps/skyline_terrace.json',
    sceneKey: 'SkylineTerraceScene',
    spawnPoint: { x: 12, y: 13 },
    ambientSound: 'ambient_outdoor',
    // A second jukebox room. 04's shared-queue mechanic is per room, so the
    // terrace has its own queue rather than mirroring the cafe below it.
    interactables: [
      'terrace_speakers', 'lounger_1', 'lounger_2', 'lounger_3', 'lounger_4',
      'npc_smoker', 'door_town_square',
    ],
    voiceChatDefault: 'unmuted',
    bgColorToken: 'terraceBg',
  },
  {
    id: 'greenhouse',
    displayName: 'Greenhouse',
    tilemapKey: 'greenhouse_map',
    mapFile: 'maps/greenhouse.json',
    sceneKey: 'GreenhouseScene',
    spawnPoint: { x: 11, y: 13 },
    ambientSound: 'library_quiet',
    interactables: [
      'potting_bench_1', 'potting_bench_2', 'garden_nook',
      'npc_grower', 'door_town_square',
    ],
    // Quiet for a different reason than the Library: not enforced, just the
    // kind of room nobody raises their voice in.
    voiceChatDefault: 'muted',
    bgColorToken: 'greenhouseBg',
  },
];

const ZONES_BY_ID = new Map<ZoneId, ZoneConfig>(ZONES.map((z) => [z.id, z]));

export function getZone(id: ZoneId): ZoneConfig {
  const zone = ZONES_BY_ID.get(id);
  if (!zone) throw new Error(`Unknown zone id: ${id}`);
  return zone;
}

export function getZoneBySceneKey(sceneKey: string): ZoneConfig | undefined {
  return ZONES.find((z) => z.sceneKey === sceneKey);
}

/** Where a player should appear when arriving in `to` from `from`. */
export function resolveEntryPoint(to: ZoneConfig, from?: ZoneId) {
  if (from && to.entryPoints?.[from]) return to.entryPoints[from]!;
  return to.spawnPoint;
}
