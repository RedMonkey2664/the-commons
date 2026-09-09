/**
 * Colyseus game server.
 *
 * One room type serves every zone (see ZoneRoom), matched on `zoneId` so each
 * zone gets its own room instance. Adding a zone requires no change here.
 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname as pathDirname, join as joinPath, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { Server, matchMaker } from 'colyseus';
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

const dirnameOf = (url: string) => pathDirname(fileURLToPath(url));

const PORT = Number(process.env['PORT'] ?? 2567);

/**
 * Who may call this server from a browser.
 *
 * `ALLOWED_ORIGINS` is a comma-separated list, e.g.
 *   ALLOWED_ORIGINS=https://the-commons-client.vercel.app,http://localhost:5173
 *
 * Unset means "allow anything", which is right for local development and wrong
 * for a deployed server — so it is unset by default and warned about loudly at
 * boot rather than silently locked down, which would make the first deploy fail
 * in a way that looks like a bug in the game.
 */
const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

// Behind a host's load balancer (Render, Railway, Fly all use one), the socket
// is plain HTTP and only X-Forwarded-Proto says the client used TLS.
app.set('trust proxy', 1);

app.use(
  cors(
    ALLOWED_ORIGINS.length === 0
      ? {}
      : {
          origin(origin, callback) {
            // No Origin header: same-origin, curl, or a native client. Not a
            // browser cross-origin request, so nothing to gate.
            if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
            return callback(new Error(`origin not allowed: ${origin}`));
          },
        },
  ),
);
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
  const body = request.body as { roomId?: unknown; sessionId?: unknown };

  const roomId = typeof body.roomId === 'string' ? body.roomId : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';

  if (!roomId || !sessionId) {
    response.status(400).json({ error: 'roomId and sessionId are required' });
    return;
  }

  /**
   * Prove the caller is who and where they say.
   *
   * The token grants publish rights in a live voice room, so it cannot be
   * minted from an unauthenticated body: a caller could otherwise mint one as
   * another player (LiveKit evicts the real holder of a duplicate identity) or
   * for a zone they are not standing in.
   *
   * There is no account system yet, so the proof used is the Colyseus session
   * the player already holds: they must be a CURRENT member of the room they
   * are asking about, and the identity comes from that room's own record of
   * them rather than from this request. Real auth in a later pass strengthens
   * this without changing its shape.
   */
  const room = matchMaker.getLocalRoomById(roomId) as ZoneRoom | undefined;
  const present = room?.clients?.some((c) => c.sessionId === sessionId) ?? false;

  if (!room || !present) {
    response.status(403).json({ error: 'not a member of that room' });
    return;
  }

  const zoneId = (room.metadata as { zoneId?: string } | undefined)?.zoneId ?? '';
  const zone = ZONES.find((z) => z.id === zoneId);
  const identity = room.userIdFor?.(sessionId);

  if (!zone || !identity) {
    response.status(403).json({ error: 'room is not a zone room' });
    return;
  }

  // 02: "not designed for hundreds in one room". VOICE_LIMITS is the cap that
  // actually applies to the call, which is smaller than the Colyseus room cap.
  if (room.clients.length > VOICE_LIMITS.maxParticipants) {
    response.json({ availability: 'unavailable' });
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
    // Instanced zones get one voice room per Colyseus room, so two unrelated
    // study groups — or a Cafe that has overflowed into a second room — are not
    // dropped into the same call.
    const voiceRoom = voiceRoomFor(zone, room.roomId);
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      // Carried so participants show a name rather than an opaque id.
      name: room.displayNameFor?.(sessionId) ?? 'Wanderer',
      ttl: VOICE_LIMITS.tokenTtlSeconds,
    });
    at.addGrant({ roomJoin: true, room: voiceRoom, canPublish: true, canSubscribe: true });

    response.json({
      availability: 'ready',
      room: voiceRoom,
      url,
      identity,
      token: await at.toJwt(),
    });
  } catch (error) {
    console.warn('[voice] token mint failed:', (error as Error).message);
    response.json({ availability: 'unavailable' });
  }
});

