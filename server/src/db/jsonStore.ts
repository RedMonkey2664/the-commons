/**
 * File-backed store — the default when no DATABASE_URL is configured.
 *
 * This is not a stub. It implements the full Store contract and survives server
 * restarts, so study time, high scores and friendships are real from the first
 * run. 02 specifies Postgres via Supabase for production; this exists so the
 * features that depend on persistence can be built, tested and played before
 * anyone has provisioned a database, and so swapping to Postgres later changes
 * one line of boot config rather than every caller.
 *
 * Writes are debounced and serialized: a busy arcade should not fsync on every
 * flip of a card, and two concurrent writes must not interleave into a
 * half-written file.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FriendshipStatus,
  HighScore,
  ScoreResult,
  Store,
  StudySession,
  StudyTotals,
  UserRecord,
} from '@commons/shared';
import { MAX_STUDY_SECONDS, MIN_STUDY_SECONDS } from '@commons/shared';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Where the JSON store lives.
 *
 * DATA_DIR exists so a deployed server can point this at a mounted volume.
 * Without one, most hosts give a container an ephemeral filesystem and every
 * deploy silently resets scores and study time — which looks like data loss
 * rather than a configuration choice.
 */
const DEFAULT_PATH = process.env['DATA_DIR']
  ? resolve(process.env['DATA_DIR'], 'store.json')
  : resolve(here, '..', '..', '.data', 'store.json');

interface Snapshot {
  version: 1;
  users: Record<string, UserRecord>;
  /** "userId->friendId" edges, one row per direction. */
  friends: Record<string, { userId: string; friendId: string; status: FriendshipStatus; createdAt: string }>;
  study: StudySession[];
  scores: HighScore[];
}

function emptySnapshot(): Snapshot {
  return { version: 1, users: {}, friends: {}, study: [], scores: [] };
}

const edgeKey = (a: string, b: string) => `${a}->${b}`;

export class JsonStore implements Store {
  readonly kind = 'json' as const;

