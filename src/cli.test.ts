import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReminderStore } from "./store.ts";

describe("CLI store operations", () => {
  let store: ReminderStore;
  let tmpDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "poke-cli-"));
    projectsDir = mkdtempSync(join(tmpdir(), "poke-projects-"));
    store = new ReminderStore(join(tmpDir, "test.db"), projectsDir);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
    rmSync(projectsDir, { recursive: true });
  });

  describe("expire()", () => {
    it("expires stale reminders", () => {
      const r = store.create({ summary: "stale" });
      store._setExpiresAt(r.id, "2020-01-01T00:00:00.000Z");
      store.expire();
      expect(store.get(r.id)?.status).toBe("expired");
    });

    it("unsnoozes due reminders", () => {
      const r = store.create({ summary: "snoozed" });
      store.snooze(r.id, "2020-01-01T00:00:00.000Z");
      store.expire();
      const found = store.get(r.id);
      expect(found?.status).toBe("active");
    });
  });

  describe("dismissStaleSameBranch()", () => {
    it("dismisses reminders from other sessions for same repo+branch", () => {
      const old = store.create({ summary: "old", sessionId: "old-session", repoPath: "/repo", branch: "main" });
      const current = store.create({ summary: "current", sessionId: "new-session", repoPath: "/repo", branch: "main" });

      // Create session files so healSessions doesn't clear them
      const repoDir = join(projectsDir, "-repo");
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, "old-session.jsonl"), "");
      writeFileSync(join(repoDir, "new-session.jsonl"), "");

      store.dismissStaleSameBranch("/repo", "main", "new-session");

      expect(store.get(old.id)?.status).toBe("dismissed");
      expect(store.get(current.id)?.status).toBe("active");
    });

    it("does not affect reminders from other repos", () => {
      store.create({ summary: "other repo", sessionId: "other", repoPath: "/other", branch: "main" });

      // Create session file
      const otherDir = join(projectsDir, "-other");
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(otherDir, "other.jsonl"), "");

      store.dismissStaleSameBranch("/repo", "main", "new-session");

      const r = store.findBySessionId("other");
      expect(r?.status).toBe("active");
    });

    it("does not affect reminders from other branches", () => {
      store.create({ summary: "other branch", sessionId: "other", repoPath: "/repo", branch: "feature" });

      // Create session file
      const repoDir = join(projectsDir, "-repo");
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, "other.jsonl"), "");

      store.dismissStaleSameBranch("/repo", "main", "new-session");

      const r = store.findBySessionId("other");
      expect(r?.status).toBe("active");
    });
  });
});
