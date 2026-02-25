import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";

const EXPIRY_DAYS = 7;

export type ReminderStatus =
  | "active"
  | "snoozed"
  | "dismissed"
  | "expired"
  | "in_progress";

export interface Reminder {
  id: string;
  sessionId: string | null;
  repoPath: string | null;
  summary: string;
  dueAt: string | null;
  status: ReminderStatus;
  snoozedUntil: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInput {
  summary: string;
  sessionId?: string;
  repoPath?: string;
  dueAt?: string;
}

export class ReminderStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id            TEXT PRIMARY KEY,
        session_id    TEXT,
        repo_path     TEXT,
        summary       TEXT NOT NULL,
        due_at        TEXT,
        status        TEXT DEFAULT 'active',
        snoozed_until TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        expires_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at);

      -- Deduplicate before creating unique index (keep newest per session_id)
      DELETE FROM reminders WHERE id IN (
        SELECT id FROM reminders r
        WHERE r.session_id IS NOT NULL
          AND r.status IN ('active', 'snoozed', 'in_progress')
          AND r.created_at < (
            SELECT MAX(r2.created_at) FROM reminders r2
            WHERE r2.session_id = r.session_id
              AND r2.status IN ('active', 'snoozed', 'in_progress')
          )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_session_unique
        ON reminders(session_id) WHERE session_id IS NOT NULL AND status IN ('active', 'snoozed', 'in_progress');
    `);
  }

  private expireStale(): void {
    this.db
      .prepare(
        "UPDATE reminders SET status = 'expired' WHERE status IN ('active', 'snoozed') AND expires_at < datetime('now')"
      )
      .run();
  }

  private unsnoozeDue(): void {
    this.db
      .prepare(
        "UPDATE reminders SET status = 'active', snoozed_until = NULL WHERE status = 'snoozed' AND snoozed_until < datetime('now')"
      )
      .run();
  }

  create(input: CreateInput): Reminder {
    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = addDays(new Date(), EXPIRY_DAYS).toISOString();

    this.db
      .prepare(
        `INSERT INTO reminders (id, session_id, repo_path, summary, due_at, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        id,
        input.sessionId ?? null,
        input.repoPath ?? null,
        input.summary,
        input.dueAt ?? null,
        now,
        expiresAt
      );

    return this.get(id)!;
  }

  get(id: string): Reminder | null {
    this.expireStale();
    this.unsnoozeDue();
    const row = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
    return row ? rowToReminder(row) : null;
  }

  list(status?: ReminderStatus): Reminder[] {
    this.expireStale();
    this.unsnoozeDue();
    if (status) {
      return this.db
        .prepare("SELECT * FROM reminders WHERE status = ? ORDER BY created_at DESC")
        .all(status)
        .map(rowToReminder);
    }
    return this.db
      .prepare("SELECT * FROM reminders ORDER BY created_at DESC")
      .all()
      .map(rowToReminder);
  }

  snooze(id: string, until: string): Reminder | null {
    this.db
      .prepare(
        "UPDATE reminders SET status = 'snoozed', snoozed_until = ? WHERE id = ?"
      )
      .run(until, id);
    return this.get(id);
  }

  dismiss(id: string): Reminder | null {
    this.db
      .prepare("UPDATE reminders SET status = 'dismissed' WHERE id = ?")
      .run(id);
    return this.get(id);
  }

  update(id: string, fields: { summary?: string; dueAt?: string }): Reminder | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.summary !== undefined) {
      sets.push("summary = ?");
      params.push(fields.summary);
    }
    if (fields.dueAt !== undefined) {
      sets.push("due_at = ?");
      params.push(fields.dueAt);
    }

    if (sets.length === 0) return this.get(id);

    params.push(id);
    this.db
      .prepare(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return this.get(id);
  }

  findBySessionId(sessionId: string): Reminder | null {
    this.expireStale();
    this.unsnoozeDue();
    const row = this.db
      .prepare(
        "SELECT * FROM reminders WHERE session_id = ? AND status IN ('active', 'snoozed', 'in_progress')"
      )
      .get(sessionId);
    return row ? rowToReminder(row) : null;
  }

  upsert(input: CreateInput): { reminder: Reminder; created: boolean } {
    if (input.sessionId) {
      const existing = this.findBySessionId(input.sessionId);
      if (existing) {
        const expiresAt = addDays(new Date(), EXPIRY_DAYS).toISOString();
        this.db
          .prepare(
            "UPDATE reminders SET summary = ?, due_at = ?, expires_at = ? WHERE id = ?"
          )
          .run(
            input.summary,
            input.dueAt ?? existing.dueAt,
            expiresAt,
            existing.id
          );
        return { reminder: this.get(existing.id)!, created: false };
      }
    }
    return { reminder: this.create(input), created: true };
  }

  resume(id: string): Reminder | null {
    this.db
      .prepare("UPDATE reminders SET status = 'in_progress' WHERE id = ?")
      .run(id);
    return this.get(id);
  }

  /** Test helper: manually set expires_at */
  _setExpiresAt(id: string, expiresAt: string): void {
    this.db
      .prepare("UPDATE reminders SET expires_at = ? WHERE id = ?")
      .run(expiresAt, id);
  }

  close(): void {
    this.db.close();
  }
}

function rowToReminder(row: unknown): Reminder {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    sessionId: (r.session_id as string) ?? null,
    repoPath: (r.repo_path as string) ?? null,
    summary: r.summary as string,
    dueAt: (r.due_at as string) ?? null,
    status: r.status as ReminderStatus,
    snoozedUntil: (r.snoozed_until as string) ?? null,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
  };
}
