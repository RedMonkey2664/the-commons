/**
 * Persistence contracts — 02 (Postgres via Supabase).
 *
 * Deliberately provider-agnostic. The server picks an implementation at boot
 * from the environment: a JSON-file store when no database is configured, and
 * Postgres when DATABASE_URL is present. Everything above this interface —
 * study tracking, high scores, friends — is written once and does not know
 * which one it is talking to.
 *
 * That split exists because the alternative is stubbing persistence until
 * credentials show up, and stubbed persistence tends to have the wrong shape
 * by the time it is replaced.
 */

/** A person. In Phase 3 this is a name; with Supabase it is an auth user. */
export interface UserRecord {
  id: string;
  displayName: string;
  spriteKey: string;
  createdAt: string;
}

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

/**
 * One direction of a friendship. 05 specifies a mutual-accept model, so an
 * accepted friendship is two rows — A->B and B->A — which keeps "who asked"
 * recoverable and makes blocking one-directional.
 */
export interface FriendEdge {
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
}

/**
 * Study time (11): "a passive byproduct, not a feature you use". Rows are
 * written when a session ENDS, so an abandoned session records nothing rather
 * than accruing forever.
 */
export interface StudySession {
  userId: string;
  zoneId: string;
  seconds: number;
  endedAt: string;
}

export interface StudyTotals {
  totalSeconds: number;
  sessionCount: number;
  /** Per-zone breakdown, keyed by zone id. */
  byZone: Record<string, number>;
}

export interface HighScore {
  minigameId: string;
  userId: string;
  displayName: string;
  score: number;
  achievedAt: string;
}

export interface ScoreResult {
  /** This player's best score for the minigame, after submission. */
  best: number;
  /** True when the submitted score beat their previous best. */
  improved: boolean;
  /** 1-based position on the board, or 0 if not in the top slice. */
  rank: number;
}

/**
 * The whole persistence surface. Small on purpose — every method here is
 * something a feature actually needs, not something a schema suggests.
 */
export interface Store {
  readonly kind: 'json' | 'postgres';

  init(): Promise<void>;
  close(): Promise<void>;

  // -- users ---------------------------------------------------------------
  upsertUser(user: Pick<UserRecord, 'id' | 'displayName' | 'spriteKey'>): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  findUserByName(displayName: string): Promise<UserRecord | null>;

  // -- friends (05, mutual accept) -----------------------------------------
  requestFriend(userId: string, friendId: string): Promise<FriendshipStatus>;
  acceptFriend(userId: string, friendId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  listFriends(userId: string): Promise<Array<UserRecord & { status: FriendshipStatus }>>;

  // -- study time (11) ------------------------------------------------------
  recordStudySession(session: StudySession): Promise<StudyTotals>;
  getStudyTotals(userId: string): Promise<StudyTotals>;

  // -- arcade (06) ----------------------------------------------------------
  submitScore(score: HighScore): Promise<ScoreResult>;
  topScores(minigameId: string, limit: number): Promise<HighScore[]>;
  /** Friend-filtered board — 06 calls this more socially meaningful. */
  friendScores(minigameId: string, userId: string, limit: number): Promise<HighScore[]>;
}

/**
 * Shortest study session worth recording, in seconds.
 *
 * Sitting down and immediately standing up is a misclick, not study time, and
 * without a floor those pollute the stat that 11 says should be a truthful
 * passive byproduct.
 */
export const MIN_STUDY_SECONDS = 20;

/** Cap on a single reported session, guarding a client that sleeps and wakes. */
export const MAX_STUDY_SECONDS = 4 * 60 * 60;
