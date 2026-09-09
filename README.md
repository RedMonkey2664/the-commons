# The Commons

A 2D top-down multiplayer virtual hangout town, styled like Pokemon
FireRed/LeafGreen. Friends log in to the same small town to study, chill,
listen to music together, and play arcade minigames.

The point is **presence, not progression** — see
[01_VISION_AND_CONCEPT.md](01_VISION_AND_CONCEPT.md).

---

## Status: Phase 7 — deployable

| Phase | Scope | State |
|---|---|---|
| **0** | Single-player skeleton: Town Square, WASD grid movement, collision, camera | **Done** — 24/24 smoke checks |
| **1** | Colyseus server, multiplayer sync in Town Square | **Done** — 26/26 sync checks |
| **2** | All zones + zone transitions + NPC dialogue + friends list | **Done** — 42/42 world checks |
| **3** | Persistence, arcade minigames, study tracking, text chat | **Done** — 20/20 arcade checks |
| **4** | Shared jukebox + voice policy | **Done** — 20/20 music checks |
| **5** | Remaining minigames, cosmetics, ambient life, sound | **Done** — 37/37 polish checks |
| **6** | Two more zones, two more cabinets, cafe drinks, interior art | **Done** — 29/29 world checks |
| **7** | Deployable server: CORS allowlist, env config, graceful shutdown, host configs | **Done** — 14/14 deploy checks |
| **7b** | One-URL deploy: server serves the client, nothing to configure | **Done** — 12/12 single-origin checks |
| 3a | Supabase auth + real accounts | **Blocked** — needs credentials |
| 4a | Voice transport (LiveKit) | **Blocked** — needs credentials |
| 7a | Actually hosting it | **Ready** — push to a host, set nothing; see [Deploying](#deploying) |
| 5a | Real pixel art to replace the procedural placeholders | **Blocked** — needs source art |

224 checks across the nine suites. Every one drives a real browser against a
real server and asserts on real game state; none of them stub the game.

`phase1_sync` is the one that is not reliably green on every machine: on
Windows it has come back 25/26 twice for two different environmental reasons —
once a remote tile lagging one step behind under load, once headless Chromium
having no audio device for the WebAudio context. Both are the harness meeting
the machine, not the game; a re-run passes the check that failed.

**There is no Phase 6 in the specs.** 08's roadmap ends at Phase 5, whose last
bullet is "anything you think of after actually using it with friends — this is
the phase where the config-driven architecture pays off, since new
zones/minigames/cosmetics should be additive from here on, not rewrites". Phase
6 is that bullet taken literally, and it is the first real test of the claim:
two zones and two cabinets were added, and the engine, the network layer, the
transition system and the arcade were not touched. What *did* need changing is
listed honestly under [Where the config claim leaked](#where-the-config-claim-leaked).

**Playable right now:** type a name and walk the whole town, play the arcade,
and talk to whoever is in the room with you. Eight zones —
Town Square, Library, Cafe, Arcade, Park, Study Rooms, the Skyline Terrace and
the Greenhouse — all connected by doors you walk onto, with a fade transition and an arrival point that puts you
back at the door you came out of. Grid-based WASD movement with tile collision,
bump feedback and turn-in-place. Space reads signposts and talks to NPCs through
a dialogue box; "!" bubbles mark anything interactable. Sit at a library focus
pod and your status becomes `studying` — no start button, just sitting down.
Esc opens the friends panel showing who is in the room with you.

The Arcade has seven working cabinets: **Memory Match**, **Retro Runner** and
**Stack Tower** (solo), **Trivia Blitz**, **Reaction Tap** and **Word Rush** (up
to four players, scored by the server), and **Rhythm Tap**, which charts itself
from a jukebox track. Scores persist and come back as a leaderboard. Sitting at a focus pod accrues **study time**, timed by the
server and written when you stand up. **Enter** opens chat — messages appear as
bubbles over the speaker and in a log panel.

At the **cafe counter** you can order a drink. It costs nothing, unlocks
nothing and does nothing except put a mug over your head that everyone else in
the room can see — which is the entire point of it (03).

The **Cafe jukebox**, **Park bandstand** and **terrace speakers** each play one
shared queue per room.
Everyone in the room hears the same track at the same point in it, including
someone who walks in halfway through. Queue a track, or vote to skip.

Play a few rounds or put in some study time and you unlock **cosmetics** — an
outfit colour and a hat, picked from the friends panel and drawn onto your
character. They change how you look and nothing else; locked ones stay visible
with what earns them, so the arcade has a reason to be revisited without
becoming a grind. Zones have **ambient life** — steam over the cafe counter,
pages turning in the library, the bandstand pulsing in the park — and everything
you do makes a quiet sound, all of it synthesised at runtime.

Open a second browser and you see each other live, with nameplates, moving at
the same 130ms-per-tile cadence, walking between zones, chatting, and each
other's status updating as you sit and stand.

If the server is down the town still works — you just play it alone.

---

## Setup

Requires Node 20+.

```bash
npm install                 # installs all workspaces
npm run dev:client          # http://localhost:5173
```

For multiplayer, run both:

```bash
# terminal 1
npm run dev:server     # ws://localhost:2567
# terminal 2
npm run dev:client     # http://localhost:5173
```

Open two browser windows to see two players. The client connects automatically
and falls back to single-player if the server is unreachable.

To play with someone who is not sitting at your machine, see
[Deploying](#deploying): `npm run share` puts tonight's session on a public URL
without hosting anything, and Render hosts the whole game free for good.

### Other commands

```bash
npm run build               # typecheck + production client bundle
npm run typecheck           # all workspaces
node tools/verify_maps.mjs  # validate every map: spawn, reachability, door targets
python tools/generate_placeholder_maps.py   # regenerate placeholder Tiled maps
node tools/phase0_smoke.mjs  # single-player smoke test (no server needed)
node tools/phase1_sync.mjs   # two-client multiplayer sync test (boots server + client)
node tools/phase2_world.mjs   # walks every zone door and back (single-player)
node tools/phase3_arcade.mjs  # arcade, chat and persistence
node tools/phase4_music.mjs   # shared jukebox sync and voice policy
node tools/phase5_polish.mjs  # remaining minigames, cosmetics, ambient
node tools/phase6_world.mjs   # new zones, new cabinets, cafe drinks
node tools/phase7_deploy.mjs  # PRODUCTION build + cross-origin + CORS
node tools/phase7b_single_origin.mjs # the one-URL deploy, configuring nothing
node tools/capture_zones.mjs  # screenshot zones, for looking at rather than asserting on
node tools/capture_tileset.mjs # dump the generated tileset, labelled by index
node tools/capture_screens.mjs # screenshot the loading, title and world screens
```

Both need `npx playwright install chromium` once. Add `--headed` to watch.

---

## Controls

| Key | Action |
|---|---|
| `W` `A` `S` `D` (or arrows) | Move one tile |
| `Space` (or `Enter`) | Interact / advance dialogue |
| `Enter` | Chat (Enter sends, Esc cancels) |
| `M` | Toggle microphone |
| `Esc` | Friends panel |

Tap a direction you aren't facing to **turn in place**; hold it to walk.
Holding a direction chains tiles continuously.

---

## Repo layout

```
client/          Phaser 3 + TypeScript game
  src/art/         placeholder art generation, animation registration
  src/entities/    Player, RemotePlayer
  src/systems/     GridMovement, ZoneMap, Interaction*, InputController,
                   AmbientAnimator, NetworkClient, MultiplayerSystem
  src/scenes/      BootScene, TitleScene, ZoneScene (base), TownSquareScene,
                   zones.ts (Library/Cafe/Arcade/Park/StudyRoom)
  src/ui/          UIScene, DialogueBox, ItemPopup, Hud
server/          Colyseus game server
  src/rooms/       ZoneRoom — one generic, config-driven room type for every zone
  src/schemas/     Colyseus state schemas
  src/world/       map loading (shares the client's collision parser)
shared/          types, zones.config, minigames.config, animationConfig, designTokens
assets/          tilesets, sprites, audio, maps (Tiled JSON) — served as the web root
tools/           map generation and validation, smoke test
```

The numbered `NN_*.md` files at the repo root are the design specs. They are the
source of truth; this README describes what has been built from them.

---

## Architecture: config over code

This is a hard requirement from
[02_TECH_STACK_ARCHITECTURE.md](02_TECH_STACK_ARCHITECTURE.md), not a
preference. New content must not require engine changes.

### Adding a zone

1. Append a `ZoneConfig` to `shared/zones.config.ts`.
2. Put its Tiled JSON in `assets/maps/`.
3. Add a scene file — the whole file:

   ```ts
   export class LibraryScene extends ZoneScene {
     constructor() { super(getZone('library')); }
   }
   ```

4. Add one line to `client/src/scenes/zoneSceneRegistry.ts`.

`ZoneScene` derives map loading, collision, spawn resolution, camera, the
interaction system, ambient animation and the HUD from the config and the map.
A zone that needs something unique overrides a hook rather than reimplementing
the scene.

### Adding an interactable

Add a handler to `INTERACTABLE_HANDLERS` in
`client/src/systems/InteractableRegistry.ts`, keyed by kind, then tag map
objects with `kind`. The interaction system finds *what you are facing*; the
registry decides *what happens*.

### Adding a minigame (Phase 3)

Write one self-contained scene implementing `MinigameScene`, append one entry to
`shared/minigames.config.ts`. The Arcade zone places a cabinet per entry and
never learns a minigame's internals.

### Every zone boots in isolation

`ZoneScene` generates its own art and loads its own map, so any zone can be
started directly without going through `BootScene`. No monolithic scenes.

---

## Multiplayer model

**One shared definition of collision.** `shared/tilemap.ts` parses the Tiled
JSON and produces the walkability query. The client uses it for movement; the
server uses it — same function, same file — to validate every move. Phaser is
used only to *draw* the map. Two implementations of "walkable" would drift, and
the failure mode is a player walking through a wall on one screen but not the
other.

**One room type for every zone.** `ZoneRoom` is generic and reads `ZoneConfig`;
the server registers it once with `filterBy(['zoneId'])`, so clients asking for
the same zone share a room and a new zone needs no server code.

**Clients send intent, never position.** A client sends `{dir, seq}`. The server
computes the target from *its own* authoritative position, validates it, and
applies it. There is no message that carries a player-supplied coordinate, so
there is nothing to spoof — verified by a test that forces a client's local
position and watches the server overrule it.

**Prediction without rubber-banding.** The local player moves immediately, and
the server validates in parallel. The subtlety is telling "the server hasn't
processed my latest move yet" apart from "the server disagrees with me" — the
first is stale, the second is authoritative. Every intent carries a sequence
number that the server echoes as `lastSeq`, and the client only accepts a
correcting snap once the server has caught up with everything it sent.

**Remote players** tween at the same 130ms per tile as the local player so
everyone moves at one visual cadence, and snap instead of racing if an update is
missed by more than a tile (per 10).

**Zone transitions** are a room leave and a room join. The Colyseus room is left
*during* the 250ms fade rather than after it, so the network round-trip is
hidden by the transition instead of showing up as a hitch on the far side. The
arrival tile is resolved server-side from `JoinOptions.fromZone` — the server
owns position, so a client-chosen arrival point would just be overruled.

Players do **not** block each other — see the open question below.

---

## Design tokens and timings

Two files, and only two, hold tunable numbers:

- `shared/animationConfig.ts` — every duration, easing and frame rate
  (130ms tile step, 250ms zone fade, 30ms/char text reveal, …)
- `shared/designTokens.ts` — palette, spacing, typography, viewport

Nothing else in the codebase should contain a magic timing or color. Values
added beyond the specs are commented `[ADDED]` with the reason.

### Viewport

The canvas **resizes to the window** (`Phaser.Scale.RESIZE`) rather than
rendering at a fixed design resolution and letterboxing. There is therefore no
single design resolution:

- World cameras pick zoom from window **height** via `VIEWPORT.zoomFor`, so a
  wider window shows more city instead of magnifying the same slice. Zoom is
  quantized to half steps — unconstrained fractional zoom makes pixel edges
  shimmer as the camera moves.
- The UI scene lays out against the live camera size and reflows on resize.

### Art resolution

Source art is authored at **32×32 per tile** and **32×64 per character**. That
is the change that makes the world look clearer: scaling 16px art up only makes
it bigger, while four times the pixel budget lets every tile carry gradients,
edge highlights, grain and cast shadows. All of it is still generated
procedurally at runtime from `shared/designTokens.ts`.

---

## Placeholder art

All art is generated at runtime into canvas textures
(`client/src/art/placeholderArt.ts`). Asset keys in `ASSET_KEYS` are the
contract. Swapping in real art means loading a PNG under the same key in
`BootScene` and deleting the matching generator call — no scene, system or
entity changes.

Maps are **real Tiled 1.10 JSON exports** generated by
`tools/generate_placeholder_maps.py`, so hand-authored Tiled files drop in
without code changes.

---

## Persistence and accounts

Everything above the `Store` interface in `shared/persistence.ts` is written
once and does not know which implementation it is talking to. The server picks
one at boot and logs the choice:

| `DATABASE_URL` | Store | State |
|---|---|---|
| unset | `JsonStore` — file-backed at `server/.data/store.json` | **Working.** Durable across restarts |
| set | `PostgresStore` — Supabase | **Untested.** Written, never run against a real database |

`JsonStore` is not a stub: debounced, serialized writes with write-then-rename,
so a crash cannot truncate it. Study time, high scores and friendships are real
from the first run with no database at all.

### Turning on Supabase

1. Create a Supabase project.
2. Apply the schema: `psql "$DATABASE_URL" -f server/src/db/schema.sql`
   (or paste it into the SQL editor).
3. Put `DATABASE_URL` in `server/.env` and restart.

The server switches automatically. If the connection fails it falls back to the
JSON store with a loud warning rather than refusing to boot — friends should
still be able to hang out through a database outage.

**What is still missing:** real *accounts*. Identity today is a stable id
generated in `localStorage`, which is enough to accumulate study time and scores
against a person but is not a security boundary — anyone can edit their own.
Supabase Auth replaces where that id comes from; every consumer keeps working
unchanged because they only ever ask the session for an id.

---

## Arcade

Adding a minigame is three things and nothing else:

1. A scene extending `BaseMinigameScene`.
2. An entry in `shared/minigames.config.ts`.
3. A line in `client/src/scenes/minigames/registry.ts`.

The Arcade builds one cabinet per config entry at runtime and launches by scene
key; it never learns what any game does. The base class owns presentation,
Esc-to-quit, score reporting and the leaderboard, so a minigame implements only
its own rules.

**Solo games** (Memory Match, Retro Runner, Rhythm Tap) score client-side and
submit over HTTP. **Multiplayer games** (Trivia Blitz, Reaction Tap) run their
round in a Colyseus room: the server owns the secret, the clock and the scoring,
and clients receive rounds with the answer *stripped* — Reaction Tap never sends
the client the moment the light will turn, so there is nothing to read ahead.
The solo score endpoint refuses submissions for multiplayer games outright, so
that rule cannot be bypassed by posting a result.

The room owns the lobby, the clock, the phases and persistence; the *rules* live
behind a `MinigameRules` interface (`server/src/minigames/rules.ts`) that builds
a round, validates an answer and scores it. A new multiplayer game is a new
implementation of that interface, not an edit to the room.

---

## Deploying

The whole game deploys as **one service**: the server serves the client it was
built with, so there is a single origin and a single URL to send people.

That is worth insisting on, because the alternative is where deployments of this
game go wrong. A separately hosted client — Vercel, Netlify, GitHub Pages — can
never be same-origin with the game server, since none of those run a persistent
WebSocket process. So it needs a server address configured into it, and the
server needs a CORS allowlist naming the client back, and if either is missing
or stale every visitor sees `OFFLINE`. Same-origin needs neither: the client
derives `wss://` from the page it was served by. Nothing to set, nothing to keep
in step.

`tools/phase7b_single_origin.mjs` tests exactly that — it builds with
`VITE_SERVER_URL` unset, starts the server with `ALLOWED_ORIGINS` unset, and
plays two browsers against the result.

### Free options, as of September 2026

The server holds player positions, the jukebox clock and open WebSockets in
memory, so it needs a host that runs a **persistent process**. That rules out
serverless functions, and it is what makes most "free tier" lists useless here.

| Host | Free? | Good to know |
|---|---|---|
| **[Render](https://render.com/docs/free)** — *recommended* | Yes, ongoing | 512 MB, 750 instance-hours/month. Sleeps after 15 min with no traffic and takes ~1 min to wake. No persistent disk on free. `render.yaml` in this repo deploys it. |
| [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) | Yes, ongoing | A real always-on VM, so no sleeping — the only free option that stays warm. Costs you a card at signup and an afternoon of Linux setup; no config in this repo. |
| [Railway](https://docs.railway.com/pricing/plans) | Trial only | $5 one-time credit, then a Free plan capped at $1/month of usage. Realistically $5/month Hobby. Detects the `Dockerfile`. |
| [Fly.io](https://fly.io/docs/about/cost-management/) | No | The free allowances ended in 2024; new accounts get a short trial. `fly.toml` is here if you are paying — it is the only config with a persistent volume. |
| [Koyeb](https://www.koyeb.com/docs/faqs/pricing) | Closed | The free tier stopped taking new users after the February 2026 Mistral acquisition. |
| Vercel / Netlify / Pages | Client only | Cannot run the game server at all. See [Two origins](#two-origins-a-static-client-and-a-server-elsewhere) if you want to use one anyway. |

**About the sleeping.** Render's 15 minutes counts *all* traffic, including
WebSocket messages from connections already open — and this game sends movement
constantly — so a town with anyone in it does not fall asleep underneath them.
It sleeps overnight, and the first person to arrive next morning waits about a
minute. If the socket does not come up in time the game drops to single-player
and says `OFFLINE`; a reload once the service is awake puts them in the town.
The honest fix is not a paid plan but a pinger, and the honest description of a
pinger is that it burns your 750 monthly hours to keep an empty town warm.

### Render, start to finish

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. **Apply**. First build takes a few minutes.
4. Open the `https://the-commons-*.onrender.com` URL it gives you. Send that
   link to whoever you want in the town.

There is nothing to configure afterwards. No environment variables, no CORS, no
second deployment for the client — that is the whole point of the one-service
shape. Two optional variables are declared in the blueprint and can stay unset:

- `DATABASE_URL` — a free web service has **no persistent disk**, so without a
  database the high scores and study minutes live on a filesystem that is wiped
  on every deploy and every sleep. A free Render Postgres fixes that, and
  [expires 30 days after creation](https://render.com/docs/free).
- `ALLOWED_ORIGINS` — only for a cross-origin client, below. The client this
  service serves itself is same-origin and is never subject to CORS.

### Any host that takes a Dockerfile

The `Dockerfile` builds the same one-service image: a builder stage compiles the
client bundle, and the runtime stage runs the game server with that bundle
already inside it.

```bash
docker build -t the-commons .
docker run -p 2567:2567 the-commons     # http://localhost:2567
```

Railway, Fly and Koyeb all take it as-is. See
[What is NOT verified](#what-is-not-verified) before you trust it.

### Playing with friends today, without hosting anything

```bash
npm run serve     # builds the client, then serves game + client on :2567
npm run share     # opens a public https:// URL that forwards to :2567
```

`share` opens an SSH reverse tunnel to localhost.run — no account, no signup.
It prints an `https://….lhr.life` URL; send that to a friend and you are playing
together. Same single origin as a real deployment, so nothing needs configuring.

Understand what this is before using it:

- **It exposes the server on your machine to the public internet.** Anyone with
  the link can join, and the link is guessable-ish. Only share it with people
  you want in the room.
- It lasts only while that terminal stays open, and the URL changes each time.
- Everything runs on your machine, so when you close it, the town closes.

That makes it right for "let's hang out this evening" and wrong for something
you want up permanently.

### Two origins: a static client and a server elsewhere

If you want the client on Vercel or GitHub Pages anyway — a CDN edge near your
players, or a domain you already have — the client can be pointed at a server at
runtime, so this no longer requires a rebuild per server:

- Click **OFFLINE — click to connect** in the top right and paste the server's
  address. It is remembered, so this happens once per browser.
- Or share a link with it already in:
  `https://your-client.vercel.app/?server=https://your-server.onrender.com`
- Either `https://` or `wss://` is understood; the scheme is converted for you.

Two things have to be true and both are easy to miss:

1. **The address must end up `wss://`, not `ws://`.** The page is HTTPS, so a
   plaintext WebSocket is blocked as mixed content before it is attempted. The
   paste box handles this; a hand-built `VITE_SERVER_URL` does not.
2. **`ALLOWED_ORIGINS` on the server must name the client's origin**, comma
   separated, no trailing slash. Now the request *is* cross-origin.

`VITE_SERVER_URL` still works and still wins over the page's own origin, for a
build that knows its server in advance. It is a convenience now rather than a
requirement — it used to be the only mechanism, which meant a bundle built
without it silently told every visitor to connect to their own machine, and that
is exactly what the first deployment of this game did.

Vercel is configured in its dashboard rather than with a committed
`vercel.json`, because a checked-in config silently overrides dashboard settings
when it lands at the deployment root:

| Setting | Value |
|---|---|
| Root Directory | the repo root, **not** `client/` |
| Build Command | `npm run build --workspace client` |
| Output Directory | `client/dist` |
| Environment | `VITE_SERVER_URL = wss://your-server-host` (optional) |

Root Directory has to be the repo root because the build resolves
`@commons/shared` through the workspace and takes its `publicDir` from the
repo-level `assets/` folder — the maps and tilesets live outside `client/` so
the server can read the same map JSON for authoritative collision.

### Environment variables

All optional. The one-service deploy needs none of them.

| Variable | Meaning |
|---|---|
| `PORT` | Set by the host. Defaults to 2567. |
| `ALLOWED_ORIGINS` | Comma-separated browser origins, no trailing slash. Only relevant to a cross-origin client. **Unset means any site may call your server** — the server warns about this at boot in production rather than locking down silently, because a first deploy that fails closed looks like a bug in the game. |
| `DATABASE_URL` | Postgres. Without it the JSON store is used. |
| `DATA_DIR` | Where the JSON store writes. Point it at a mounted volume, or scores and study time reset on every deploy. Render's free tier has no volume to point it at. |
| `CLIENT_DIST` | Where the built client lives. Defaults to `client/dist`; the server serves API-only if that folder is absent, which is what happens when you run it next to the Vite dev server. |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Voice transport. Unset means the mic reports unavailable, which is the current state. |

### What is NOT verified

The `Dockerfile` has never been built: Docker is not installed on the machine
this was developed on, and it says so at the top of the file. Everything it does
is tested by other means — `phase7b_single_origin.mjs` runs the same client
build and the same start command and plays two browsers against the result — but
the image build itself is not. Treat your first `docker build` as the test.

`render.yaml` and `fly.toml` are written from the providers' documented schemas
and have not been run against those providers. The commands inside `render.yaml`
have been run: they are the ones the test suite uses, and they were checked once
more from a clean checkout with no `node_modules` and `NODE_ENV=production` set,
which is the state a host builds in.

## Cosmetics

06 asks for "high scores or milestones [to] unlock cosmetic character
customization (hat, outfit colour)". Two things in that sentence shape the
whole implementation.

**Cosmetic only.** Nothing unlocked changes what a player can do. 11's first
pillar is presence over performance, so an unlock that touched movement, study
tracking or minigame odds would quietly turn a hangout into a progression game.

**Not a grind.** Thresholds are reachable in a session or two. There is no
currency, no streak, no daily anything, and one of the three hats is earned by
study time rather than by scoring — so the Arcade is not the only thing that
gives something back.

Unlocks are **derived, never stored**. Given a player's best scores, play count
and study minutes, the set of unlocked cosmetics is a pure function
(`shared/cosmetics.ts`). Tuning a threshold needs no migration, and there is no
"owned" list that can disagree with the facts. The server owns the facts and
serves them from `/progress/:userId`; the client applies the rules, which is
safe precisely because the stakes are cosmetic — the worst a tampered client
achieves is wearing a colour it did not earn.

Adding a cosmetic is one entry in `COSMETICS`. Hats name a `style` there rather
than the renderer switching on an id, so the character art never learns about
specific cosmetics:

```ts
{ id: 'hat_cap', slot: 'hat', displayName: 'Cap', color: '#E8613C',
  style: 'cap', requirement: { kind: 'plays', count: 5 } }
```

Character sheets are generated per outfit-and-hat combination and cached by
that combination, so re-picking something you have worn before costs nothing.
Hats are drawn entirely above the eye row in every direction: which way someone
is facing is load-bearing information in a grid game, and no cosmetic is allowed
to cost the player that.

## Music and voice

### Jukebox — working

One queue per **room**, not per player. The server owns the queue *and the
clock*: it records when the current track started, and each client derives its
own offset from that. Someone arriving halfway through lands on the same bar as
everyone already there, which is the whole point of listening together rather
than each person hearing their own copy.

Skip is a **vote**, not a button — one person silencing a track the room is
listening to is exactly the shared-state problem worth avoiding.

The music is **synthesised in the browser** from track parameters, the same way
the tilesets are generated. There is no audio in this repo and licensed tracks
could not be invented. That choice also buys the property the feature needs: a
generated track is deterministic and seekable by arithmetic, so joining
mid-track is exact. Giving a `Track` an `audioUrl` swaps in real audio without
touching the sync model or the UI.

### Voice — policy working, transport unverified

The **mute policy** is built and tested: the Library defaults muted, the Cafe
defaults on, applied automatically on arrival — zoning by walking in rather than
by a settings toggle — with a manual override (`M`) that always wins and
persists per zone.

The **transport** has never carried audio. LiveKit needs credentials that were
not available. The client asks the server for a token and hands it to the
provider SDK; with no credentials the server reports `not_configured` and the
HUD says `MIC — not set up` rather than showing a mic button that silently does
nothing. "muted", "blocked" and "not set up" are different situations and read
as such.

Token requests are **not** unauthenticated: the caller must prove they are a
current member of the Colyseus room they are asking about, and the identity on
the token comes from that room's own record of them rather than from the
request body.

To turn it on, set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` in
`server/.env` and restart.

---

## Where the config claim leaked

Adding two zones and two cabinets touched exactly the files the architecture
says it should: `zones.config.ts`, `minigames.config.ts`, two scene files, two
registry lines, two map builders. No engine file changed to accommodate them.

Three things did leak, and all three were the same bug wearing different hats —
**a list of valid values restated somewhere the compiler could not check it**:

| Where | What happened |
|---|---|
| `tools/verify_maps.mjs` | Kept its own copy of the zone ids. Every door into a new zone failed verification until that copy was updated. Now read out of `zones.config.ts`. |
| `shared/tilemap.ts` | `INTERACTABLE_KINDS` was typed `readonly InteractableKind[]`, which a *subset* satisfies. Adding `drink_counter` to the union left the array stale, and every cafe counter was silently dropped at parse time — no error, no warning, just no counter. Now a `Record<InteractableKind, true>`, so a missing key fails the build. |
| `client/src/scenes/BootScene.ts` | Builds art step by step and had to be told about the new drink sprites. `generateAllPlaceholderArt()` covers isolation-booted zones, which masks the omission everywhere except the real boot path — the same trap as Phase 2. |
| Three older test suites | Asserted literal counts — "12 interactables", "all five minigames have a cabinet". Adding to the world broke tests that were checking a number rather than a property. All three now read the expected set from config; the cabinet one had already gone stale once in Phase 5 and was fixed by bumping 2 to 5, which is why it broke again. |

The lesson is narrow and worth keeping: config-driven only holds if the *set of
valid things* has exactly one definition. A second copy typed loosely enough to
accept a subset is worse than no check at all, because it fails silently.

## Known deviations from the specs

Flagged rather than made silently:

| Spec | Deviation | Why |
|---|---|---|
| 09: `ts-node-dev` | Using `tsx` | Avoids ESM + tsconfig path-mapping friction resolving `@commons/shared` |
| 09: `client/public/` | Vite `publicDir` points at repo-root `assets/` | The server needs the same map JSON for authoritative collision in Phase 1; duplicating guarantees drift |
| **07 + 11: art direction** | **Higher-resolution modern city instead of GBA pixel art** | **Requested.** Tiles authored at 32×32 (4× the pixels), cooler contemporary palette, glass-and-concrete buildings, paved plaza with a fountain and street furniture |
| **11: `tileDisplayScale`** | **1, with camera zoom derived from window height** | Art is authored at final resolution; zoom now adapts to the window so a bigger screen shows more city rather than a magnified slice |
| **Scale mode** | **RESIZE, canvas fills the window** | FIT letterboxes on any window that isn't the design aspect ratio; black bars don't read as a modern game |
| 10: bump timing | 60ms yoyo (60 out + 60 back) | Reading of "60ms nudge, then spring back" |
| 04/10 | Added `turnInPlaceMs: 60` | Tap-to-turn is core FireRed feel; spec only covered turning while blocked |
| 10: zone fade hold | Added `holdMs: 80` | Spec says "brief hold" without a number |
| 04: facing cue | Eyes rather than an arrow | Spec permits "colored rectangle + directional arrow"; eyes read better at 16×32 |
| 05 | Players don't collide with each other | Not specified either way. Blocking is grief-able in a hangout game and can trap someone in a doorway; flagged as an open question |
| 08: Phase 3 | Real accounts not delivered | Supabase needs credentials that were not available. Built against a `Store` interface so switching is config, not a refactor |
| 02: Postgres | `PostgresStore` is untested | No database was available; the JSON store is exercised by the suites instead. Flagged at the top of the file |
| 08: Phase 4 | Voice transport unverified | LiveKit needs credentials. The mute policy, token endpoint and UI states are built and tested; the audio path is not |
| 03: curated playlist | Music is synthesised, not licensed audio | No audio in the repo and licensed tracks cannot be invented. Also makes mid-track joins exact |

## Tooling gaps

No testing/QA, design-system or docs-generation skill was available in this
environment that fits a Phaser canvas game — the installed design skills target
HTML/CSS/React surfaces. UI is implemented directly from
[07_ART_STYLE_UI_UX.md](07_ART_STYLE_UI_UX.md) and
[10_ANIMATION_SPEC.md](10_ANIMATION_SPEC.md), this README is hand-maintained,
so multiplayer sync is tested with a bespoke Playwright harness
(`tools/phase1_sync.mjs`) that drives two real browser contexts against a real
server and compares each client's view of the other against that other client's
own state.
