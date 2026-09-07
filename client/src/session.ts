/**
 * Local session identity.
 *
 * Phase 1 holds a typed-in name and a sprite choice. Phase 3 replaces the
 * SOURCE of these values with Supabase auth without changing this shape, so
 * nothing downstream needs to know whether you're a real account or a name
 * typed at a title screen.
 */

import { ASSET_KEYS } from './art/placeholderArt';

const STORAGE_KEY = 'commons.session';

interface StoredSession {
  displayName?: string;
  spriteKey?: string;
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

  /** True once the player has been through name entry. */
  get isIdentified(): boolean {
    return typeof this.state.displayName === 'string' && this.state.displayName.length > 0;
  }
}

export const session = new Session();
