/**
 * World progression — the one place that knows how far the player has come.
 *
 *   FocusTimer ──(session ends)──> server writes the session
 *                                        │
 *                                        ▼
 *                     Progression.refresh() reads the server total
 *                                        │
 *              ┌──────────────┬──────────┴──────────┬────────────────┐
 *              ▼              ▼                     ▼                ▼
 *       progressChanged  focusTimeAdded       worldUnlocked    rocketAvailable
 *
 * THE NUMBER IS THE SERVER'S. Total focus time is the sum of recorded study
 * sessions, and those are timed by the server from sit to stand with paused
 * stretches subtracted. This module never adds seconds of its own, never counts
 * menus or animation, and never derives progress from a clock — it re-reads
 * the persisted total after a session is written. There is exactly one source
 * of truth, and this is its reader, not a second copy.
 *
 * The two pieces of LOCAL state are preferences, not statistics: which world
 * you are currently in, and which unlocks you have already been congratulated
 * on. Losing either loses nothing earned.
 *
 * DEVELOPER SIMULATION is a separate, in-memory overlay. It replaces the total
 * for display and unlock purposes and is never persisted, never sent anywhere,
 * and never mixed into the real figure. The moment it is cleared, everything
 * reads the real total again as though it had never happened. It only exists
 * when import.meta.env.DEV is true, which Vite replaces with `false` in a
 * production build — so in production the simulation branch is dead code.
 */

import Phaser from 'phaser';
import {
  WORLD_PROGRESS_CONFIG,
  SECONDS_PER_HOUR,
  getWorld,
  isWorldUnlocked,
  requiredSeconds,
  worldProgress,
  type WorldDefinition,
  type WorldId,
  type WorldProgress,
} from '@commons/shared';
import { fetchStudyTotals } from './scoreClient';

export const PROGRESSION_EVENTS = {
  /** (addedSeconds: number, totalSeconds: number) — a session was recorded. */
  focusTimeAdded: 'focusTimeAdded',
  /** (progress: WorldProgress) — any change to the total or the current world. */
  progressChanged: 'progressChanged',
  /** (world: WorldDefinition) — a world opened that has not been celebrated yet. */
  worldUnlocked: 'worldUnlocked',
  /** (destination: WorldDefinition) — the rocket has somewhere new to go. */
  rocketAvailable: 'rocketAvailable',
  /** (from: WorldDefinition, to: WorldDefinition) */
  rocketLaunched: 'rocketLaunched',
  /** (world: WorldDefinition) */
  worldEntered: 'worldEntered',
  /** () — developer reset of SIMULATED progression only. */
  progressionReset: 'progressionReset',
} as const;

/** True only in `vite dev`. Vite compiles this to `false` for production. */
export const DEV_MODE: boolean = import.meta.env.DEV;

const STORAGE_KEY = 'commons.progression';

interface LocalProgression {
  currentWorld?: WorldId;
  /** Unlocks already shown to the player, so each is celebrated exactly once. */
  celebrated?: WorldId[];
}

function readLocal(): LocalProgression {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalProgression) : {};
  } catch {
    return {};
  }
}

function writeLocal(value: LocalProgression): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* a preference that does not persist is acceptable */
  }
}

