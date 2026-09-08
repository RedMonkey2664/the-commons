-- The Commons — Postgres schema (02: Postgres via Supabase).
--
-- Apply with:  psql "$DATABASE_URL" -f server/src/db/schema.sql
-- or paste into the Supabase SQL editor.
--
-- Mirrors the Store contract in shared/persistence.ts exactly. If you change
-- one, change the other: postgresStore.ts is the only thing holding them
-- together, and it cannot check the database's shape at compile time.

create table if not exists users (
  id            text primary key,
  display_name  text        not null,
  sprite_key    text        not null default 'char_player',
  created_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Alex" and "alex" are the same person to a
-- player typing a name into the friends panel.
create unique index if not exists users_display_name_lower_idx
  on users (lower(display_name));

-- Friendships are stored one row per DIRECTION (05, mutual-accept model).
-- An accepted friendship is two rows; that keeps "who asked" recoverable and
-- makes blocking one-directional.
create table if not exists friends (
  user_id    text        not null references users(id) on delete cascade,
  friend_id  text        not null references users(id) on delete cascade,
  status     text        not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friends_no_self check (user_id <> friend_id)
);

create index if not exists friends_user_idx on friends (user_id, status);

-- Study time (11): a passive byproduct. One row per completed session; an
-- abandoned session records nothing rather than accruing forever.
create table if not exists study_sessions (
  id       bigserial primary key,
  user_id  text        not null references users(id) on delete cascade,
  zone_id  text        not null,
  seconds  integer     not null check (seconds > 0 and seconds <= 14400),
  ended_at timestamptz not null default now()
);

create index if not exists study_sessions_user_idx on study_sessions (user_id);

-- Arcade scores (06). Every run is stored; the leaderboard selects each
-- player's best, so "top 10" is ten people rather than one person ten times.
create table if not exists high_scores (
  id          bigserial primary key,
  minigame_id text        not null,
  user_id     text        not null references users(id) on delete cascade,
  score       integer     not null check (score >= 0),
  achieved_at timestamptz not null default now()
);

create index if not exists high_scores_board_idx
  on high_scores (minigame_id, score desc);
create index if not exists high_scores_user_idx
  on high_scores (minigame_id, user_id, score desc);
