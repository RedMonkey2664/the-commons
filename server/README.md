# server

Colyseus game server. **Not implemented yet — this is Phase 1 of the roadmap.**

The package manifest, tsconfig, and folder structure are scaffolded so Phase 1
starts by writing rooms rather than fighting build config. `src/` is
deliberately empty: an empty `index.ts` that boots nothing would imply a server
exists when it does not.

Phase 1 lands `src/index.ts`, `src/rooms/ZoneRoom.ts` (one generic,
config-driven room type serving every zone) and `src/schemas/PlayerState.ts`.

Note: `tsx` replaces the spec's `ts-node-dev` — same watch-and-reload behaviour,
without the ESM + tsconfig path-mapping friction of resolving `@commons/shared`.