/**
 * Everything a client needs to work out which cosmetics are unlocked (06).
 *
 * The unlock RULES live in shared/cosmetics.ts and are evaluated client-side;
 * this only reports the facts they are evaluated against. That keeps unlock
 * thresholds tunable without a migration, and means the server never has to
 * store a list of "owned" cosmetics that could drift from the scores that
 * earned them.
 *
 * These are cosmetic-only by design, so client-side evaluation costs nothing:
 * the worst a tampered client achieves is wearing a different colour.
 */
app.get('/progress/:userId', async (request, response) => {
  try {
    const store = getStore();
    const userId = request.params.userId;

    // Asked directly rather than found in a top-N board: a player outside that
    // slice would otherwise report no score at all and could never unlock a
    // score-gated cosmetic.
    const bestScores: Record<string, number> = {};
    await Promise.all(
      MINIGAMES.map(async (minigame) => {
        const best = await store.bestScore(minigame.id, userId);
        if (best > 0) bestScores[minigame.id] = best;
      }),
    );

    const [totalPlays, study] = await Promise.all([
      store.countPlays(userId),
      store.getStudyTotals(userId),
    ]);

    response.json({
      bestScores,
      totalPlays,
      studyMinutes: Math.floor(study.totalSeconds / 60),
    });
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
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

/**
 * Serve the built client, when one has been built.
 *
 * This is what collapses the deployment into a single origin: one process, one
 * URL, one link to send someone. It removes the two failure modes that made the
 * first deploy unreachable — a server URL baked in at build time, and a CORS
 * allowlist to keep in step — because a same-origin client derives its server
 * URL from the page it was served by.
 *
 * Mounted AFTER the API routes so /health, /scores and the rest keep their
 * paths, and skipped entirely when client/dist does not exist so that running
 * the dev server alongside Vite behaves exactly as before.
 */
const CLIENT_DIST = process.env['CLIENT_DIST']
  ? resolvePath(process.env['CLIENT_DIST'])
  : resolvePath(dirnameOf(import.meta.url), '..', '..', 'client', 'dist');

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // Single-page app: anything not matched above is the game's own index.html.
  // Colyseus owns /matchmake, so it must not be swallowed here.
  app.get(/^(?!\/matchmake).*/, (_request, response) => {
    response.sendFile(joinPath(CLIENT_DIST, 'index.html'));
  });
  console.log(`  [client] serving the built client from ${CLIENT_DIST}`);
} else {
  console.log('  [client] no client/dist — API only (run the Vite dev server separately)');
}

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

// 0.0.0.0 explicitly: a container that binds 127.0.0.1 is unreachable from
// outside itself, and every host's health check then fails with no useful error.
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  The Commons server listening on ws://localhost:${PORT}\n`);

  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`  [cors] allowing: ${ALLOWED_ORIGINS.join(', ')}`);
  } else if (process.env['NODE_ENV'] === 'production') {
    console.warn(
      '  [cors] ALLOWED_ORIGINS is unset — any website may call this server.\n' +
        '         Set it to your client origin before sharing the URL.',
    );
  }

  if (getStore().kind === 'json' && process.env['NODE_ENV'] === 'production') {
    console.warn(
      '  [store] using the JSON store on local disk. On a host with an\n' +
        '          ephemeral filesystem this is wiped on every deploy —\n' +
        '          set DATABASE_URL, or mount a volume at DATA_DIR.',
    );
  }
});

/**
 * Shut down in the right order, and only once.
 *
 * Hosts send SIGTERM and then SIGKILL a few seconds later, so this has to
 * finish quickly: stop accepting connections, let Colyseus tell its rooms to
 * dispose, then flush the store. Flushing last matters — the JSON store's
 * writes are debounced, and disposing rooms is what produces the final study
 * times worth flushing.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} — shutting down`);

  const forced = setTimeout(() => {
    console.warn('  shutdown took too long; exiting anyway');
    process.exit(0);
  }, 8000);
  forced.unref();

  try {
    await gameServer.gracefullyShutdown(false);
  } catch (error) {
    console.warn('  [colyseus] shutdown error:', (error as Error).message);
  }

  try {
    await closeStore();
  } catch (error) {
    console.warn('  [store] flush error:', (error as Error).message);
  }

  clearTimeout(forced);
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown(signal));
}
