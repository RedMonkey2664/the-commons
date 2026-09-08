#!/usr/bin/env node
/**
 * Static map validation. Run after editing any map in assets/maps/.
 *
 *   node tools/verify_maps.mjs
 *
 * Catches the class of bug that is expensive to find by walking around:
 *   - a spawn point inside a wall
 *   - a signpost or NPC with no walkable tile adjacent to it
 *   - a door you can never reach
 *   - a door pointing at a zone id that does not exist
 *
 * Collision is derived the same way the client derives it (ZoneMap.ts): tile
 * properties from the tileset, plus objects flagged `blocks`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(here, '..', 'assets', 'maps');

/**
 * Read straight out of zones.config.ts rather than restated here.
 *
 * This was a hardcoded copy of the zone list, which meant adding a zone made
 * every door into it fail verification until someone remembered to edit this
 * file too — the exact "config quietly eroding into a special case" the
 * architecture is meant to prevent, sitting in the tool that checks for it.
 */
const KNOWN_ZONE_IDS = new Set(
  [...readFileSync(resolve(here, '..', 'shared', 'zones.config.ts'), 'utf8')
    .matchAll(/^\s{4}id: '([a-z_]+)',$/gm)].map((m) => m[1]),
);

if (KNOWN_ZONE_IDS.size === 0) {
  console.error('could not read any zone ids from shared/zones.config.ts');
  process.exit(1);
}

function propsOf(entity) {
  const out = {};
  for (const p of entity.properties ?? []) out[p.name] = p.value;
  return out;
}

function analyze(map) {
  const { width: W, height: H } = map;

  // gid -> collides, from tileset tile properties.
  const collidingGids = new Set();
  for (const tileset of map.tilesets) {
    for (const tile of tileset.tiles ?? []) {
      if (propsOf(tile).collides === true) collidingGids.add(tileset.firstgid + tile.id);
    }
  }

  const tileLayers = map.layers.filter((l) => l.type === 'tilelayer');
  const objects = map.layers.filter((l) => l.type === 'objectgroup').flatMap((l) => l.objects);

  const blockedByObject = new Set();
  for (const object of objects) {
    if (propsOf(object).blocks === true) {
      blockedByObject.add(`${Math.floor(object.x / map.tilewidth)},${Math.floor(object.y / map.tileheight)}`);
    }
  }

  const walkable = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    for (const layer of tileLayers) {
      if (collidingGids.has(layer.data[y * W + x])) return false;
    }
    return !blockedByObject.has(`${x},${y}`);
  };

  return { W, H, objects, walkable };
}

function floodFrom(start, walkable) {
  const seen = new Set([`${start.x},${start.y}`]);
  const stack = [start];
  while (stack.length > 0) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (!seen.has(key) && walkable(nx, ny)) {
        seen.add(key);
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

function verify(file) {
  const map = JSON.parse(readFileSync(join(MAPS_DIR, file), 'utf8'));
  const { objects, walkable } = analyze(map);
  const failures = [];

  const spawnObject = objects.find((o) => o.type === 'spawn' || o.name === 'spawn');
  if (!spawnObject) {
    failures.push('no spawn object on any object layer');
    return { file, failures, reachable: 0, checked: 0 };
  }

  const spawn = {
    x: Math.floor(spawnObject.x / map.tilewidth),
    y: Math.floor(spawnObject.y / map.tileheight),
  };
  if (!walkable(spawn.x, spawn.y)) failures.push(`spawn (${spawn.x},${spawn.y}) is not walkable`);

  const reachable = floodFrom(spawn, walkable);
  let checked = 0;

  for (const object of objects) {
    if (object.type === 'spawn' || object.name === 'spawn') continue;
    const props = propsOf(object);
    if (!props.kind) continue;
    checked += 1;

    const tx = Math.floor(object.x / map.tilewidth);
    const ty = Math.floor(object.y / map.tileheight);

    if (props.blocks === true) {
      // Must be approachable from at least one reachable neighbour.
      const approachable = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .some(([dx, dy]) => reachable.has(`${tx + dx},${ty + dy}`));
      if (!approachable) failures.push(`${object.name} (${tx},${ty}) has no reachable adjacent tile`);
    } else if (!reachable.has(`${tx},${ty}`)) {
      failures.push(`${object.name} (${tx},${ty}) sits on an unreachable tile`);
    }

    if (props.kind === 'door') {
      if (!props.targetZone) failures.push(`${object.name} has no targetZone`);
      else if (!KNOWN_ZONE_IDS.has(props.targetZone)) {
        failures.push(`${object.name} targets unknown zone "${props.targetZone}"`);
      }
    }
  }

  return { file, failures, reachable: reachable.size, checked };
}

const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error('no maps found in assets/maps/');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const result = verify(file);
  if (result.failures.length > 0) {
    failed += 1;
    console.log(`FAIL  ${result.file}`);
    for (const failure of result.failures) console.log(`        - ${failure}`);
  } else {
    console.log(`ok    ${result.file}  (${result.checked} interactables reachable, ${result.reachable} walkable tiles)`);
  }
}

process.exit(failed > 0 ? 1 : 0);
