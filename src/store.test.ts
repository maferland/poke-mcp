import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReminderStore } from "./store.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ReminderStore", () => {
  let store: ReminderStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "poke-test-"));
    store = new ReminderStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("creates a reminder with defaults", () => {
    const r = store.create({ summary: "finish auth PR" });
    expect(r.id).toBeTruthy();
    expect(r.summary).toBe("finish auth PR");
    expect(r.status).toBe("active");
    expect(r.dueAt).toBeNull();
    expect(r.expiresAt).toBeTruthy();
  });

  it("creates a reminder with all fields", () => {
    const r = store.create({
      summary: "review PR",
      sessionId: "sess-123",
      repoPath: "/repo/app",
      dueAt: "2025-06-16T09:00:00.000Z",
    });
    expect(r.sessionId).toBe("sess-123");
    expect(r.repoPath).toBe("/repo/app");
    expect(r.dueAt).toBe("2025-06-16T09:00:00.000Z");
  });

  it("lists all reminders", () => {
    store.create({ summary: "one" });
    store.create({ summary: "two" });
    expect(store.list()).toHaveLength(2);
  });

  it("lists filtered by status", () => {
    const r = store.create({ summary: "one" });
    store.create({ summary: "two" });
    store.dismiss(r.id);
    expect(store.list("active")).toHaveLength(1);
    expect(store.list("dismissed")).toHaveLength(1);
  });

  it("snoozes a reminder", () => {
    const r = store.create({ summary: "test" });
    const future = new Date(Date.now() + 86400_000).toISOString();
    const snoozed = store.snooze(r.id, future);
    expect(snoozed?.status).toBe("snoozed");
    expect(snoozed?.snoozedUntil).toBe(future);
  });

  it("dismisses a reminder", () => {
    const r = store.create({ summary: "test" });
    const dismissed = store.dismiss(r.id);
    expect(dismissed?.status).toBe("dismissed");
  });

  it("updates summary", () => {
    const r = store.create({ summary: "old" });
    const updated = store.update(r.id, { summary: "new" });
    expect(updated?.summary).toBe("new");
  });

  it("updates due_at", () => {
    const r = store.create({ summary: "test" });
    const updated = store.update(r.id, { dueAt: "2025-06-20T09:00:00.000Z" });
    expect(updated?.dueAt).toBe("2025-06-20T09:00:00.000Z");
  });

  it("resumes a reminder", () => {
    const r = store.create({
      summary: "test",
      sessionId: "sess-1",
      repoPath: "/repo/app",
    });
    const resumed = store.resume(r.id);
    expect(resumed?.status).toBe("in_progress");
  });

  it("expires stale reminders", () => {
    const r = store.create({ summary: "stale" });
    store._setExpiresAt(r.id, "2020-01-01T00:00:00.000Z");
    const found = store.get(r.id);
    expect(found?.status).toBe("expired");
  });

  it("unsnoozes when snoozed_until passes", () => {
    const r = store.create({ summary: "snoozed" });
    store.snooze(r.id, "2020-01-01T00:00:00.000Z");
    const found = store.get(r.id);
    expect(found?.status).toBe("active");
    expect(found?.snoozedUntil).toBeNull();
  });

  it("returns null for unknown id", () => {
    expect(store.get("nonexistent")).toBeNull();
    expect(store.dismiss("nonexistent")).toBeNull();
    expect(store.snooze("nonexistent", "2025-01-01T00:00:00Z")).toBeNull();
    expect(store.resume("nonexistent")).toBeNull();
  });

  describe("findBySessionId", () => {
    it("finds active reminder by session_id", () => {
      const r = store.create({ summary: "test", sessionId: "sess-1" });
      const found = store.findBySessionId("sess-1");
      expect(found?.id).toBe(r.id);
    });

    it("returns null for dismissed reminder", () => {
      const r = store.create({ summary: "test", sessionId: "sess-1" });
      store.dismiss(r.id);
      expect(store.findBySessionId("sess-1")).toBeNull();
    });

    it("returns null for unknown session_id", () => {
      expect(store.findBySessionId("nonexistent")).toBeNull();
    });
  });

  describe("upsert", () => {
    it("creates if no match", () => {
      const { reminder, created } = store.upsert({ summary: "new", sessionId: "sess-1" });
      expect(created).toBe(true);
      expect(reminder.summary).toBe("new");
      expect(reminder.sessionId).toBe("sess-1");
    });

    it("updates existing by session_id", () => {
      const { reminder: first } = store.upsert({ summary: "old", sessionId: "sess-1" });
      const { reminder: second, created } = store.upsert({ summary: "new", sessionId: "sess-1" });
      expect(created).toBe(false);
      expect(second.id).toBe(first.id);
      expect(second.summary).toBe("new");
    });

    it("resets expires_at on update", () => {
      const { reminder: first } = store.upsert({ summary: "test", sessionId: "sess-1" });
      store._setExpiresAt(first.id, "2025-01-01T00:00:00.000Z");
      const { reminder: second } = store.upsert({ summary: "test2", sessionId: "sess-1" });
      expect(new Date(second.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("ignores dismissed reminders (creates new)", () => {
      const { reminder: first } = store.upsert({ summary: "old", sessionId: "sess-1" });
      store.dismiss(first.id);
      const { reminder: second, created } = store.upsert({ summary: "new", sessionId: "sess-1" });
      expect(created).toBe(true);
      expect(second.id).not.toBe(first.id);
    });

    it("without session_id always creates new", () => {
      const { created: c1 } = store.upsert({ summary: "a" });
      const { created: c2 } = store.upsert({ summary: "b" });
      expect(c1).toBe(true);
      expect(c2).toBe(true);
      expect(store.list()).toHaveLength(2);
    });
  });

  describe("healSessions", () => {
    let projectsDir: string;

    beforeEach(() => {
      projectsDir = mkdtempSync(join(tmpdir(), "poke-projects-"));
      store.close();
      rmSync(tmpDir, { recursive: true });
      tmpDir = mkdtempSync(join(tmpdir(), "poke-test-"));
      store = new ReminderStore(join(tmpDir, "test.db"), projectsDir);
    });

    it("valid session → no change", () => {
      const r = store.create({ summary: "test", sessionId: "sess-123", repoPath: "/foo/bar" });
      const projectDir = join(projectsDir, "-foo-bar");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, "sess-123.jsonl"), "");
      const found = store.list().find((rem) => rem.id === r.id);
      expect(found?.sessionId).toBe("sess-123");
    });

    it("stale session → healed", () => {
      const r = store.create({ summary: "test", sessionId: "old-sess", repoPath: "/foo/bar" });
      const projectDir = join(projectsDir, "-foo-bar");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, "new-sess.jsonl"), "");
      const found = store.list().find((rem) => rem.id === r.id);
      expect(found?.sessionId).toBe("new-sess");
    });

    it("no sessions → cleared", () => {
      const r = store.create({ summary: "test", sessionId: "old-sess", repoPath: "/foo/bar" });
      const projectDir = join(projectsDir, "-foo-bar");
      mkdirSync(projectDir, { recursive: true });
      const found = store.list().find((rem) => rem.id === r.id);
      expect(found?.sessionId).toBeNull();
    });

    it("no repo_path → skipped", () => {
      const r = store.create({ summary: "test", sessionId: "sess-123" });
      const found = store.list().find((rem) => rem.id === r.id);
      expect(found?.sessionId).toBe("sess-123");
    });
  });

  describe("dismissStaleSameBranch", () => {
    it("dismisses same-branch sessions only", () => {
      store.create({ summary: "a-work", sessionId: "sess-a1", repoPath: "/repo", branch: "feature-a" });
      store.create({ summary: "b-work", sessionId: "sess-b1", repoPath: "/repo", branch: "feature-b" });
      store.dismissStaleSameBranch("/repo", "feature-a", "sess-a2");
      expect(store.findBySessionId("sess-a1")).toBeNull();
      expect(store.findBySessionId("sess-b1")).not.toBeNull();
    });

    it("skips null-branch reminders", () => {
      store.create({ summary: "no branch", sessionId: "sess-x", repoPath: "/repo" });
      store.dismissStaleSameBranch("/repo", "main", "sess-y");
      expect(store.findBySessionId("sess-x")).not.toBeNull();
    });
  });
});
