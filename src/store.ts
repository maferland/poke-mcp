import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const EXPIRY_DAYS = 7;
const VALID_STATUSES = new Set(["active", "snoozed", "dismissed", "expired", "in_progress"]);

type ReminderRow = { id: string; session_id: string; repo_path: string | null; session_dir: string | null };

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
  sessionDir: string | null;
  repoName: string | null;
  branch: string | null;
  summary: string;
  detail: string | null;
  dueAt: string | null;
  status: ReminderStatus;
  snoozedUntil: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreateInput {
  summary: string;
  detail?: string;
  sessionId?: string;
  repoPath?: string;
  sessionDir?: string;
  repoName?: string;
  branch?: string;
  dueAt?: string;
}

export class ReminderStore {
  private db: Database;
  private projectsDir: string;

  constructor(dbPath: string, projectsDir?: string) {
    this.db = new Database(dbPath);
    this.projectsDir = projectsDir ?? join(homedir(), ".claude", "projects");
    this.initSchema();
    this.runMigrations();
  }

  private initSchema(): void {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
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
      CREATE INDEX IF NOT EXISTS idx_reminders_expires_at ON reminders(expires_at);

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

  private runMigrations(): void {
    const cols = this.db
      .prepare("PRAGMA table_info(reminders)")
      .all() as { name: string }[];
    const existing = new Set(cols.map((c) => c.name));
    const additions = ["branch", "detail", "session_dir", "repo_name"];
    for (const col of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE reminders ADD COLUMN ${col} TEXT`);
      }
    }
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

  private healSessions(): void {
    const rows = this.db
      .prepare(
        "SELECT id, session_id, repo_path, session_dir FROM reminders WHERE session_id IS NOT NULL AND status IN ('active', 'snoozed', 'in_progress')"
      )
      .all() as ReminderRow[];

    for (const row of rows) {
      const path = row.session_dir ?? row.repo_path;
      if (!path) continue;

      const encodedPath = path.replace(/[/.]/g, "-");
      const projectDir = join(this.projectsDir, encodedPath);
      const sessionFile = join(projectDir, `${row.session_id}.jsonl`);

      if (existsSync(sessionFile)) continue;

      if (!existsSync(projectDir)) {
        this.db.prepare("UPDATE reminders SET session_id = NULL WHERE id = ?").run(row.id);
        continue;
      }

      const files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
      if (files.length === 0) {
        this.db.prepare("UPDATE reminders SET session_id = NULL WHERE id = ?").run(row.id);
        continue;
      }

      const newest = files
        .map((f) => ({ file: f, mtime: statSync(join(projectDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0];

      const newSessionId = newest.file.replace(/\.jsonl$/, "");
      this.db.prepare("UPDATE reminders SET session_id = ? WHERE id = ?").run(newSessionId, row.id);
    }
  }

  /** Run expiry + unsnooze in one call (used by CLI). */
  expire(): void {
    this.expireStale();
    this.unsnoozeDue();
  }

  /** Dismiss active reminders for a repo that belong to a different session. */
  dismissOtherSessions(repoPath: string, currentSessionId: string): void {
    this.db
      .prepare(
        "UPDATE reminders SET status = 'dismissed' WHERE repo_path = ? AND session_id != ? AND status IN ('active', 'snoozed', 'in_progress')"
      )
      .run(repoPath, currentSessionId);
  }

  create(input: CreateInput): Reminder {
    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = addDays(new Date(), EXPIRY_DAYS).toISOString();

    this.db
      .prepare(
        `INSERT INTO reminders (id, session_id, repo_path, session_dir, repo_name, branch, summary, detail, due_at, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(
        id,
        input.sessionId ?? null,
        input.repoPath ?? null,
        input.sessionDir ?? null,
        input.repoName ?? null,
        input.branch ?? null,
        input.summary,
        input.detail ?? null,
        input.dueAt ?? null,
        now,
        expiresAt
      );

    return this.get(id)!;
  }

  /** Resolve a full or prefix ID to the full UUID. Returns null if ambiguous or not found. */
  private resolveId(id: string): string | null {
    if (id.length === 36) return id;
    const rows = this.db
      .prepare("SELECT id FROM reminders WHERE id LIKE ? || '%' LIMIT 2")
      .all(id) as { id: string }[];
    return rows.length === 1 ? rows[0].id : null;
  }

  get(id: string): Reminder | null {
    this.expireStale();
    this.unsnoozeDue();
    const fullId = this.resolveId(id);
    if (!fullId) return null;
    const row = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(fullId);
    return row ? rowToReminder(row) : null;
  }

  list(status?: ReminderStatus): Reminder[] {
    this.expireStale();
    this.unsnoozeDue();
    this.healSessions();
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
    const fullId = this.resolveId(id) ?? id;
    this.db
      .prepare(
        "UPDATE reminders SET status = 'snoozed', snoozed_until = ? WHERE id = ?"
      )
      .run(until, fullId);
    return this.get(fullId);
  }

  dismiss(id: string): Reminder | null {
    const fullId = this.resolveId(id) ?? id;
    this.db
      .prepare("UPDATE reminders SET status = 'dismissed' WHERE id = ?")
      .run(fullId);
    return this.get(fullId);
  }

  update(id: string, fields: { summary?: string; detail?: string; dueAt?: string }): Reminder | null {
    const fullId = this.resolveId(id) ?? id;
    const sets: string[] = [];
    const params: unknown[] = [];

    if (fields.summary !== undefined) {
      sets.push("summary = ?");
      params.push(fields.summary);
    }
    if (fields.detail !== undefined) {
      sets.push("detail = ?");
      params.push(fields.detail);
    }
    if (fields.dueAt !== undefined) {
      sets.push("due_at = ?");
      params.push(fields.dueAt);
    }

    if (sets.length === 0) return this.get(fullId);

    params.push(fullId);
    this.db
      .prepare(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params);
    return this.get(fullId);
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
            "UPDATE reminders SET summary = ?, detail = ?, due_at = ?, branch = ?, session_dir = ?, repo_name = ?, expires_at = ? WHERE id = ?"
          )
          .run(
            input.summary,
            input.detail ?? existing.detail,
            input.dueAt ?? existing.dueAt,
            input.branch ?? existing.branch,
            input.sessionDir ?? existing.sessionDir,
            input.repoName ?? existing.repoName,
            expiresAt,
            existing.id
          );
        return { reminder: this.get(existing.id)!, created: false };
      }
    }
    return { reminder: this.create(input), created: true };
  }

  resume(id: string): Reminder | null {
    const fullId = this.resolveId(id) ?? id;
    this.db
      .prepare("UPDATE reminders SET status = 'in_progress' WHERE id = ?")
      .run(fullId);
    return this.get(fullId);
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
  const status = String(r.status ?? "active");
  if (!VALID_STATUSES.has(status)) {
    console.warn(`[Poke] unexpected reminder status: ${status}`);
  }
  return {
    id: String(r.id ?? ""),
    sessionId: r.session_id != null ? String(r.session_id) : null,
    repoPath: r.repo_path != null ? String(r.repo_path) : null,
    sessionDir: r.session_dir != null ? String(r.session_dir) : null,
    repoName: r.repo_name != null ? String(r.repo_name) : null,
    branch: r.branch != null ? String(r.branch) : null,
    summary: String(r.summary ?? ""),
    detail: r.detail != null ? String(r.detail) : null,
    dueAt: r.due_at != null ? String(r.due_at) : null,
    status: VALID_STATUSES.has(status) ? (status as ReminderStatus) : "active",
    snoozedUntil: r.snoozed_until != null ? String(r.snoozed_until) : null,
    createdAt: String(r.created_at ?? ""),
    expiresAt: String(r.expires_at ?? ""),
  };
}
