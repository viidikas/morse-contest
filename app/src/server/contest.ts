// All rooms together, plus the rule about who may enter which room.
//
// Rooms above beginner are open only to accounts that have passed that
// level's solo qualification test (or been admitted by an administrator).
// The qualification is stored with the account, see store.ts.

import { LEVELS, PASS_ACCURACY, levelById, levelChars, levelRank } from '../engine/levels.js';
import { Room, type FinishedSession, type RoomConfig, type ResultView, type StateView } from './room.js';

export interface Player {
  id: string;
  name: string;
  /** Hardest room the account has qualified for, or null. */
  level: string | null;
}

export interface LevelInfo {
  id: string;
  chars: string;
  charWpm: number;
  effWpm: number;
  requiresTest: boolean;
  /** Whether the asking account may join this room. */
  open: boolean;
  startAt: number;
  running: boolean;
  people: number;
}

export type ContestResult = ResultView | (ResultView & { ready: true; passed: boolean; threshold: number });

export interface FinishedWithVerdict extends FinishedSession {
  /** For a test: whether it was passed. Null for a contest session. */
  passed: boolean | null;
}

/** True if an account qualified for `have` may enter room `want`. */
export function mayEnter(have: string | null, want: string): boolean {
  const level = levelById(want);
  if (!level) return false;
  return !level.requiresTest || levelRank(have ?? '') >= levelRank(want);
}

export class Contest {
  private rooms = new Map<string, Room>();

  constructor(cfg: RoomConfig, makeToken: () => string, makeSeed: () => number) {
    for (const level of LEVELS) this.rooms.set(level.id, new Room(level, cfg, makeToken, makeSeed));
  }

  private roomOf(token: string): Room | undefined {
    return this.rooms.get(token.split('.', 1)[0]);
  }

  prune(now: number): void {
    for (const room of this.rooms.values()) room.prune(now);
  }

  levels(now: number, qualifiedFor: string | null): { now: number; passAccuracy: number; levels: LevelInfo[] } {
    return {
      now,
      passAccuracy: PASS_ACCURACY,
      levels: LEVELS.map((l) => ({
        id: l.id,
        chars: levelChars(l),
        charWpm: l.charWpm,
        effWpm: l.effWpm,
        requiresTest: l.requiresTest,
        open: mayEnter(qualifiedFor, l.id),
        ...this.rooms.get(l.id)!.info(now),
      })),
    };
  }

  join(levelId: string, player: Player, now: number): { token: string } | { error: string } {
    if (!levelById(levelId)) return { error: 'unknown-level' };
    if (!mayEnter(player.level, levelId)) return { error: 'not-qualified' };
    return this.rooms.get(levelId)!.join(player, now);
  }

  /** Starts the solo qualification test for a level. */
  qualify(levelId: string, player: Player, now: number): { token: string } | { error: string } {
    const level = levelById(levelId);
    if (!level || !level.requiresTest) return { error: 'unknown-level' };
    return this.rooms.get(levelId)!.startSolo(player.id, now);
  }

  state(token: string, now: number, from: number): StateView | null {
    return this.roomOf(token)?.state(token, now, from) ?? null;
  }

  answer(token: string, index: number, text: string, now: number): { ok: boolean; reason?: string } {
    return this.roomOf(token)?.answer(token, index, text, now) ?? { ok: false, reason: 'unknown-token' };
  }

  result(token: string, now: number): ContestResult | null {
    const result = this.roomOf(token)?.result(token, now) ?? null;
    if (!result || !result.ready || !result.solo) return result;
    return { ...result, passed: result.accuracy >= PASS_ACCURACY, threshold: PASS_ACCURACY };
  }

  /** Sessions and tests that ended since the last call; each is returned once. */
  collectFinished(now: number): FinishedWithVerdict[] {
    const out: FinishedWithVerdict[] = [];
    for (const room of this.rooms.values()) {
      for (const s of room.collectFinished(now)) {
        out.push({ ...s, passed: s.solo ? (s.rows[0]?.accuracy ?? 0) >= PASS_ACCURACY : null });
      }
    }
    return out;
  }
}