  private data: Snapshot = emptySnapshot();
  private writeTimer?: NodeJS.Timeout;
  /** Serializes writes so two flushes never interleave. */
  private writing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly path: string = DEFAULT_PATH) {}

  async init(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Snapshot;
      // A corrupt or older file should not take the server down; starting
      // fresh loses data but keeps the game playable, and the file is kept.
      this.data = parsed?.version === 1 ? { ...emptySnapshot(), ...parsed } : emptySnapshot();
    } catch {
      this.data = emptySnapshot();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    await this.flush();
  }

  // -- persistence ---------------------------------------------------------

  /** Debounced: many small changes collapse into one disk write. */
  private schedule(): void {
    if (this.closed || this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.flush();
    }, 400);
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 1);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      // Write-then-rename, so a crash mid-write cannot truncate the real file.
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.path);
    }).catch((error: unknown) => {
      console.warn('[db] failed to persist store:', (error as Error).message);
    });
    return this.writing;
  }

  // -- users ---------------------------------------------------------------

  async upsertUser(user: Pick<UserRecord, 'id' | 'displayName' | 'spriteKey'>): Promise<UserRecord> {
    const existing = this.data.users[user.id];
    const record: UserRecord = {
      id: user.id,
      displayName: user.displayName,
      spriteKey: user.spriteKey,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.data.users[user.id] = record;
    this.schedule();
    return record;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.data.users[id] ?? null;
  }

  async findUserByName(displayName: string): Promise<UserRecord | null> {
    const needle = displayName.trim().toLowerCase();
    return (
      Object.values(this.data.users).find((u) => u.displayName.toLowerCase() === needle) ?? null
    );
  }

  // -- friends -------------------------------------------------------------

  async requestFriend(userId: string, friendId: string): Promise<FriendshipStatus> {
    if (userId === friendId) return 'pending';

    const reverse = this.data.friends[edgeKey(friendId, userId)];
    const now = new Date().toISOString();

    // They already asked us: requesting back completes the mutual accept
    // rather than creating a second pending request nobody can resolve.
    if (reverse && reverse.status === 'pending') {
      reverse.status = 'accepted';
      this.data.friends[edgeKey(userId, friendId)] = {
        userId, friendId, status: 'accepted', createdAt: now,
      };
      this.schedule();
      return 'accepted';
    }

    const existing = this.data.friends[edgeKey(userId, friendId)];
    if (existing) return existing.status;

    this.data.friends[edgeKey(userId, friendId)] = {
      userId, friendId, status: 'pending', createdAt: now,
    };
    this.schedule();
    return 'pending';
  }

  async acceptFriend(userId: string, friendId: string): Promise<void> {
    const incoming = this.data.friends[edgeKey(friendId, userId)];
    if (!incoming) return;
    incoming.status = 'accepted';
    this.data.friends[edgeKey(userId, friendId)] = {
      userId, friendId, status: 'accepted', createdAt: new Date().toISOString(),
    };
    this.schedule();
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    delete this.data.friends[edgeKey(userId, friendId)];
    delete this.data.friends[edgeKey(friendId, userId)];
    this.schedule();
  }

  async listFriends(userId: string): Promise<Array<UserRecord & { status: FriendshipStatus }>> {
    const out: Array<UserRecord & { status: FriendshipStatus }> = [];
    for (const edge of Object.values(this.data.friends)) {
      if (edge.userId !== userId) continue;
      const user = this.data.users[edge.friendId];
      if (user) out.push({ ...user, status: edge.status });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  // -- study time ----------------------------------------------------------

  async recordStudySession(session: StudySession): Promise<StudyTotals> {
    const seconds = Math.floor(session.seconds);
    // Bounds are enforced here as well as at the caller: this is the last point
    // before the number becomes a permanent statistic.
    if (seconds >= MIN_STUDY_SECONDS && seconds <= MAX_STUDY_SECONDS) {
      this.data.study.push({ ...session, seconds });
      this.schedule();
    }
    return this.getStudyTotals(session.userId);
  }

  async getStudyTotals(userId: string, dayStartMs?: number): Promise<StudyTotals> {
    const rows = this.data.study.filter((s) => s.userId === userId);
    const byZone: Record<string, number> = {};
    let totalSeconds = 0;
    let longestSeconds = 0;
    let todaySeconds = 0;
    for (const row of rows) {
      totalSeconds += row.seconds;
      byZone[row.zoneId] = (byZone[row.zoneId] ?? 0) + row.seconds;
      longestSeconds = Math.max(longestSeconds, row.seconds);
      if (dayStartMs !== undefined && Date.parse(row.endedAt) >= dayStartMs) todaySeconds += row.seconds;
    }
    return { totalSeconds, sessionCount: rows.length, byZone, longestSeconds, todaySeconds };
  }

  // -- arcade --------------------------------------------------------------

  async submitScore(score: HighScore): Promise<ScoreResult> {
    const mine = this.data.scores.filter(
      (s) => s.minigameId === score.minigameId && s.userId === score.userId,
    );
    const previousBest = mine.reduce((best, s) => Math.max(best, s.score), 0);
    const improved = score.score > previousBest;

    this.data.scores.push(score);
    this.schedule();

    const best = Math.max(previousBest, score.score);
    // Ranked against everyone, not a top-N slice — see ScoreResult.rank.
    const board = await this.topScores(score.minigameId, Number.MAX_SAFE_INTEGER);
    const rank = board.findIndex((s) => s.userId === score.userId) + 1;
    return { best, improved, rank };
  }

  /** One row per user — their best (06: "top 10, per user's best score"). */
  async topScores(minigameId: string, limit: number): Promise<HighScore[]> {
    const bestByUser = new Map<string, HighScore>();
    for (const row of this.data.scores) {
      if (row.minigameId !== minigameId) continue;
      const current = bestByUser.get(row.userId);
      if (!current || row.score > current.score) bestByUser.set(row.userId, row);
    }
    return [...bestByUser.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async bestScore(minigameId: string, userId: string): Promise<number> {
    return this.data.scores.reduce(
      (best, row) =>
        row.minigameId === minigameId && row.userId === userId ? Math.max(best, row.score) : best,
      0,
    );
  }

  async countPlays(userId: string): Promise<number> {
    return this.data.scores.filter((row) => row.userId === userId).length;
  }

  async friendScores(minigameId: string, userId: string, limit: number): Promise<HighScore[]> {
    const friends = await this.listFriends(userId);
    const allowed = new Set(friends.filter((f) => f.status === 'accepted').map((f) => f.id));
    allowed.add(userId); // your own score belongs on your friends board
    const board = await this.topScores(minigameId, 1000);
    return board.filter((s) => allowed.has(s.userId)).slice(0, limit);
  }
}