export interface SessionResult {
  /** Focus seconds this session added to the persisted total. */
  added: number;
  total: number;
  /** Worlds that this session opened. */
  unlocked: WorldDefinition[];
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class Progression extends Phaser.Events.EventEmitter {
  private real = { totalSeconds: 0, sessionCount: 0, todaySeconds: 0, longestSeconds: 0 };
  private reachable = false;

  /** Persisted preferences. Untouched while a simulation is running. */
  private local: LocalProgression = readLocal();

  /**
   * DEV ONLY. When set, stands in for the real total everywhere progression is
   * shown or checked. Paired with its own preference copy so that travelling
   * between simulated worlds cannot rewrite the real player's current world or
   * mark their real unlocks as already celebrated.
   */
  private simulatedSeconds: number | null = null;
  private simLocal: LocalProgression = {};

  // -- reading -----------------------------------------------------------------

  get isSimulated(): boolean {
    return this.simulatedSeconds !== null;
  }

  /** The persisted total from the server. Never affected by simulation. */
  get realFocusSeconds(): number {
    return this.real.totalSeconds;
  }

  /** What every progression surface shows and unlocks against. */
  get focusSeconds(): number {
    return this.simulatedSeconds ?? this.real.totalSeconds;
  }

  get sessionCount(): number {
    return this.real.sessionCount;
  }

  get todaySeconds(): number {
    return this.real.todaySeconds;
  }

  get longestSeconds(): number {
    return this.real.longestSeconds;
  }

  /** False when the server could not be reached; the UI says so rather than showing zeros as fact. */
  get isReachable(): boolean {
    return this.reachable;
  }

  get progress(): WorldProgress {
    return worldProgress(this.focusSeconds);
  }

  /** Which preferences are live: the real ones, or the simulation's scratch copy. */
  private get prefs(): LocalProgression {
    return this.isSimulated ? this.simLocal : this.local;
  }

  /**
   * The world the player is in. Always one they have actually unlocked — a
   * stored preference pointing at a world the current total does not reach
   * (an ended simulation, a reset server) falls back to home.
   */
  get currentWorld(): WorldDefinition {
    const stored = this.prefs.currentWorld ? getWorld(this.prefs.currentWorld) : undefined;
    if (stored && isWorldUnlocked(stored, this.focusSeconds)) return stored;
    return WORLD_PROGRESS_CONFIG[0] as WorldDefinition;
  }

  /** The next unlocked world beyond the current one — where the rocket goes. */
  get destination(): WorldDefinition | undefined {
    const index = WORLD_PROGRESS_CONFIG.findIndex((w) => w.id === this.currentWorld.id);
    return WORLD_PROGRESS_CONFIG.slice(index + 1).find((w) => isWorldUnlocked(w, this.focusSeconds));
  }

  get rocketReady(): boolean {
    return this.destination !== undefined;
  }

  /** Worlds unlocked but not yet visited, so the map can make them glow. */
  isFresh(world: WorldDefinition): boolean {
    return isWorldUnlocked(world, this.focusSeconds) && !(this.prefs.celebrated ?? []).includes(world.id)
      && world.requiredFocusHours > 0;
  }

  // -- updating ----------------------------------------------------------------

  /** Re-read the persisted total. Safe offline: it just reports unreachable. */
  async refresh(): Promise<void> {
    const totals = await fetchStudyTotals();
    if (!totals) {
      this.reachable = false;
      this.emit(PROGRESSION_EVENTS.progressChanged, this.progress);
      return;
    }

    this.reachable = true;
    this.real = {
      totalSeconds: totals.totalSeconds,
      sessionCount: totals.sessionCount,
      todaySeconds: totals.todaySeconds ?? 0,
      longestSeconds: totals.longestSeconds ?? 0,
    };
    this.announce();
  }

  /**
   * A focus session just ended. Wait for the server to have written it, then
   * report what it was worth.
   *
   * The server writes on stand-up, asynchronously, so this polls a few times
   * for the total to move rather than trusting a figure the client computed —
   * the whole point is that the client's clock is not the record.
   */
  async sessionEnded(): Promise<SessionResult> {
    const before = this.realFocusSeconds;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(attempt === 0 ? 350 : 500);
      await this.refresh();
      if (this.realFocusSeconds > before) break;
    }

    const added = Math.max(0, this.realFocusSeconds - before);
    const unlocked = WORLD_PROGRESS_CONFIG.filter(
      (w) => !isWorldUnlocked(w, before) && isWorldUnlocked(w, this.realFocusSeconds),
    );

    if (added > 0) this.emit(PROGRESSION_EVENTS.focusTimeAdded, added, this.realFocusSeconds);
    return { added, total: this.realFocusSeconds, unlocked };
  }

  /**
   * Travel. Only to an unlocked world — in DEV the caller may pass `bypass` to
   * explore anything, which is what the developer panel's world buttons do.
   */
  enterWorld(id: WorldId, bypass = false): boolean {
    const world = getWorld(id);
    if (!world) return false;
    if (!isWorldUnlocked(world, this.focusSeconds) && !(DEV_MODE && bypass)) return false;

    // A bypass visit to a locked world is a simulation by definition: it must
    // not persist, or the real player would wake up somewhere they never earned.
    if (!isWorldUnlocked(world, this.focusSeconds) && this.simulatedSeconds === null) {
      this.simulatedSeconds = requiredSeconds(world);
      this.simLocal = { ...this.local };
    }

    this.setPref({ currentWorld: world.id, celebrated: this.withCelebrated(world.id) });
    this.emit(PROGRESSION_EVENTS.worldEntered, world);
    this.emit(PROGRESSION_EVENTS.progressChanged, this.progress);
    return true;
  }

