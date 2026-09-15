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
  /** The single longest recorded session. */
  longestSeconds: number;
  /**
   * Focus time since the start of the caller's day.
   *
   * The CALLER supplies where its day starts, as an epoch timestamp. The server
   * does not know the player's timezone, and "today" measured from UTC midnight
   * is five and a half hours wrong for someone in India — the day would roll
   * over mid-morning.
   */
  todaySeconds: number;
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
  /**
   * True 1-based position across ALL players, not a position within some top-N
   * slice. Both stores must agree on this: returning 0 for "outside the top
   * 100" in one and a real rank in the other made the same call mean different
   * things depending on configuration.
   */
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
  getStudyTotals(userId: string, dayStartMs?: number): Promise<StudyTotals>;

  // -- arcade (06) ----------------------------------------------------------
  submitScore(score: HighScore): Promise<ScoreResult>;
  topScores(minigameId: string, limit: number): Promise<HighScore[]>;
  /** Friend-filtered board — 06 calls this more socially meaningful. */
  friendScores(minigameId: string, userId: string, limit: number): Promise<HighScore[]>;
  /**
   * How many arcade runs this player has recorded, across all minigames.
   *
   * Needed by the "played N rounds" cosmetic unlocks (06). Counting distinct
   * minigames with a score instead would answer a different question and make
   * a five-round unlock reachable only by playing five different games.
   */
  countPlays(userId: string): Promise<number>;
  /**
   * One player's best score in one minigame, or 0.
   *
   * Deriving this from a top-N board missed anyone outside that slice — so a
   * player ranked 1001st could never unlock a score-gated cosmetic — and made
   * the progress endpoint scan a full board per minigame per request.
   */
  bestScore(minigameId: string, userId: string): Promise<number>;
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
