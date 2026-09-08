/**
 * Leaderboard HTTP client.
 *
 * Scores are read over HTTP rather than through a Colyseus room because 06
 * wants the board shown on the cabinet BEFORE a run starts — which is exactly
 * when the player is not in a minigame room.
 *
 * Solo games submit their score here. Multiplayer games do NOT: their scores
 * are computed and persisted by MinigameRoom, because 06 requires round
 * outcomes to be server-side rather than trusted from clients.
 */

import { session } from '../session';

export interface ScoreRow {
  minigameId: string;
  userId: string;
  displayName: string;
  score: number;
  achievedAt: string;
}

/** ws://host:port -> http://host:port */
function httpBase(): string {
  const url = session.serverUrl;
  return url.replace(/^ws/, 'http').replace(/\/$/, '');
}

/**
 * Fetch the board, optionally submitting a solo score first.
 *
 * Both are one round trip's worth of work and always happen together, so they
 * share a call — the caller wants "here is where I landed", not two facts.
 */
export async function fetchScores(minigameId: string, submitScore?: number): Promise<ScoreRow[]> {
  const base = httpBase();

  if (typeof submitScore === 'number' && submitScore > 0) {
    await fetch(`${base}/scores/${encodeURIComponent(minigameId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: session.userId,
        displayName: session.displayName ?? 'Wanderer',
        score: submitScore,
      }),
    }).catch(() => undefined);
  }

  const response = await fetch(
    `${base}/scores/${encodeURIComponent(minigameId)}?userId=${encodeURIComponent(session.userId)}`,
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { scores?: ScoreRow[] };
  return body.scores ?? [];
}

/** Unlock facts for cosmetics (06). Rules are applied client-side. */
export async function fetchProgress(): Promise<
  { bestScores: Record<string, number>; totalPlays: number; studyMinutes: number } | null
> {
  try {
    const response = await fetch(`${httpBase()}/progress/${encodeURIComponent(session.userId)}`);
    if (!response.ok) return null;
    return (await response.json()) as {
      bestScores: Record<string, number>;
      totalPlays: number;
      studyMinutes: number;
    };
  } catch {
    return null;
  }
}

export interface StudyTotalsResponse {
  totalSeconds: number;
  sessionCount: number;
  byZone: Record<string, number>;
}

export async function fetchStudyTotals(): Promise<StudyTotalsResponse | null> {
  try {
    const response = await fetch(`${httpBase()}/study/${encodeURIComponent(session.userId)}`);
    if (!response.ok) return null;
    return (await response.json()) as StudyTotalsResponse;
  } catch {
    return null;
  }
}