  /** Called by the world map as the launch begins. */
  noteLaunch(to: WorldDefinition): void {
    this.emit(PROGRESSION_EVENTS.rocketLaunched, this.currentWorld, to);
  }

  // -- developer simulation (DEV builds only) ----------------------------------

  /** Pretend the total is this many hours. Never written, never sent. */
  simulateHours(hours: number): void {
    if (!DEV_MODE) return;
    const before = this.focusSeconds;
    if (this.simulatedSeconds === null) this.simLocal = { ...this.local };
    this.simulatedSeconds = Math.max(0, hours) * SECONDS_PER_HOUR;
    this.announce(before);
  }

  addSimulatedHours(hours: number): void {
    if (!DEV_MODE) return;
    this.simulateHours(this.focusSeconds / SECONDS_PER_HOUR + hours);
  }

  unlockNextWorld(): void {
    const next = this.progress.next;
    if (next) this.simulateHours(next.requiredFocusHours);
  }

  unlockAllWorlds(): void {
    const last = WORLD_PROGRESS_CONFIG[WORLD_PROGRESS_CONFIG.length - 1];
    if (last) this.simulateHours(last.requiredFocusHours);
  }

  /**
   * Reset SIMULATED progression back to a fresh zero-hour player.
   *
   * Deliberately cannot touch the real total or the real preferences: "reset"
   * in a developer panel is exactly the button that gets pressed by accident.
   */
  resetSimulation(): void {
    if (!DEV_MODE) return;
    this.simulatedSeconds = 0;
    this.simLocal = {};
    this.emit(PROGRESSION_EVENTS.progressionReset);
    this.emit(PROGRESSION_EVENTS.progressChanged, this.progress);
  }

  /** Back to real data, as though the simulation never happened. */
  endSimulation(): void {
    if (!DEV_MODE) return;
    this.simulatedSeconds = null;
    this.simLocal = {};
    this.emit(PROGRESSION_EVENTS.progressChanged, this.progress);
  }

  // -- internals ----------------------------------------------------------------

  /**
   * Emit the change, and celebrate any unlock not yet celebrated.
   *
   * "Not yet celebrated" rather than "crossed since last read": a player whose
   * threshold was crossed while this tab was closed must still get the moment,
   * and one who has seen it must not get it again on every page load.
   */
  private announce(before?: number): void {
    const celebrated = new Set(this.prefs.celebrated ?? []);

    const fresh = WORLD_PROGRESS_CONFIG.filter(
      (w) => w.requiredFocusHours > 0 && isWorldUnlocked(w, this.focusSeconds) && !celebrated.has(w.id),
    );

    // During a simulation, only worlds this change newly crossed are fresh —
    // otherwise jumping to 50h fires five banners at once.
    const toCelebrate = before !== undefined
      ? fresh.filter((w) => !isWorldUnlocked(w, before))
      : fresh;

    this.emit(PROGRESSION_EVENTS.progressChanged, this.progress);

    for (const world of toCelebrate) this.emit(PROGRESSION_EVENTS.worldUnlocked, world);
    const destination = this.destination;
    if (toCelebrate.length > 0 && destination) this.emit(PROGRESSION_EVENTS.rocketAvailable, destination);
  }

  /** Mark an unlock as shown. The world map calls this once it has been seen. */
  markCelebrated(id: WorldId): void {
    this.setPref({ celebrated: this.withCelebrated(id) });
  }

  private withCelebrated(id: WorldId): WorldId[] {
    const list = new Set(this.prefs.celebrated ?? []);
    list.add(id);
    return [...list];
  }

  private setPref(patch: Partial<LocalProgression>): void {
    if (this.isSimulated) {
      this.simLocal = { ...this.simLocal, ...patch };
      return;
    }
    this.local = { ...this.local, ...patch };
    writeLocal(this.local);
  }
}

/** One per page. Progression is a property of the player, not of a scene. */
export const progression = new Progression();
