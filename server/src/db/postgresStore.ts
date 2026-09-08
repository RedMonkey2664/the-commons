/**
 * Postgres store — 02's production target (Supabase).
 *
 * ---------------------------------------------------------------------------
 * UNTESTED. No database was available while this was written, so this adapter
 * has never executed a query. The SQL matches server/src/db/schema.sql and the
 * shape matches JsonStore (which IS exercised by the test suites), but treat
 * the first run against a real database as the actual test.
 *
 * To switch on: set DATABASE_URL in server/.env, apply schema.sql, restart.
 * The server picks this store automatically and logs which one it chose.
 * ---------------------------------------------------------------------------
 */

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

/** Minimal shape of the `pg` Pool we use, so `pg` stays an optional dependency. */
interface PgPool {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  end(): Promise<void>;
}

interface UserRow {
  id: string;
  display_name: string;
  sprite_key: string;
  created_at: Date | string;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    spriteKey: row.sprite_key,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;

  private pool!: PgPool;

  constructor(private readonly connectionString: string) {}

  async init(): Promise<void> {
    // Imported dynamically so `pg` is only required when a database is actually
    // configured — a JSON-store deployment should not need it installed.
    const pg = (await import('pg')) as unknown as {
      default?: { Pool: new (config: unknown) => PgPool };
      Pool?: new (config: unknown) => PgPool;
    };
    const Pool = pg.Pool ?? pg.default?.Pool;
    if (!Pool) throw new Error('pg is installed but exposes no Pool export');

    this.pool = new Pool({
      connectionString: this.connectionString,
      // Supabase requires TLS; it presents a certificate Node does not trust
      // out of the box, which is why verification is relaxed here rather than
      // TLS being disabled outright.
      ssl: this.connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
    });

    await this.pool.query('select 1');
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  // -- users ---------------------------------------------------------------

  async upsertUser(user: Pick<UserRecord, 'id' | 'displayName' | 'spriteKey'>): Promise<UserRecord> {
    const { rows } = await this.pool.query<UserRow>(
      `insert into users (id, display_name, sprite_key)
       values ($1, $2, $3)
       on conflict (id) do update
         set display_name = excluded.display_name,
             sprite_key   = excluded.sprite_key
       returning id, display_name, sprite_key, created_at`,
      [user.id, user.displayName, user.spriteKey],
    );
    return toUser(rows[0]!);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      'select id, display_name, sprite_key, created_at from users where id = $1',
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUserByName(displayName: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<UserRow>(
      `select id, display_name, sprite_key, created_at
         from users where lower(display_name) = lower($1)`,
      [displayName.trim()],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  // -- friends -------------------------------------------------------------

  async requestFriend(userId: string, friendId: string): Promise<FriendshipStatus> {
    if (userId === friendId) return 'pending';

    // If they already asked us, requesting back completes the mutual accept
    // instead of leaving two pending rows nobody can resolve.
    const { rows: reverse } = await this.pool.query<{ status: FriendshipStatus }>(
      'select status from friends where user_id = $1 and friend_id = $2',
      [friendId, userId],
    );

    if (reverse[0]?.status === 'pending') {
      await this.acceptFriend(userId, friendId);
      return 'accepted';
    }

    const { rows } = await this.pool.query<{ status: FriendshipStatus }>(
      `insert into friends (user_id, friend_id, status)
       values ($1, $2, 'pending')
       on conflict (user_id, friend_id) do update set status = friends.status
       returning status`,
      [userId, friendId],
    );
    return rows[0]?.status ?? 'pending';
  }

  async acceptFriend(userId: string, friendId: string): Promise<void> {
    await this.pool.query(
      `update friends set status = 'accepted' where user_id = $1 and friend_id = $2`,
      [friendId, userId],
    );
    await this.pool.query(
      `insert into friends (user_id, friend_id, status)
       values ($1, $2, 'accepted')
       on conflict (user_id, friend_id) do update set status = 'accepted'`,
      [userId, friendId],
    );
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.pool.query(
      `delete from friends
        where (user_id = $1 and friend_id = $2)
           or (user_id = $2 and friend_id = $1)`,
      [userId, friendId],
    );
  }

  async listFriends(userId: string): Promise<Array<UserRecord & { status: FriendshipStatus }>> {
    const { rows } = await this.pool.query<UserRow & { status: FriendshipStatus }>(
      `select u.id, u.display_name, u.sprite_key, u.created_at, f.status
         from friends f
         join users u on u.id = f.friend_id
        where f.user_id = $1
        order by u.display_name`,
      [userId],
    );
    return rows.map((row) => ({ ...toUser(row), status: row.status }));
  }

  // -- study time ----------------------------------------------------------

  async recordStudySession(session: StudySession): Promise<StudyTotals> {
    const seconds = Math.floor(session.seconds);
    if (seconds >= MIN_STUDY_SECONDS && seconds <= MAX_STUDY_SECONDS) {
      await this.pool.query(
        'insert into study_sessions (user_id, zone_id, seconds) values ($1, $2, $3)',
        [session.userId, session.zoneId, seconds],
      );
    }
    return this.getStudyTotals(session.userId);
  }

  async getStudyTotals(userId: string): Promise<StudyTotals> {
    const { rows } = await this.pool.query<{ zone_id: string; seconds: string; sessions: string }>(
      `select zone_id, sum(seconds)::text as seconds, count(*)::text as sessions
         from study_sessions where user_id = $1 group by zone_id`,
      [userId],
    );

    const byZone: Record<string, number> = {};
    let totalSeconds = 0;
    let sessionCount = 0;
    for (const row of rows) {
      const seconds = Number(row.seconds);
      byZone[row.zone_id] = seconds;
      totalSeconds += seconds;
      sessionCount += Number(row.sessions);
    }
    return { totalSeconds, sessionCount, byZone };
  }

  // -- arcade --------------------------------------------------------------

  async submitScore(score: HighScore): Promise<ScoreResult> {
    const { rows: before } = await this.pool.query<{ best: string | null }>(
      `select max(score)::text as best from high_scores
        where minigame_id = $1 and user_id = $2`,
      [score.minigameId, score.userId],
    );
    const previousBest = Number(before[0]?.best ?? 0);

    await this.pool.query(
      'insert into high_scores (minigame_id, user_id, score) values ($1, $2, $3)',
      [score.minigameId, score.userId, score.score],
    );

    const best = Math.max(previousBest, score.score);
    const { rows: rank } = await this.pool.query<{ rank: string }>(
      `select count(*) + 1 as rank from (
         select user_id, max(score) as best
           from high_scores where minigame_id = $1
          group by user_id
       ) boards where boards.best > $2`,
      [score.minigameId, best],
    );

    return { best, improved: score.score > previousBest, rank: Number(rank[0]?.rank ?? 0) };
  }

  async topScores(minigameId: string, limit: number): Promise<HighScore[]> {
    // distinct on (user_id) with this ordering yields each player's best row,
    // so the board is ten people rather than one person ten times (06).
    const { rows } = await this.pool.query<{
      minigame_id: string;
      user_id: string;
      display_name: string;
      score: number;
      achieved_at: Date | string;
    }>(
      `select distinct on (h.user_id)
              h.minigame_id, h.user_id, u.display_name, h.score, h.achieved_at
         from high_scores h
         join users u on u.id = h.user_id
        where h.minigame_id = $1
        order by h.user_id, h.score desc`,
      [minigameId],
    );

    return rows
      .map((row) => ({
        minigameId: row.minigame_id,
        userId: row.user_id,
        displayName: row.display_name,
        score: row.score,
        achievedAt: new Date(row.achieved_at).toISOString(),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async friendScores(minigameId: string, userId: string, limit: number): Promise<HighScore[]> {
    const friends = await this.listFriends(userId);
    const allowed = new Set(friends.filter((f) => f.status === 'accepted').map((f) => f.id));
    allowed.add(userId);
    const board = await this.topScores(minigameId, 1000);
    return board.filter((s) => allowed.has(s.userId)).slice(0, limit);
  }
}
