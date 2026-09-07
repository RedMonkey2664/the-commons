# 09 — Project Structure & Setup

## Monorepo layout

```
the-commons/
├── client/
│   ├── src/
│   │   ├── scenes/
│   │   │   ├── BootScene.ts
│   │   │   ├── TownSquareScene.ts
│   │   │   ├── LibraryScene.ts
│   │   │   ├── CafeScene.ts
│   │   │   ├── ArcadeScene.ts
│   │   │   ├── ParkScene.ts
│   │   │   ├── StudyRoomScene.ts
│   │   │   └── minigames/
│   │   │       ├── MemoryMatchScene.ts
│   │   │       └── TriviaBlitzScene.ts
│   │   ├── entities/
│   │   │   ├── Player.ts
│   │   │   └── RemotePlayer.ts
│   │   ├── systems/
│   │   │   ├── GridMovement.ts
│   │   │   ├── InteractionSystem.ts
│   │   │   └── NetworkClient.ts   (Colyseus client wrapper)
│   │   ├── ui/
│   │   │   ├── DialogueBox.ts
│   │   │   ├── ItemPopup.ts
│   │   │   ├── FriendsPanel.ts
│   │   │   └── PomodoroOverlay.ts
│   │   ├── main.ts
│   │   └── config.ts
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── server/
│   ├── src/
│   │   ├── rooms/
│   │   │   ├── ZoneRoom.ts        (generic room, config-driven)
│   │   │   └── StudyRoomInstance.ts
│   │   ├── schemas/
│   │   │   └── PlayerState.ts     (Colyseus schema)
│   │   ├── db/
│   │   │   ├── client.ts          (Postgres/Supabase connection)
│   │   │   └── queries/
│   │   ├── index.ts
│   │   └── auth.ts
│   └── package.json
│
├── shared/
│   ├── zones.config.ts
│   ├── minigames.config.ts
│   └── types.ts
│
├── assets/
│   ├── tilesets/
│   ├── sprites/
│   ├── audio/
│   └── maps/              (Tiled .json exports)
│
├── package.json           (workspace root)
└── README.md
```

## Setup commands (for Claude Code to run/adapt)

```bash
# root workspace
npm init -y
npm pkg set workspaces[0]="client" workspaces[1]="server" workspaces[2]="shared"

# client
cd client
npm create vite@latest . -- --template vanilla-ts
npm install phaser colyseus.js
cd ..

# server
mkdir server && cd server
npm init -y
npm install colyseus @colyseus/schema express cors
npm install -D typescript ts-node-dev @types/node
cd ..

# shared
mkdir shared && cd shared
npm init -y
cd ..
```

## Environment variables (server/.env, not committed)

```
DATABASE_URL=            # Supabase Postgres connection string
SUPABASE_URL=
SUPABASE_ANON_KEY=
LIVEKIT_API_KEY=         # phase 4+
LIVEKIT_API_SECRET=      # phase 4+
PORT=2567                # Colyseus default
```

## Dev workflow

```bash
# terminal 1 — server
cd server && npm run dev

# terminal 2 — client
cd client && npm run dev
```

## Notes for Claude Code

- Keep `shared/` genuinely shared — both client and server import zone and
  minigame configs from here, never duplicate them.
- Tiled map JSON exports go in `assets/maps/`, loaded by Phaser's tilemap
  loader in each zone scene's `preload()`.
- Placeholder art: solid-color rectangles with a text label are fine for
  Phase 0-2; swap in real tilesets/sprites in Phase 5 without needing to
  touch scene logic (keep asset keys stable so swapping the source PNG is
  enough).
- Write each zone as its own Scene file even in Phase 0 (don't cram
  everything into one file) — this keeps the config-driven extensibility
  goal honest from day one instead of retrofitting it later.
