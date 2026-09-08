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
import {
  MINIGAME_ROOM_TYPE,
  MINIGAMES,
  VOICE_LIMITS,
  ZONE_ROOM_TYPE,
  ZONES,
  voiceRoomFor,
} from '@commons/shared';
import { ZoneRoom } from './rooms/ZoneRoom.js';
import { MinigameRoom } from './rooms/MinigameRoom.js';
import { loadZoneMap } from './world/zoneMaps.js';
import { closeStore, getStore, initStore } from './db/client.js';

const PORT = Number(process.env['PORT'] ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    zones: ZONES.map((z) => z.id),
    minigames: MINIGAMES.map((m) => m.id),
    store: getStore().kind,
    voice: process.env['LIVEKIT_API_KEY'] ? 'configured' : 'not_configured',
  });
});

/**
 * Leaderboards are read over HTTP rather than through a room: the Arcade shows
 * a board BEFORE you start playing (06), which is exactly when you are not in
 * a minigame room yet.
 */
app.get('/scores/:minigameId', async (request, response) => {
  const { minigameId } = request.params;
  const userId = typeof request.query['userId'] === 'string' ? request.query['userId'] : undefined;
  const friendsOnly = request.query['friends'] === '1';

  try {
    const store = getStore();
    const scores = friendsOnly && userId
      ? await store.friendScores(minigameId, userId, 10)
      : await store.topScores(minigameId, 10);
    response.json({ minigameId, scores });
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Solo minigame scores.
 *
 * Only for games with maxPlayers <= 1. Multiplayer results are written by
 * MinigameRoom from server-computed state, because 06 requires round outcomes
 * to be computed server-side rather than trusted from clients — accepting a
 * multiplayer score here would reopen exactly that hole.
 */
app.post('/scores/:minigameId', async (request, response) => {
  const { minigameId } = request.params;
  const body = request.body as { userId?: unknown; displayName?: unknown; score?: unknown };

  const config = MINIGAMES.find((m) => m.id === minigameId);
  if (!config) {
    response.status(404).json({ error: 'unknown minigame' });
    return;
  }
  if (config.maxPlayers > 1) {
    response.status(403).json({ error: 'multiplayer scores are recorded by the server' });
    return;
  }

  const userId = typeof body.userId === 'string' ? body.userId.slice(0, 64) : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.slice(0, 16) : '';
  const score = Number(body.score);

  if (!userId || !Number.isFinite(score) || score < 0 || score > 1_000_000) {
    response.status(400).json({ error: 'invalid score' });
    return;
  }

  try {
    const store = getStore();
    await store.upsertUser({ id: userId, displayName: displayName || 'Wanderer', spriteKey: 'char_player' });
    const result = await store.submitScore({
      minigameId,
      userId,
      displayName: displayName || 'Wanderer',
      score: Math.round(score),
      achievedAt: new Date().toISOString(),
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
  }
});

/**
 * Voice token (05, Phase 4).
 *
 * The client never touches WebRTC directly — 05 says not to hand-roll a mesh —
 * so it asks here for a short-lived token and hands that to the provider SDK.
 *
 * UNVERIFIED: LIVEKIT_API_KEY / LIVEKIT_API_SECRET were not available, so this
 * has never minted a token a real provider accepted. Without them it returns
 * `not_configured`, which the client surfaces as "voice is not set up" rather
 * than a mic button that silently does nothing.
 */
app.post('/voice/token', async (request, response) => {
  const body = request.body as { zoneId?: unknown; identity?: unknown; displayName?: unknown };

  const zoneId = typeof body.zoneId === 'string' ? body.zoneId : '';
  const identity = typeof body.identity === 'string' ? body.identity.slice(0, 64) : '';
  const zone = ZONES.find((z) => z.id === zoneId);

  if (!zone || !identity) {
    response.status(400).json({ error: 'zoneId and identity are required' });
    return;
  }

  const apiKey = process.env['LIVEKIT_API_KEY'];
  const apiSecret = process.env['LIVEKIT_API_SECRET'];
  const url = process.env['LIVEKIT_URL'];

  if (!apiKey || !apiSecret || !url) {
    response.json({ availability: 'not_configured' });
    return;
  }

  try {
    const { AccessToken } = await import('livekit-server-sdk');
    const room = voiceRoomFor(zone);
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: VOICE_LIMITS.tokenTtlSeconds,
    });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    response.json({
      availability: 'ready',
      room,
      url,
      identity,
      token: await at.toJwt(),
    });
  } catch (error) {
    console.warn('[voice] token mint failed:', (error as Error).message);
    response.json({ availability: 'unavailable' });
  }
});

/** Study totals for the HUD / profile. */
app.get('/study/:userId', async (request, response) => {
  try {
    response.json(await getStore().getStudyTotals(request.params.userId));
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
  }
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
 * One room type serves every multiplayer minigame, matched on `minigameId` —
 * the same pattern as zones. Adding a second multiplayer game needs a config
 * entry and a rules object, not a room class (06).
 */
gameServer.define(MINIGAME_ROOM_TYPE, MinigameRoom).filterBy(['minigameId']);

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

await initStore();

httpServer.listen(PORT, () => {
  console.log(`\n  The Commons server listening on ws://localhost:${PORT}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // Flush the debounced JSON store before exiting, or the last few minutes of
    // study time and scores are lost on every restart.
    void closeStore().finally(() => process.exit(0));
  });
}
