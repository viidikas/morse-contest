// Accounts and saved results.
//
// Everything is kept in memory and written to one JSON file after each
// change. For a group of friends this is ample, needs no database service and
// is trivial to back up. All access goes through this class, so it can be
// replaced by a real database later without touching the rest of the server.

import { levelRank } from '../engine/levels.js';

export type Role = 'user' | 'admin';

export interface User {
  id: string;
  /** Google's permanent identifier for the account. */
  sub: string;
  email: string;
  /** Display name shown to others; a callsign is fine. */
  name: string;
  role: Role;
  blocked: boolean;
  /** Hardest room this user has qualified for, or null for beginner only. */
  level: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export interface ResultRow {
  id: string;
  userId: string;
  kind: 'contest' | 'test';
  level: string;
  startAt: number;
  correct: number;
  total: number;
  /** Accuracy over the groups attended, 0..1. */
  accuracy: number;
  /** Place in the session; null for a solo test. */
  rank: number | null;
  /** Number of participants in the session. */
  people: number;
  /** Whether a test was passed; null for a contest session. */
  passed: boolean | null;
  /** Per character: [times sent, times copied correctly]. */
  chars: Record<string, [number, number]>;
}

export interface StoreData {
  users: User[];
  results: ResultRow[];
}

export interface UserStats {
  sessions: number;
  tests: number;
  /** Mean accuracy over contest sessions, 0..1; null if none. */
  averageAccuracy: number | null;
  bestAccuracy: number | null;
  wins: number;
}

const MAX_NAME = 20;

export function cleanName(raw: string): string {
  return [...raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, MAX_NAME).join('');
}

export class Store {
  private users = new Map<string, User>();
  private results: ResultRow[] = [];

  constructor(
    data: StoreData | null,
    /** Called with the full contents whenever something changed. */
    private persist: (json: string) => void,
    private makeId: () => string,
  ) {
    for (const u of data?.users ?? []) this.users.set(u.id, u);
    this.results = data?.results ?? [];
  }

  private changed(): void {
    this.persist(JSON.stringify({ users: [...this.users.values()], results: this.results }));
  }

  /** Finds the account for a Google identity, creating it on first sign-in. */
  signIn(google: { sub: string; email: string; name: string }, now: number, adminEmails: Set<string>): User {
    const email = google.email.toLowerCase();
    let user = [...this.users.values()].find((u) => u.sub === google.sub);
    if (!user) {
      user = {
        id: this.makeId(),
        sub: google.sub,
        email,
        name: cleanName(google.name) || cleanName(email.split('@')[0]) || 'user',
        role: 'user',
        blocked: false,
        level: null,
        createdAt: now,
        lastSeenAt: now,
      };
      this.users.set(user.id, user);
    }
    user.email = email;
    user.lastSeenAt = now;
    // People listed as administrators in the server settings always are.
    if (adminEmails.has(email)) user.role = 'admin';
    this.changed();
    return user;
  }

  user(id: string): User | undefined {
    return this.users.get(id);
  }

  allUsers(): User[] {
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  rename(id: string, rawName: string): User | { error: string } {
    const user = this.users.get(id);
    if (!user) return { error: 'unknown-user' };
    const name = cleanName(rawName);
    if (!name) return { error: 'name-required' };
    user.name = name;
    this.changed();
    return user;
  }

  setBlocked(id: string, blocked: boolean): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.blocked = blocked;
    this.changed();
    return true;
  }

  setRole(id: string, role: Role): boolean {
    const user = this.users.get(id);
    if (!user) return false;
    user.role = role;
    this.changed();
    return true;
  }

  /** Sets the qualification outright (administrator action); null removes it. */
  setLevel(id: string, level: string | null): boolean {
    const user = this.users.get(id);
    if (!user || (level !== null && levelRank(level) < 0)) return false;
    user.level = level;
    this.changed();
    return true;
  }

  /** Records a passed test: raises the qualification, never lowers it. */
  grantLevel(id: string, level: string): void {
    const user = this.users.get(id);
    if (!user) return;
    if (levelRank(level) > levelRank(user.level ?? '')) {
      user.level = level;
      this.changed();
    }
  }

  /** Removes the account and everything saved for it. */
  deleteUser(id: string): boolean {
    if (!this.users.delete(id)) return false;
    this.results = this.results.filter((r) => r.userId !== id);
    this.changed();
    return true;
  }

  addResults(rows: Omit<ResultRow, 'id'>[]): void {
    if (rows.length === 0) return;
    for (const row of rows) {
      if (this.users.has(row.userId)) this.results.push({ ...row, id: this.makeId() });
    }
    this.changed();
  }

  /** A user's saved results, newest first. */
  resultsOf(userId: string): ResultRow[] {
    return this.results.filter((r) => r.userId === userId).sort((a, b) => b.startAt - a.startAt);
  }

  statsOf(userId: string): UserStats {
    const mine = this.results.filter((r) => r.userId === userId);
    const contests = mine.filter((r) => r.kind === 'contest');
    const acc = contests.map((r) => r.accuracy);
    return {
      sessions: contests.length,
      tests: mine.length - contests.length,
      averageAccuracy: acc.length ? acc.reduce((a, b) => a + b, 0) / acc.length : null,
      bestAccuracy: acc.length ? Math.max(...acc) : null,
      wins: contests.filter((r) => r.rank === 1 && r.people > 1).length,
    };
  }
}
