/**
 * Colyseus game server.
 *
 * One room type serves every zone (see ZoneRoom), matched on `zoneId` so each
 * zone gets its own room instance. Adding a zone requires no change here.
 */

import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ZONE_ROOM_TYPE, ZONES } from '@commons/shared';
import { ZoneRoom } from './rooms/ZoneRoom.js';
import { loadZoneMap } from './world/zoneMaps.js';

const PORT = Number(process.env['PORT'] ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ ok: true, zones: ZONES.map((z) => z.id) });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

/**
 * `filterBy(['zoneId'])` is what makes one room type serve N zones: two clients
 * asking for the same zoneId join the same room, different ids get different
 * rooms. This is the config-over-code requirement applied to the server.
 */
gameServer.define(ZONE_ROOM_TYPE, ZoneRoom).filterBy(['zoneId']);

/**
 * Fail fast on a bad map rather than at the moment a player walks into it.
 * Zones whose map file does not exist yet are skipped with a warning — they are
 * declared in config ahead of their Phase 2 implementation.
 */
for (const zone of ZONES) {
  try {
    const map = loadZoneMap(zone);
    console.log(
      `[maps] ${zone.id}: ${map.parsed.width}x${map.parsed.height}, ` +
        `${map.parsed.interactables.length} interactables, spawn ${map.spawnPoint.x},${map.spawnPoint.y}`,
    );
  } catch {
    console.warn(`[maps] ${zone.id}: no map yet (${zone.mapFile}) — zone not playable`);
  }
}

httpServer.listen(PORT, () => {
  console.log(`\n  The Commons server listening on ws://localhost:${PORT}\n`);
});
