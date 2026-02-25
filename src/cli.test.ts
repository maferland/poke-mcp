import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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

  describe("dismissOtherSessions()", () => {
    it("dismisses reminders from other sessions for same repo", () => {
      store.create({ summary: "old", sessionId: "old-session", repoPath: "/repo" });
      store.create({ summary: "current", sessionId: "new-session", repoPath: "/repo" });

      // Create session files so healSessions doesn't clear them
      const repoDir = join(projectsDir, "-repo");
      mkdirSync(repoDir, { recursive: true });
      writeFileSync(join(repoDir, "old-session.jsonl"), "");
      writeFileSync(join(repoDir, "new-session.jsonl"), "");

      store.dismissOtherSessions("/repo", "new-session");

      const all = store.list();
      const old = all.find((r) => r.sessionId === "old-session");
      const current = all.find((r) => r.sessionId === "new-session");
      expect(old?.status).toBe("dismissed");
      expect(current?.status).toBe("active");
    });

    it("does not affect reminders from other repos", () => {
      store.create({ summary: "other repo", sessionId: "other", repoPath: "/other" });

      // Create session file
      const otherDir = join(projectsDir, "-other");
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(otherDir, "other.jsonl"), "");

      store.dismissOtherSessions("/repo", "new-session");

      const r = store.findBySessionId("other");
      expect(r?.status).toBe("active");
    });
  });
});
