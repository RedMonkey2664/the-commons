/**
 * Local session identity.
 *
 * Phase 1 holds a typed-in name and a sprite choice. Phase 3 replaces the
 * SOURCE of these values with Supabase auth without changing this shape, so
 * nothing downstream needs to know whether you're a real account or a name
 * typed at a title screen.
 */

import { ASSET_KEYS } from './art/placeholderArt';
import { resolveServerUrl } from './systems/NetworkClient';

const STORAGE_KEY = 'commons.session';

interface StoredSession {
  displayName?: string;
  spriteKey?: string;
  /** Stable across sessions on this browser. See Session.userId. */
  userId?: string;
  /** Per-zone manual mic overrides. See Session.voiceOverride. */
  voiceOverrides?: Record<string, boolean>;
  /** Chosen cosmetics, by slot. See Session.cosmetic. */
  cosmetics?: Record<string, string>;
}

function read(): StoredSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : {};
  } catch {
    // Private windows and blocked site data both throw here; a session that
    // doesn't persist is fine, one that crashes the boot is not.
    return {};
  }
}

function write(value: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* not persisting is acceptable */
  }
}

class Session {
  private state: StoredSession = read();

  get displayName(): string | undefined {
    return this.state.displayName;
  }

  set displayName(value: string | undefined) {
    this.state = { ...this.state, displayName: value };
    write(this.state);
  }

  get spriteKey(): string {
    return this.state.spriteKey ?? ASSET_KEYS.playerSheet;
  }

  set spriteKey(value: string) {
    this.state = { ...this.state, spriteKey: value };
    write(this.state);
  }

  /**
   * Stable identity for persistence.
   *
   * Study time and high scores must accumulate against a person, not a socket,
   * so this is generated once and kept. It is NOT a security boundary — anyone
   * can edit their own localStorage. Supabase auth in a later pass replaces
   * where this value comes from; every consumer keeps working unchanged
   * because they only ever asked the session for an id.
   */
  get userId(): string {
    if (!this.state.userId) {
      const id = `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      this.state = { ...this.state, userId: id };
      write(this.state);
    }
    return this.state.userId!;
  }

  /**
   * Where the game server lives.
   *
   * Delegates rather than reimplementing. This getter used to carry its own
   * copy of the resolution rules, and since minigames, the score client and the
   * voice client all read it, the copy here was in practice the one that
   * mattered — so improving the rules in NetworkClient changed nothing for most
   * of the game. One definition, in NetworkClient.resolveServerUrl.
   */
  get serverUrl(): string {
    return resolveServerUrl();
  }

  /**
   * Manual microphone override for a zone, or undefined to follow the zone
   * default (05, 11).
   *
   * Kept HERE rather than on VoiceClient because a VoiceClient is built fresh
   * every time a zone scene is created — so an override stored on it vanished
   * the moment you walked out of the room and back in, which is exactly the
   * "defaults trapping someone" behaviour the override exists to prevent.
   * As a player preference it also rightly survives a reload.
   */
  voiceOverride(zoneId: string): boolean | undefined {
    return this.state.voiceOverrides?.[zoneId];
  }

  setVoiceOverride(zoneId: string, muted: boolean): void {
    this.state = {
      ...this.state,
      voiceOverrides: { ...(this.state.voiceOverrides ?? {}), [zoneId]: muted },
    };
    write(this.state);
  }

  /**
   * Chosen cosmetic for a slot (06).
   *
   * Stored locally because it is cosmetic-only — the worst a tampered client
   * achieves is wearing a colour it has not unlocked, which harms nobody. The
   * FACTS that unlock cosmetics (scores, study time) are server-held; only the
   * preference lives here.
   */
  cosmetic(slot: string): string | undefined {
    return this.state.cosmetics?.[slot];
  }

  /** Pass `undefined` to clear the slot — a hat has to be removable. */
  setCosmetic(slot: string, id: string | undefined): void {
    const cosmetics = { ...(this.state.cosmetics ?? {}) };
    if (id === undefined) delete cosmetics[slot];
    else cosmetics[slot] = id;

    this.state = { ...this.state, cosmetics };
    write(this.state);
  }

  /** True once the player has been through name entry. */
  get isIdentified(): boolean {
    return typeof this.state.displayName === 'string' && this.state.displayName.length > 0;
  }
}

export const session = new Session();
