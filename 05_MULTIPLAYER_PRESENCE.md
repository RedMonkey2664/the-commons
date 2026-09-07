# 05 — Multiplayer & Presence

## What "multiplayer" means here

Not competitive netcode — this is presence and shared space. The bar is:
when your friend walks from the cafe to the arcade, you see it happen, in
close to real time, and you can walk over and join them.

## Player state synced per room

```typescript
interface PlayerState {
  id: string;              // stable user id
  displayName: string;
  spriteKey: string;       // chosen character skin
  x: number;
  y: number;
  facing: 'up' | 'down' | 'left' | 'right';
  status: 'idle' | 'studying' | 'listening' | 'afk';
  currentMinigame?: string; // if in an arcade cabinet
}
```

Server holds this per Colyseus room; on any change, patches broadcast to
all clients in that room. Clients interpolate remote players' movement
between updates so it looks smooth even at low update rates (don't send a
network message every single frame — send on tile-move events, interpolate
visually in between).

## Friends & invites

- Friend list persisted in Postgres (`friends` table, mutual-accept model).
- Online/offline + current-zone status shown in the friends panel (Esc
  menu), so you can see "Alex is in the Library" and walk there.
- Study Rooms specifically support a shareable room code/link so a friend
  not currently in the world can be invited to join a specific instance
  directly — matches your "hangout with friends" framing from the request.

## Zone transitions

- Leaving a zone = leave that Colyseus room (server cleans up your state
  there); entering a zone = join that room, spawn at its configured
  `spawnPoint` (see zones.config.ts).
- Brief client-side transition (fade or the classic screen-wipe) covers the
  network round-trip so it doesn't feel like a jarring pop.

## Text chat

- Lightweight proximity or zone-wide text chat (start with zone-wide, it's
  simpler and fine for room sizes of 2-8 people) — a chat bubble over the
  avatar plus a persistent chat log panel.
- This should exist before voice chat — it's the cheapest way to get real
  social interaction working while voice is being built.

## Voice chat (later phase, flagged as hard)

- Recommended: LiveKit (self-hostable, generous free tier) or Daily.co for
  actual WebRTC voice rooms — don't hand-roll a mesh network.
- Voice room maps to the same zone/room boundary as everything else: being
  in the Cafe room = being in the Cafe's voice room.
- Zone-level defaults from `zones.config.ts` (e.g. Library defaults to
  muted) should apply automatically on join, with a manual override always
  available to the player.
- This is explicitly Phase 4+ in the roadmap — get the world, movement, and
  text-based social layer solid first. Voice is additive, not blocking.

## Anti-abuse basics (don't skip even at MVP)

- Server validates all movement against tile collision — never trust
  client-reported position as truth.
- Rate-limit chat messages and interaction triggers per player.
- Report/block a user at minimum (hide their avatar/chat client-side);
  full moderation tooling can come later but the hook should exist from
  the start since this is a small-group product where a bad actor ruins
  the vibe fast.
