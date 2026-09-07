# 02 — Tech Stack & Architecture

## Stack

| Layer            | Choice                          | Why |
|-------------------|----------------------------------|-----|
| Game client        | Phaser 3 + TypeScript            | Purpose-built 2D tile-engine, huge community, free, handles tilemaps/animation/collision natively |
| Bundler            | Vite                             | Fast dev server, trivial TS+Phaser setup |
| Multiplayer server | Colyseus (Node.js + TypeScript)  | Room-based authoritative multiplayer designed exactly for "many small rooms with synced state" — fits zone-based world perfectly |
| Map authoring      | Tiled (external editor, free)    | Industry-standard tilemap editor, exports JSON Phaser reads natively |
| Persistence        | Postgres (via Supabase)          | Accounts, friend lists, study-time stats, arcade high scores, cosmetic unlocks |
| Auth               | Supabase Auth                    | Email/OAuth, minimal setup, works with Postgres above |
| Voice (phase 4+)   | LiveKit (self-hostable) or Daily.co | Small-room WebRTC voice without building a mesh network by hand |

## Why room-based multiplayer fits this world

Colyseus models the world as separate "rooms," each with its own
synchronized state. This maps 1:1 onto zones: Town Square is one room,
Library is another, each Study Room instance is its own room. A player
moving from Cafe to Arcade just means: leave Cafe room, join Arcade room.
This is much simpler than one giant shared-world server, and it's exactly
the right shape for a hangout game where zones are naturally separate
social spaces anyway.

```
                    ┌─────────────────────────┐
                    │   Colyseus Game Server   │
                    │                          │
   ┌────────────┐   │  ┌────────┐ ┌─────────┐ │
   │  Client A  │───┼─▶│ Room:  │ │ Room:   │ │
   │  (Phaser)  │   │  │ Town   │ │ Library │ │
   └────────────┘   │  │ Square │ │         │ │
                     │  └────────┘ └─────────┘ │
   ┌────────────┐   │  ┌────────┐ ┌─────────┐ │
   │  Client B  │───┼─▶│ Room:  │ │ Room:   │ │
   │  (Phaser)  │   │  │ Cafe   │ │ Arcade  │ │
   └────────────┘   │  └────────┘ └─────────┘ │
                     └──────────┬───────────────┘
                                │
                     ┌──────────▼───────────────┐
                     │  Postgres (via Supabase)  │
                     │  users, friends, stats,   │
                     │  high scores, unlocks     │
                     └────────────────────────────┘
```

## Client-server responsibility split

- **Server is authoritative for**: player position (validated against tile
  collision), who's in which room, jukebox queue state, minigame scores,
  Pomodoro session state for shared/group rooms.
- **Client is authoritative for**: rendering, animation, input handling,
  local-only cosmetic effects, solo Pomodoro timers (no need to round-trip
  a solo timer through the server).
- **Sync pattern**: client sends input intent (`move: 'up'`, `interact`),
  server validates and updates authoritative state, all clients in the room
  receive state patches and interpolate movement smoothly. Don't let clients
  set their own absolute position — that's how you get walking-through-walls
  cheats, and it also just makes movement feel worse (no correction of lag).

## Config-over-code requirement (important — this is load-bearing for extensibility)

Zones and minigames must be defined as data, not hardcoded scene logic, so
adding one doesn't require touching the core engine.

```typescript
// zones.config.ts — adding a new building = adding an entry here
export const ZONES: ZoneConfig[] = [
  {
    id: 'library',
    displayName: 'Library',
    tilemapKey: 'library_map',
    spawnPoint: { x: 12, y: 8 },
    ambientSound: 'library_quiet',
    interactables: ['focus_pod_1', 'focus_pod_2', 'reading_nook'],
    voiceChatDefault: 'muted', // zone-level social defaults
  },
  // new zones just get appended here
];

// minigames.config.ts — adding a new arcade cabinet = adding an entry here
export const MINIGAMES: MinigameConfig[] = [
  {
    id: 'trivia_blitz',
    displayName: 'Trivia Blitz',
    cabinetSpriteKey: 'cabinet_trivia',
    sceneKey: 'TriviaBlitzScene', // self-contained Phaser scene
    minPlayers: 1,
    maxPlayers: 4,
  },
];
```

Each minigame is its own self-contained Phaser Scene implementing a shared
`MinigameScene` interface (`onStart`, `onEnd`, `reportScore`), registered by
key. The Arcade zone just reads `MINIGAMES` and spawns a cabinet sprite +
interaction trigger for each entry — it never needs to know the minigame's
internals. See 06_ARCADE_MINIGAMES.md.

## Repo shape (high-level; full detail in 09_PROJECT_STRUCTURE_SETUP.md)

```
the-commons/
├── client/        Phaser + TS game
├── server/        Colyseus rooms + Postgres access
├── shared/        types/configs used by both (zones, minigames, schemas)
└── assets/        tilesets, sprites, audio (placeholder → real art)
```

## Non-functional requirements

- Target: smooth on a mid-range laptop in a browser tab, no install needed.
- Should degrade gracefully with 2-8 people in a room (not designed for
  hundreds in one room — that's a different architecture problem).
- All movement/interaction latency-tolerant: client-side prediction with
  server reconciliation, not lockstep.
