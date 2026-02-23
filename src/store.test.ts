import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReminderStore } from "./store.ts";
import { mkdtempSync, rmSync } from "node:fs";
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
});
