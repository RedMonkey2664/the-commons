# 06 — Arcade & Minigames

## Design goal

The arcade is the one zone with real mechanical stakes (scores, competition)
— everywhere else is ambient. It should be genuinely fun in short bursts
(2-5 minutes), because that's how people actually use an arcade cabinet in
real life: quick break, not a session commitment.

## Pluggable minigame architecture (ties back to 02)

Every minigame is:
1. An entry in `minigames.config.ts` (id, display name, cabinet sprite,
   scene key, player count range).
2. A self-contained Phaser Scene implementing a shared interface:

```typescript
interface MinigameScene {
  onStart(players: PlayerRef[]): void;
  onEnd(): void;
  reportScore(playerId: string, score: number): void; // → server persists
}
```

The Arcade zone scene never contains minigame logic itself — it just reads
the config, places a cabinet sprite per entry, and on interact, launches
the matching scene by key. Adding minigame #5 means writing one new scene
file and one new config entry — nothing else in the codebase changes. This
is the extensibility requirement from your original ask, applied concretely.

## Suggested launch set (build in this order — increasing complexity)

1. **Memory Match** (solo) — flip-tile pairs game, simplest possible build,
   good first minigame to prove the plugin pattern end-to-end.
2. **Trivia Blitz** (1-4 players, same-room) — timed multiple choice
   questions, could later pull from a study-relevant question bank (nice
   thematic tie-in: trivia about whatever your friend group is studying).
3. **Reaction Tap** (1-4 players, same-room) — classic "tap when the light
   turns green" reflex test, simple to build, naturally competitive/funny
   in a group.
4. **Retro Runner** (solo) — simple endless side-scroller/obstacle-dodge,
   more build effort, good "flagship" cabinet once the pattern is proven.
5. **Rhythm Tap** (solo, later) — ties back into the music theme of the
   whole game (jukebox tracks double as rhythm-game tracks) — nice full-
   circle feature once the jukebox system exists.

## Scoring & leaderboards

- Each cabinet has a persisted high-score table (top 10, per user's best
  score) stored in Postgres.
- Leaderboard shown in-cabinet on interact before starting, and after a run
  ends.
- Optional friend-filtered leaderboard view (just your friends' scores) —
  more socially meaningful than a global leaderboard for a small-group
  product like this.

## Multiplayer minigames specifically

- For same-room minigames (Trivia Blitz, Reaction Tap), the arcade cabinet
  interaction opens a short "waiting for players" lobby state before
  starting, so friends standing nearby can join before the round begins.
- Keep multiplayer minigame state server-authoritative same as world
  movement — scores and round outcomes are computed server-side, not
  trusted from clients.

## Cosmetic rewards (optional, cheap addition)

- High scores or milestones (e.g. "played 10 rounds") could unlock cosmetic
  character customization (hat, outfit color) — gives the arcade a reason
  to be revisited without turning the whole game into a grind economy.
  This is explicitly optional/later, not core.
